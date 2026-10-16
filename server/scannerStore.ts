export interface ScannerStore {
  run(id: string, operation: string, input: Record<string, unknown>): Promise<{
    status: number
    body: Record<string, unknown>
  }>
}

interface RedisResult {
  result?: string
  error?: string
}

// A mailbox and its receipt hash share the session TTL and Redis cluster slot.
export const scannerScript = `
local op = ARGV[1]
local a = cjson.decode(ARGV[2])
local function reply(status, body) return cjson.encode({status=status, body=body}) end
local function fail(status, message) return reply(status, {error=message}) end
if op == 'create' or op == 'pair' then
  local count = redis.call('INCR', KEYS[2])
  if count == 1 then redis.call('EXPIRE', KEYS[2], 60) end
  if count > 30 then return fail(429, 'Demasiados intentos. Espera un minuto.') end
end
if op == 'create' then
  local s = {owner=a.owner, pair=a.pair, pairUntil=a.now+120000, heartbeat=a.now, version=0}
  if not redis.call('SET', KEYS[1], cjson.encode(s), 'EX', 60, 'NX') then return fail(409, 'Vuelve a crear la vinculación.') end
  return reply(201, {ok=true})
end
local raw = redis.call('GET', KEYS[1])
if not raw then return fail(410, 'La vinculación terminó. Escanea un nuevo QR en la laptop.') end
local s = cjson.decode(raw)
local owner = a.token == s.owner
local sender = s.sender and a.token == s.sender
local function save() redis.call('SET', KEYS[1], cjson.encode(s), 'KEEPTTL') end
local function active() return s.target and s.target ~= cjson.null and a.now-s.heartbeat <= 30000 end
local function remember(result)
  redis.call('HSET', KEYS[3], result.id, cjson.encode(result))
  redis.call('EXPIRE', KEYS[3], 60)
end
local function state()
  local body = {paired=s.sender ~= nil, accepting=not not active(), target=s.target or cjson.null}
  if owner then body.pending=s.pending or cjson.null end
  if a.eventId then
    local result = redis.call('HGET', KEYS[3], a.eventId)
    if result then body.result=cjson.decode(result) end
  end
  return body
end
if op == 'pair' then
  if a.pair ~= s.pair then return fail(401, 'QR inválido.') end
  if s.sender then
    if s.sender ~= a.sender then return fail(409, 'Ya hay otro teléfono vinculado.') end
    return reply(200, state())
  end
  if a.now > s.pairUntil then return fail(410, 'El QR venció. Genera otro en la laptop.') end
  s.sender=a.sender; save(); return reply(200, state())
end
if not owner and not sender then return fail(401, 'Vinculación no autorizada.') end
if op == 'state' then return reply(200, state()) end
if op == 'close' then redis.call('DEL', KEYS[1]); redis.call('DEL', KEYS[3]); return reply(200, {ok=true}) end
if op == 'heartbeat' then
  if not owner then return fail(403, 'Operación exclusiva de la laptop.') end
  if a.version >= s.version then
    s.version=a.version; s.target=a.target
    if s.pending and (not active() or s.pending.contextId ~= s.target.id) then
      local r=s.pending; r.outcome='paused'; r.message='La operación cambió. Vuelve a escanear.'
      remember(r); s.pending=nil
    end
  end
  s.heartbeat=a.now
  redis.call('SET', KEYS[1], cjson.encode(s), 'EX', 60)
  redis.call('EXPIRE', KEYS[3], 60)
  return reply(200, state())
end
if op == 'scan' then
  if not sender then return fail(403, 'Operación exclusiva del teléfono.') end
  local previous = redis.call('HGET', KEYS[3], a.scan.id)
  if previous then
    local r=cjson.decode(previous)
    if r.code ~= a.scan.code or r.contextId ~= a.scan.contextId then return fail(409, 'Identificador de lectura reutilizado.') end
    return reply(200, {result=r})
  end
  if s.pending and s.pending.id == a.scan.id then
    if s.pending.code ~= a.scan.code or s.pending.contextId ~= a.scan.contextId then return fail(409, 'Identificador de lectura reutilizado.') end
    return reply(200, {pending=true})
  end
  if not active() or a.scan.contextId ~= s.target.id then return fail(409, 'Lector pausado. Abre la selección de productos en la laptop.') end
  if s.pending then return fail(409, 'Espera el resultado de la lectura anterior.') end
  s.pending=a.scan; save(); return reply(202, {pending=true})
end
if op == 'result' then
  if not owner then return fail(403, 'Operación exclusiva de la laptop.') end
  local previous = redis.call('HGET', KEYS[3], a.result.id)
  if previous then
    local r=cjson.decode(previous)
    if r.code ~= a.result.code or r.contextId ~= a.result.contextId then return fail(409, 'Identificador de lectura reutilizado.') end
    return reply(200, {result=r})
  end
  if not s.pending or s.pending.id ~= a.result.id or s.pending.contextId ~= a.result.contextId or s.pending.code ~= a.result.code then return fail(409, 'La lectura ya no está pendiente.') end
  local r=a.result
  if not active() or r.contextId ~= s.target.id then r.outcome='paused'; r.message='La operación cambió. Vuelve a escanear.' end
  remember(r); s.pending=nil; save(); return reply(200, {result=r})
end
return fail(400, 'Operación inválida.')
`

export class RedisScannerStore implements ScannerStore {
  private url: string
  private token: string
  private namespace: string
  private fetcher: typeof fetch
  constructor(
    url: string,
    token: string,
    namespace: string,
    fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    this.url = url
    this.token = token
    this.namespace = namespace
    this.fetcher = fetcher
  }
  async run(id: string, operation: string, input: Record<string, unknown>) {
    const response = await this.fetcher(this.url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + this.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        "EVAL",
        scannerScript,
        3,
        `scanner:{${this.namespace}}:${id}`,
        `scanner:{${this.namespace}}:limit:${input.client}`,
        `scanner:{${this.namespace}}:${id}:receipts`,
        operation,
        JSON.stringify(input),
      ]),
      signal: AbortSignal.timeout(8000),
    })
    const data = (await response.json()) as RedisResult
    if (!response.ok || data.error || typeof data.result !== "string")
      throw new Error("Redis unavailable")
    return JSON.parse(data.result) as {
      status: number
      body: Record<string, unknown>
    }
  }
}
