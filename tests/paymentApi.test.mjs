import assert from "node:assert/strict"
import { test } from "node:test"
import { createPaymentApi, paymentApiFromEnv } from "../server/paymentApi.ts"
import {
  RedisPaymentStore,
  insertScript,
  transitionScript,
  limitScript,
} from "../server/paymentStore.ts"
import { MemoryPaymentStore } from "./helpers/paymentStore.mjs"

const config = {
  webhookKey: "webhook-test-key-".repeat(3),
  readerKey: "reader-test-key-".repeat(3),
  sessionSecret: "session-test-key-".repeat(3),
}
const origin = "https://shop.example"

test("prototype session needs no cashier key, preserves valid sessions and still rejects other origins and unsigned webhooks", async () => {
  const store = new MemoryPaymentStore()
  const api = createPaymentApi({ ...config, readerKey: "", automaticSession: true }, store)
  const makeRequest = (headers = {}) => new Request(origin + "/api/pagos-sesion", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...headers }, body: "{}",
  })
  assert.equal((await api(makeRequest({ Origin: "https://other.example" }), "pagos-sesion")).status, 403)
  const response = await api(makeRequest(), "pagos-sesion")
  assert.equal(response.status, 200)
  const cookie = response.headers.get("set-cookie")
  assert.ok(cookie.includes("HttpOnly; Secure; SameSite=Strict"))
  const renewed = await api(makeRequest({ Cookie: cookie }), "pagos-sesion")
  const sessionId = value => JSON.parse(Buffer.from(value.split("=")[1].split(".")[0], "base64url").toString()).id
  assert.equal(sessionId(cookie), sessionId(renewed.headers.get("set-cookie")))
  const unsigned = await api(new Request(origin + "/api/webhook-pago", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), "webhook-pago")
  assert.equal(unsigned.status, 401)
})

