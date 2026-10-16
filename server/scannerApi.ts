import { createHash, randomBytes, randomUUID } from "node:crypto"
import { validScannerCode, validScannerId } from "../src/data/remoteScanner.ts"
import { RedisScannerStore, type ScannerStore } from "./scannerStore.ts"
export type ScannerRoute = "lector-sesion" | "lector-eventos"
interface TargetInput {
  id?: unknown
  kind?: unknown
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex")
const validToken = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  })
export function createScannerApi(store: ScannerStore, clock = Date.now) {
  return async (
    request: Request,
    route: ScannerRoute,
    clientIp = "unknown",
  ) => {
    try {
      if (!["GET", "POST"].includes(request.method))
        return json({ error: "Método no permitido." }, 405)
      const url = new URL(request.url)
      let data: Record<string, unknown> = {}
      if (request.method === "POST") {
        if (request.headers.get("origin") !== url.origin)
          return json({ error: "Origen no autorizado." }, 403)
        if (
          !request.headers
            .get("content-type")
            ?.toLowerCase()
            .startsWith("application/json")
        )
          return json({ error: "Usa application/json." }, 415)
        const reader = request.body?.getReader()
        if (!reader) return json({ error: "JSON inválido." }, 400)
        const chunks: Uint8Array[] = []
        let size = 0
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.length
          if (size > 8192) {
            await reader.cancel()
            return json({ error: "El cuerpo excede 8 KB." }, 413)
          }
          chunks.push(value)
        }
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString())
          if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
            throw Error()
          data = parsed
        } catch {
          return json({ error: "JSON inválido." }, 400)
        }
      }
      const op = request.method === "GET" ? "state" : data.operation
      const common = { now: clock(), client: hash(clientIp) }
      if (op === "create" && route === "lector-sesion") {
        const id = randomUUID(),
          token = randomBytes(32).toString("hex"),
          pair = randomBytes(32).toString("hex")
        const result = await store.run(id, "create", {
          ...common,
          owner: hash(token),
          pair: hash(pair),
        })
        return result.status === 201
          ? json(
              { sessionId: id, token, pair, pairUntil: common.now + 120000 },
              201,
            )
          : json(result.body, result.status)
      }
      const id = url.searchParams.get("sessionId")
      if (!validScannerId(id)) return json({ error: "Sesión inválida." }, 400)
      if (op === "pair" && route === "lector-sesion") {
        if (!validToken(data.pair) || !validToken(data.sender))
          return json({ error: "QR inválido." }, 400)
        const result = await store.run(id, "pair", {
          ...common,
          pair: hash(data.pair),
          sender: hash(data.sender),
        })
        return json(result.body, result.status)
      }
      const token = request.headers
        .get("authorization")
        ?.replace(/^Bearer /, "")
      if (!validToken(token))
        return json({ error: "Vinculación no autorizada." }, 401)
      const input: Record<string, unknown> = { ...common, token: hash(token) }
      if (op === "heartbeat" && route === "lector-sesion") {
        const target = data.target as TargetInput | null
        if (
          !Number.isSafeInteger(data.version) ||
          Number(data.version) < 0 ||
          (target !== null &&
            (!target ||
              !validScannerId(target.id) ||
              !["sale", "purchase"].includes(String(target.kind))))
        )
          return json({ error: "Contexto inválido." }, 400)
        input.target =
          target === null ? null : { id: target.id, kind: target.kind }
        input.version = data.version
      } else if (
        (op === "scan" || op === "result") &&
        route === "lector-eventos"
      ) {
        const item = data[op] as Record<string, unknown> | undefined
        if (
          !item ||
          !validScannerId(item.id) ||
          !validScannerId(item.contextId) ||
          !validScannerCode(item.code)
        )
          return json({ error: "Lectura inválida." }, 400)
        if (
          op === "result" &&
          (![
            "selected",
            "already-selected",
            "unknown",
            "no-stock",
            "paused",
          ].includes(String(item.outcome)) ||
            typeof item.message !== "string" ||
            item.message.length > 240)
        )
          return json({ error: "Resultado inválido." }, 400)
        input[op] =
          op === "scan"
            ? { id: item.id, contextId: item.contextId, code: item.code }
            : {
                id: item.id,
                contextId: item.contextId,
                code: item.code,
                outcome: item.outcome,
                message: item.message,
              }
      } else if (op === "state") {
        const eventId = url.searchParams.get("eventId")
        if (eventId && !validScannerId(eventId))
          return json({ error: "Lectura inválida." }, 400)
        input.eventId = eventId
      } else if (op !== "close" || route !== "lector-sesion")
        return json({ error: "Operación inválida." }, 400)
      const result = await store.run(id, String(op), input)
      return json(result.body, result.status)
    } catch {
      return json(
        {
          error:
            "El lector no está disponible. Comprueba la conexión e intenta nuevamente.",
        },
        503,
      )
    }
  }
}
export function scannerApiFromEnv(
  env: Record<string, string | undefined> = process.env,
) {
  if (
    !env.UPSTASH_REDIS_REST_URL?.startsWith("https://") ||
    !env.UPSTASH_REDIS_REST_TOKEN
  )
    return async () =>
      json({ error: "Configura Redis para vincular el teléfono." }, 503)
  return createScannerApi(
    new RedisScannerStore(
      env.UPSTASH_REDIS_REST_URL,
      env.UPSTASH_REDIS_REST_TOKEN,
      env.PAYMENT_NAMESPACE ?? "miabarrote",
    ),
  )
}
