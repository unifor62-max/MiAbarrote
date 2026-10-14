import type { PaymentNotification } from "../src/data/payments.ts"

export interface PaymentStore {
  insert(event: PaymentNotification, fingerprint: string): Promise<{
    event: PaymentNotification
    duplicate: boolean
  }>
  list(cursor?: number): Promise<{
    events: PaymentNotification[]
    cursor: number
  }>
  transition(
    id: string,
    operation: "reserve" | "release" | "consume",
    owner: string,
    now: number,
    qr?: number,
    commitId?: string,
  ): Promise<boolean>
  limit(key: string, maximum: number, seconds: number): Promise<boolean>
}

// Each script executes as a single Redis operation, including deduplication and leases.
export const insertScript = `
local old = redis.call('GET', KEYS[1])
if old then
  local item = cjson.decode(old)
  if item.fingerprint ~= ARGV[2] then return 'CONFLICT' end
  return cjson.encode({event=item.event, sequence=item.sequence, duplicate=true})
end
local expired = redis.call('ZRANGEBYSCORE', KEYS[4], '-inf', tonumber(ARGV[3])-86400000, 'LIMIT', 0, 500)
for _, id in ipairs(expired) do redis.call('ZREM', KEYS[2], id); redis.call('ZREM', KEYS[4], id) end
local sequence = redis.call('INCR', KEYS[3])
local item = {event=ARGV[1], sequence=sequence, fingerprint=ARGV[2]}
redis.call('SET', KEYS[1], cjson.encode(item), 'EX', 86400)
redis.call('ZADD', KEYS[2], sequence, ARGV[4])
redis.call('ZADD', KEYS[4], ARGV[3], ARGV[4])
return cjson.encode({event=ARGV[1], sequence=sequence, duplicate=false})
`
export const transitionScript = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local item = cjson.decode(raw)
local event = cjson.decode(item.event)
local operation = ARGV[1]
local owner = ARGV[2]
local now = tonumber(ARGV[3])
if operation == 'reserve' then
  if item.consumed then return 0 end
  if item.owner and item.owner ~= owner and item.leaseUntil > now then return 0 end
  item.owner = owner; item.leaseUntil = now + 300000
elseif operation == 'release' then
  if item.consumed or item.owner ~= owner then return 0 end
  item.owner = nil; item.leaseUntil = nil
elseif operation == 'consume' then
  if item.consumed then
    if item.owner == owner and item.commitId == ARGV[5] and event.montoCentavos == tonumber(ARGV[4]) then return 1 end
    return 0
  end
  if item.owner ~= owner or item.leaseUntil <= now or event.montoCentavos ~= tonumber(ARGV[4]) then return 0 end
  item.consumed = true; item.commitId = ARGV[5]
else return 0 end
redis.call('SET', KEYS[1], cjson.encode(item), 'KEEPTTL')
return 1
`
export const limitScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
return count <= tonumber(ARGV[1]) and 1 or 0
`

export class RedisPaymentStore implements PaymentStore {
  private prefix: string
  private url: string
  private token: string
  private fetcher: typeof fetch
  constructor(
    url: string,
    token: string,
    namespace = "miabarrote",
    fetcher: typeof fetch = fetch,
  ) {
    this.url = url
    this.token = token
    this.fetcher = fetcher
    this.prefix = `payments:{${namespace}}:`
  }
  private async command<T,>(args: (string | number)[]): Promise<T> {
    const response = await this.fetcher(this.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(8000),
    })
    const data = (await response.json()) as {
      result: T
      error?: string
    }
    if (!response.ok || data.error)
      throw new Error("El buzón de pagos no está disponible.")
    return data.result
  }
  async insert(event: PaymentNotification, fingerprint: string) {
    const raw = await this.command<string>([
      "EVAL",
      insertScript,
      4,
      this.prefix + event.id,
      this.prefix + "index",
      this.prefix + "sequence",
      this.prefix + "expires",
      JSON.stringify(event),
      fingerprint,
      event.receivedAt,
      event.id,
    ])
    if (raw === "CONFLICT") throw new Error("ID_CONFLICT")
    // Keep event JSON opaque inside Lua: cjson's numeric encoder can round large cents.
    const result = JSON.parse(raw) as {
      event: string
      sequence: number
      duplicate: boolean
    }
    return {
      event: { ...(JSON.parse(result.event) as PaymentNotification), sequence: result.sequence },
      duplicate: result.duplicate,
    }
  }
  async list(cursor?: number) {
    const latest =
      Number(
        await this.command<number | null>(["GET", this.prefix + "sequence"]),
      ) || 0
    if (cursor === undefined) return { events: [], cursor: latest }
    if (cursor > latest) throw new Error("CURSOR_INVALID")
    const ids = await this.command<string[]>([
      "ZRANGEBYSCORE",
      this.prefix + "index",
      `(${cursor}`,
      "+inf",
      "LIMIT",
      0,
      100,
    ])
    if (!ids.length) return { events: [], cursor: latest }
    const raw = await this.command<(string | null)[]>([
      "MGET",
      ...ids.map((id) => this.prefix + id),
    ])
    const events = raw.flatMap((item) => {
      if (!item) return []
      const record = JSON.parse(item) as {
        event: string
        sequence: number
      }
      return [{ ...(JSON.parse(record.event) as PaymentNotification), sequence: record.sequence }]
    })
    // IDs encode no cursor: use the index score, including expired events, to advance safely.
    const next = Number(
      await this.command<string>([
        "ZSCORE",
        this.prefix + "index",
        ids.at(-1)!,
      ]),
    )
    return { events, cursor: Math.max(cursor, next || cursor) }
  }
  async transition(
    id: string,
    operation: "reserve" | "release" | "consume",
    owner: string,
    now: number,
    qr = 0,
    commitId = "",
  ) {
    return (
      (await this.command<number>([
        "EVAL",
        transitionScript,
        1,
        this.prefix + id,
        operation,
        owner,
        now,
        qr,
        commitId,
      ])) === 1
    )
  }
  async limit(key: string, maximum: number, seconds: number) {
    return (
      (await this.command<number>([
        "EVAL",
        limitScript,
        1,
        this.prefix + "limit:" + key,
        maximum,
        seconds,
      ])) === 1
    )
  }
}