test("environment adapter enables automatic sessions without PAYMENT_READER_KEY", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ result: 1 }))
  const api = paymentApiFromEnv({ UPSTASH_REDIS_REST_URL: "https://redis.example", UPSTASH_REDIS_REST_TOKEN: "test-token", PAYMENT_WEBHOOK_KEY: config.webhookKey, PAYMENT_SESSION_SECRET: config.sessionSecret })
  const response = await api(new Request(origin + "/api/pagos-sesion", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}" }), "pagos-sesion")
  assert.equal(response.status, 200)
  assert.equal((await response.json()).connected, true)
})
const payload = {
  titular: "Ana Pérez",
  monto: 150.5,
  timestamp: "2026-10-13T21:00:00-04:00",
  id: "bank-1",
}
const request = (
  route,
  body,
  headers = {},
  method = body === undefined ? "GET" : "POST",
) =>
  new Request(`${origin}/api/${route}`, {
    method,
    headers: { "Content-Type": "application/json", Origin: origin, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
function fixture() {
  const store = new MemoryPaymentStore()
  let now = Date.parse(payload.timestamp)
  const api = createPaymentApi(config, store, () => now)
  return {
    store,
    api,
    advance: (ms) => {
      now += ms
    },
  }
}
async function connect(api) {
  const response = await api(
    request("pagos-sesion", { clave: config.readerKey }),
    "pagos-sesion",
  )
  assert.equal(response.status, 200)
  return response.headers.get("set-cookie")
}
async function send(api, body = payload) {
  return api(
    request("webhook-pago", body, {
      Authorization: "Bearer " + config.webhookKey,
    }),
    "webhook-pago",
  )
}

test("protected session uses signed eight-hour cookie, checks origin and limits authentication", async () => {
  const { api, advance } = fixture()
  assert.equal((await api(request("webhook-pago"), "webhook-pago")).status, 401)
  assert.equal(
    (
      await api(
        request("pagos-sesion", { clave: config.readerKey }, {
          Origin: "https://evil.example",
        }),
        "pagos-sesion",
      )
    ).status,
    403,
  )
  const cookie = await connect(api)
  for (const flag of [
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Path=/api",
    "Max-Age=28800",
  ])
    assert.ok(cookie.includes(flag))
  const authorized = await api(
    request("webhook-pago", undefined, { Cookie: cookie }),
    "webhook-pago",
  )
  assert.equal(authorized.status, 200)
  assert.equal(authorized.headers.get("cache-control"), "no-store")
  const forged = cookie.replace("miabarrote_payments=", "miabarrote_payments=x")
  assert.equal(
    (
      await api(
        request("webhook-pago", undefined, { Cookie: forged }),
        "webhook-pago",
      )
    ).status,
    401,
  )
  advance(28800001)
  assert.equal(
    (
      await api(
        request("webhook-pago", undefined, { Cookie: cookie }),
        "webhook-pago",
      )
    ).status,
    401,
  )
  const limited = fixture()
  for (let i = 0; i < 10; i++)
    assert.equal(
      (
        await limited.api(
          request("pagos-sesion", { clave: "wrong" }),
          "pagos-sesion",
        )
      ).status,
      401,
    )
  assert.equal(
    (
      await limited.api(
        request("pagos-sesion", { clave: config.readerKey }),
        "pagos-sesion",
      )
    ).status,
    429,
  )
})

test("webhook enforces authentication and JSON, deduplicates retries and detects ID conflicts", async () => {
  const { api, store } = fixture()
  assert.equal(
    (await api(request("webhook-pago", payload), "webhook-pago")).status,
    401,
  )
  const created = await send(api)
  assert.equal(created.status, 201)
  assert.equal(store.records.size, 1)
  assert.equal([...store.records.values()][0].event.montoCentavos, 15050)
  const duplicate = await send(api)
  assert.equal(duplicate.status, 200)
  assert.equal((await duplicate.json()).duplicate, true)
  assert.equal((await send(api, { ...payload, monto: 1 })).status, 409)
  assert.equal((await send(api, { ...payload, id: undefined })).status, 201)
  assert.equal((await send(api, { ...payload, id: undefined })).status, 200)
  for (const body of [
    { ...payload, monto: "150.50" },
    { ...payload, monto: 1.001 },
    { ...payload, timestamp: "invalid" },
    null,
    [],
  ])
    assert.equal((await send(api, body)).status, 400)
  const headers = { Authorization: "Bearer " + config.webhookKey }
  assert.equal(
    (
      await api(
        new Request(origin + "/api/webhook-pago", {
          method: "POST",
          headers,
          body: "{}",
        }),
        "webhook-pago",
      )
    ).status,
    415,
  )
  assert.equal(
    (await send(api, { ...payload, titular: "x".repeat(9000) })).status,
    413,
  )
  assert.equal(
    (
      await api(
        request("webhook-pago", undefined, {}, "DELETE"),
        "webhook-pago",
      )
    ).status,
    405,
  )
})

test("polling starts at current cursor, orders new notifications and rejects invalid cursors", async () => {
  const { api } = fixture()
  await send(api)
  const cookie = await connect(api)
  const baseline = await (
    await api(
      request("webhook-pago", undefined, { Cookie: cookie }),
      "webhook-pago",
    )
  ).json()
  assert.deepEqual(baseline.events, [])
  assert.equal(baseline.cursor, 1)
  await send(api, { ...payload, id: "bank-2" })
  const result = await (
    await api(
      request("webhook-pago?cursor=1", undefined, { Cookie: cookie }),
      "webhook-pago",
    )
  ).json()
  assert.equal(result.events.length, 1)
  assert.equal(result.events[0].sequence, 2)
  assert.equal(result.cursor, 2)
  for (const cursor of ["-1", "x", "9007199254740992"])
    assert.equal(
      (
        await api(
          request("webhook-pago?cursor=" + cursor, undefined, {
            Cookie: cookie,
          }),
          "webhook-pago",
        )
      ).status,
      400,
    )
  assert.equal(
    (
      await api(
        request("webhook-pago?cursor=999", undefined, { Cookie: cookie }),
        "webhook-pago",
      )
    ).status,
    409,
  )
})

test("reservations exclude competing sales and consumption retries are idempotent with exact amount", async () => {
  const { api, advance } = fixture()
  const id = (await (await send(api)).json()).id
  const cookie = await connect(api)
  const transition = (operation, owner = "owner-000000000001", extra = {}) =>
    api(
      request("pagos-estado", { id, operation, owner, ...extra }, {
        Cookie: cookie,
      }),
      "pagos-estado",
    )
  assert.equal((await transition("reserve")).status, 200)
  assert.equal((await transition("reserve", "owner-000000000002")).status, 409)
  assert.equal(
    (
      await transition("consume", undefined, {
        qr: 1,
        commitId: "commit-00000000001",
      })
    ).status,
    409,
  )
  assert.equal((await transition("release")).status, 200)
  assert.equal((await transition("reserve", "owner-000000000002")).status, 200)
  advance(300001)
  assert.equal((await transition("reserve")).status, 200)
  const body = { qr: 15050, commitId: "commit-00000000001" }
  assert.equal((await transition("consume", undefined, body)).status, 200)
  assert.equal((await transition("consume", undefined, body)).status, 200)
  assert.equal(
    (
      await transition("consume", undefined, {
        ...body,
        commitId: "commit-00000000002",
      })
    ).status,
    409,
  )
  assert.equal((await transition("release")).status, 409)
  assert.equal((await transition("reserve")).status, 409)
  assert.equal(
    (await transition("consume", undefined, { qr: -1, commitId: "bad" }))
      .status,
    400,
  )
})

test("missing configuration and Redis failures fail closed without leaking secrets", async () => {
  const { api, store } = fixture()
  store.unavailable = true
  const response = await send(api)
  assert.equal(response.status, 503)
  assert.ok(!(await response.text()).includes("secret"))
  assert.equal(
    (await paymentApiFromEnv({})(request("webhook-pago"))).status,
    503,
  )
  const weak = createPaymentApi(
    { ...config, readerKey: config.webhookKey },
    new MemoryPaymentStore(),
  )
  assert.equal(
    (await weak(request("webhook-pago"), "webhook-pago")).status,
    503,
  )
})

test("Redis REST transport sends authenticated atomic scripts and preserves cursor over expired events", async () => {
  const calls = []
  const event = {
    id: "a".repeat(64),
    titular: "Ana",
    montoCentavos: Number.MAX_SAFE_INTEGER,
    timestamp: payload.timestamp,
    receivedAt: 1,
    source: "cloud",
    sequence: 2,
  }
  const responses = [
    JSON.stringify({ event: JSON.stringify(event), sequence: event.sequence, duplicate: false }),
    1,
    1,
    "3",
    [event.id, "b".repeat(64)],
    [JSON.stringify({ event: JSON.stringify(event), sequence: event.sequence }), null],
    "3",
  ]
  const store = new RedisPaymentStore(
    "https://redis.example",
    "synthetic-token",
    "tests",
    async (_url, init) => {
      calls.push({ args: JSON.parse(init.body), headers: init.headers })
      return Response.json({ result: responses.shift() })
    },
  )
  assert.equal((await store.insert(event, "fingerprint")).event.sequence, 2)
  assert.equal(
    await store.transition(event.id, "consume", "owner", 1, event.montoCentavos, "commit"),
    true,
  )
  assert.equal(await store.limit("auth", 10, 600), true)
  const listed = await store.list(1)
  assert.equal(listed.cursor, 3)
  assert.deepEqual(listed.events, [event])
  assert.equal(calls[0].args[1], insertScript)
  assert.equal(calls[1].args[1], transitionScript)
  assert.equal(calls[2].args[1], limitScript)
  assert.equal(JSON.parse(calls[0].args[7]).montoCentavos, Number.MAX_SAFE_INTEGER)
  assert.equal(calls[1].args[7], Number.MAX_SAFE_INTEGER)
  assert.ok(
    calls.every(
      (call) => call.headers.Authorization === "Bearer synthetic-token",
    ),
  )
  const failing = new RedisPaymentStore(
    "https://redis.example",
    "token",
    "tests",
    async () => Response.json({ error: "private error" }, { status: 401 }),
  )
  await assert.rejects(() => failing.limit("x", 1, 1), /no está disponible/)
})

test("Vercel and Netlify adapters expose the same fail-closed API contracts", async () => {
  for (const route of ["webhook-pago", "pagos-sesion", "pagos-estado"]) {
    const vercel = await import(`../api/${route}.ts`)
    const netlify = await import(`../netlify/functions/${route}.mts`)
    const a = await vercel.default.fetch(request(route))
    const b = await netlify.default(request(route), {})
    assert.equal(a.status, 503)
    assert.equal(a.status, b.status)
    assert.equal(await a.text(), await b.text())
    assert.equal(netlify.config.path, "/api/" + route)
  }
})
