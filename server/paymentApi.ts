import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto"
import {
  normalizePaymentPayload,
  type PaymentNotification,
} from "../src/data/payments.ts"
import { RedisPaymentStore, type PaymentStore } from "./paymentStore.ts"

export interface PaymentConfig {
  webhookKey: string
  readerKey: string
  sessionSecret: string
}
export type PaymentRoute = "webhook-pago" | "pagos-sesion" | "pagos-estado"
const sessionSeconds = 8 * 60 * 60
const cookieName = "miabarrote_payments"
const hash = (text: string) => createHash("sha256").update(text).digest("hex")
function equal(a: string, b: string) {
  return timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)))
}
function signature(value: string, key: string) {
  return createHmac("sha256", key).update(value).digest("base64url")
}
function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  })
}
async function readBody(request: Request) {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new Error("CONTENT_TYPE")
  const reader = request.body?.getReader()
  if (!reader) throw new Error("JSON_INVALID")
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > 8192) {
      await reader.cancel()
      throw new Error("BODY_LARGE")
    }
    chunks.push(value)
  }
  try {
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("JSON_INVALID")
    return data as Record<string, unknown>
  } catch {
    throw new Error("JSON_INVALID")
  }
}

export function createPaymentApi(
  config: PaymentConfig,
  store: PaymentStore,
  clock = Date.now,
) {
  function session(request: Request) {
    const cookie = request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1)
    if (!cookie) return null
    const [value, signed, extra] = cookie.split(".")
    if (
      !value ||
      !signed ||
      extra ||
      !equal(signed, signature(value, config.sessionSecret))
    )
      return null
    try {
      const data = JSON.parse(Buffer.from(value, "base64url").toString()) as {
        id: string
        exp: number
      }
      return typeof data.id === "string" &&
        Number.isFinite(data.exp) &&
        data.exp > clock()
        ? data.id
        : null
    } catch {
      return null
    }
  }
  return async function handle(
    request: Request,
    route: PaymentRoute,
    clientIp = "unknown",
  ): Promise<Response> {
    try {
      if (
        [config.webhookKey, config.readerKey, config.sessionSecret].some(
          (key) => key.length < 32,
        ) ||
        new Set(
          [config.webhookKey, config.readerKey, config.sessionSecret].map(hash),
        ).size !== 3
      )
        return json(
          { error: "Configura las claves privadas de pagos en el servidor." },
          503,
        )
      if (request.method !== "GET" && request.method !== "POST")
        return json({ error: "Método no permitido." }, 405, {
          Allow: route === "webhook-pago" ? "GET, POST" : "POST",
        })
      if (route === "pagos-sesion") {
        if (request.method !== "POST")
          return json({ error: "Método no permitido." }, 405, { Allow: "POST" })
        if (request.headers.get("origin") !== new URL(request.url).origin)
          return json({ error: "Origen no autorizado." }, 403)
        if (
          !(await store.limit("auth-global", 60, 600)) ||
          !(await store.limit("auth-" + hash(clientIp), 10, 600))
        )
          return json(
            {
              error: "Demasiados intentos. Intenta nuevamente en diez minutos.",
            },
            429,
            { "Retry-After": "600" },
          )
        const data = await readBody(request)
        if (
          typeof data.clave !== "string" ||
          !equal(data.clave, config.readerKey)
        )
          return json({ error: "Clave de caja incorrecta." }, 401)
        const value = Buffer.from(
          JSON.stringify({
            id: randomUUID(),
            exp: clock() + sessionSeconds * 1000,
          }),
        ).toString("base64url")
        return json({ connected: true, serverNow: clock() }, 200, {
          "Set-Cookie": `${cookieName}=${value}.${signature(value, config.sessionSecret)}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${sessionSeconds}`,
        })
      }
      if (route === "webhook-pago" && request.method === "POST") {
        if (
          !equal(
            request.headers.get("authorization") ?? "",
            `Bearer ${config.webhookKey}`,
          )
        )
          return json({ error: "No autorizado." }, 401)
        if (!(await store.limit("webhook", 120, 60)))
          return json({ error: "Demasiadas notificaciones." }, 429, {
            "Retry-After": "60",
          })
        let payload
        try {
          payload = normalizePaymentPayload(await readBody(request))
        } catch (error) {
          if (
            error instanceof Error &&
            ["BODY_LARGE", "CONTENT_TYPE", "JSON_INVALID"].includes(
              error.message,
            )
          )
            throw error
          return json(
            {
              error: error instanceof Error ? error.message : "Pago inválido.",
            },
            400,
          )
        }
        const fingerprint = hash(
          JSON.stringify([
            payload.titular,
            payload.montoCentavos,
            payload.timestamp,
          ]),
        )
        const event: PaymentNotification = {
          id: hash(
            payload.externalId
              ? "external:" + payload.externalId
              : "payload:" + fingerprint,
          ),
          titular: payload.titular,
          montoCentavos: payload.montoCentavos,
          timestamp: payload.timestamp,
          receivedAt: clock(),
          source: "cloud",
        }
        const result = await store.insert(event, fingerprint)
        return json(
          { id: result.event.id, duplicate: result.duplicate },
          result.duplicate ? 200 : 201,
        )
      }
      const actor = session(request)
      if (!actor)
        return json({ error: "Conecta la caja para recibir pagos." }, 401)
      if (route === "webhook-pago") {
        const text = new URL(request.url).searchParams.get("cursor")
        if (
          text !== null &&
          (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)))
        )
          return json({ error: "Cursor inválido." }, 400)
        const result = await store.list(
          text === null ? undefined : Number(text),
        )
        return json({ ...result, serverNow: clock() })
      }
      if (request.method !== "POST")
        return json({ error: "Método no permitido." }, 405, { Allow: "POST" })
      if (request.headers.get("origin") !== new URL(request.url).origin)
        return json({ error: "Origen no autorizado." }, 403)
      const data = await readBody(request)
      if (
        typeof data.id !== "string" ||
        !/^[a-f0-9]{64}$/.test(data.id) ||
        typeof data.owner !== "string" ||
        !/^[\w-]{16,80}$/.test(data.owner) ||
        !["reserve", "release", "consume"].includes(String(data.operation))
      )
        return json({ error: "Operación de pago inválida." }, 400)
      if (
        data.operation === "consume" &&
        (!Number.isSafeInteger(data.qr) ||
          Number(data.qr) <= 0 ||
          typeof data.commitId !== "string" ||
          !/^[\w-]{16,80}$/.test(data.commitId))
      )
        return json({ error: "Confirmación de pago inválida." }, 400)
      const success = await store.transition(
        data.id,
        data.operation as "reserve" | "release" | "consume",
        actor + ":" + data.owner,
        clock(),
        Number(data.qr) || 0,
        String(data.commitId ?? ""),
      )
      return success
        ? json({ ok: true })
        : json(
            {
              error:
                "El pago expiró, está reservado por otra venta o ya fue utilizado.",
            },
            409,
          )
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (message === "BODY_LARGE")
        return json({ error: "El cuerpo excede 8 KB." }, 413)
      if (message === "CONTENT_TYPE")
        return json({ error: "Usa Content-Type: application/json." }, 415)
      if (message === "JSON_INVALID")
        return json({ error: "JSON inválido." }, 400)
      if (message === "ID_CONFLICT")
        return json({ error: "El id ya pertenece a otra notificación." }, 409)
      if (message === "CURSOR_INVALID")
        return json({ error: "Cursor inválido. Reconecta los pagos." }, 409)
      return json(
        { error: "El buzón de pagos no está disponible. Intenta nuevamente." },
        503,
      )
    }
  }
}

export function paymentApiFromEnv(
  env: Record<string, string | undefined> = process.env,
) {
  const url = env.UPSTASH_REDIS_REST_URL ?? ""
  if (!url.startsWith("https://"))
    return async () =>
      json({ error: "Configura el buzón Redis de pagos." }, 503)
  const store = new RedisPaymentStore(
    url,
    env.UPSTASH_REDIS_REST_TOKEN ?? "",
    env.PAYMENT_NAMESPACE ?? "miabarrote",
  )
  return createPaymentApi(
    {
      webhookKey: env.PAYMENT_WEBHOOK_KEY ?? "",
      readerKey: env.PAYMENT_READER_KEY ?? "",
      sessionSecret: env.PAYMENT_SESSION_SECRET ?? "",
    },
    store,
  )
}
