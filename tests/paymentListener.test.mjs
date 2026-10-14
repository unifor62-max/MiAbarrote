import assert from "node:assert/strict"
import { test } from "node:test"
import { PaymentWebhookListener } from "../src/features/payments/PaymentWebhookListener.ts"
import { MemoryStorage } from "./helpers/paymentStore.mjs"

const pause = () => new Promise((resolve) => setImmediate(resolve))
const demoOptions = () => ({
  mode: "demo",
  target: new EventTarget(),
  storage: new MemoryStorage(),
  channelFactory: () => null,
  lock: async (_name, callback) => callback(),
})
const cloudEvent = {
  id: "a".repeat(64),
  titular: "Ana",
  montoCentavos: 15050,
  timestamp: new Date().toISOString(),
  receivedAt: Date.now(),
  source: "cloud",
  sequence: 1,
}

test("native fetch keeps its global receiver for connection, polling and reservations; pasted keys trim outer whitespace", async (t) => {
  const requests = []
  t.mock.method(globalThis, "fetch", async function (path, options) {
    assert.equal(this, globalThis, "Native browser fetch rejects a listener instance as receiver")
    requests.push({ path, options })
    return Response.json({ ok: true, serverNow: Date.now(), cursor: 0, events: [] })
  })
  const listener = new PaymentWebhookListener({ mode: "cloud", target: new EventTarget() })
  try {
    await listener.connect("  clave-copiada-desde-bloc-de-notas\r\n")
    assert.deepEqual(JSON.parse(requests[0].options.body), { clave: "clave-copiada-desde-bloc-de-notas" })
    assert.equal(requests[0].options.credentials, "same-origin")
    listener.start()
    await pause()
    assert.equal(listener.getStatus().connected, true)
    await listener.transition(cloudEvent, "reserve", "sale-owner")
    assert.deepEqual(requests.map(({ path }) => path), ["/api/pagos-sesion", "/api/webhook-pago", "/api/pagos-estado"])
  } finally {
    listener.stop()
  }
})

test("demo delivers custom events once, validates payloads and cleans up listeners", () => {
  const options = demoOptions()
  const listener = new PaymentWebhookListener(options)
  const received = []
  const unsubscribe = listener.subscribe((event) => received.push(event))
  listener.start()
  const id = listener.simulate("Ana", 150.5)
  assert.equal(received.length, 1)
  assert.equal(received[0].montoCentavos, 15050)
  options.target.dispatchEvent(
    new CustomEvent("miabarrote:payment", { detail: received[0] }),
  )
  assert.equal(received.length, 1)
  for (const override of [
    { montoCentavos: -1 },
    { source: "cloud" },
    { timestamp: "invalid" },
    { receivedAt: Date.now() + 100000 },
  ])
    options.target.dispatchEvent(
      new CustomEvent("miabarrote:payment", {
        detail: { ...received[0], id: crypto.randomUUID(), ...override },
      }),
    )
  assert.equal(received.length, 1)
  unsubscribe()
  listener.simulate("Another", 1)
  assert.equal(received.length, 1)
  listener.stop()
  assert.throws(() => listener.simulate("Ana", 1), /deshabilitada/)
  assert.ok(id)
})

test("BroadcastChannel delivers local payments without rebroadcasting and closes on stop", () => {
  let channel
  const options = demoOptions()
  options.channelFactory = () =>
    (channel = {
      onmessage: null,
      closed: false,
      sends: 0,
      postMessage() {
        this.sends++
      },
      close() {
        this.closed = true
      },
    })
  const listener = new PaymentWebhookListener(options)
  const received = []
  listener.subscribe((event) => received.push(event))
  listener.start()
  listener.simulate("Ana", 10)
  assert.equal(channel.sends, 1)
  channel.onmessage({ data: received[0] })
  assert.equal(received.length, 1)
  channel.onmessage({ data: { ...received[0], id: crypto.randomUUID() } })
  assert.equal(received.length, 2)
  assert.equal(channel.sends, 1)
  listener.stop()
  assert.equal(channel.closed, true)
})

test("shared demo storage prevents competing reservations, permits release and consumes idempotently", async () => {
  const options = demoOptions()
  const first = new PaymentWebhookListener(options)
  const second = new PaymentWebhookListener(options)
  let event
  first.subscribe((value) => (event = value))
  first.start()
  first.simulate("Ana", 10)
  await first.transition(event, "reserve", "first")
  await assert.rejects(
    () => second.transition(event, "reserve", "second"),
    /reservado/,
  )
  await first.transition(event, "release", "first")
  await second.transition(event, "reserve", "second")
  await second.transition(event, "consume", "second", "commit1")
  await second.transition(event, "consume", "second", "commit1")
  await assert.rejects(
    () => second.transition(event, "consume", "second", "commit2"),
    /utilizado/,
  )
  await assert.rejects(
    () => first.transition(event, "reserve", "first"),
    /utilizado/,
  )
  first.stop()
})

test("polling uses baseline cursor, deduplicates and keeps cursor through exponential reconnect", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const requests = []
  let outage = false
  const listener = new PaymentWebhookListener({
    mode: "cloud",
    target: new EventTarget(),
    fetcher: async (url, init) => {
      requests.push({ url, init })
      if (outage)
        return Response.json({ error: "Buzón temporalmente caído" }, {
          status: 503,
        })
      if (url === "/api/webhook-pago")
        return Response.json({ cursor: 0, events: [], serverNow: Date.now() })
      return Response.json({
        cursor: 1,
        events: [cloudEvent],
        serverNow: Date.now(),
      })
    },
  })
  const received = []
  listener.subscribe((event) => received.push(event))
  listener.start()
  await pause()
  assert.equal(requests.length, 1)
  t.mock.timers.tick(2000)
  await pause()
  assert.equal(requests[1].url, "/api/webhook-pago?cursor=0")
  assert.equal(received.length, 1)
  outage = true
  t.mock.timers.tick(2000)
  await pause()
  assert.equal(requests[2].url, "/api/webhook-pago?cursor=1")
  assert.equal(listener.getStatus().connected, false)
  t.mock.timers.tick(3999)
  await pause()
  assert.equal(requests.length, 3)
  outage = false
  t.mock.timers.tick(1)
  await pause()
  assert.equal(requests[3].url, "/api/webhook-pago?cursor=1")
  assert.equal(received.length, 1)
  assert.equal(listener.getStatus().connected, true)
  listener.stop()
  t.mock.timers.tick(30000)
  await pause()
  assert.equal(requests.length, 4)
  assert.ok(
    requests.every(
      ({ init }) =>
        init.credentials === "same-origin" && init.cache === "no-store",
    ),
  )
})

test("slow polling never overlaps and late responses after stop are discarded", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let resolve
  let calls = 0
  const listener = new PaymentWebhookListener({
    mode: "cloud",
    target: new EventTarget(),
    fetcher: () => {
      calls++
      return new Promise((done) => (resolve = done))
    },
  })
  const received = []
  listener.subscribe((event) => received.push(event))
  listener.start()
  t.mock.timers.tick(50000)
  await pause()
  assert.equal(calls, 1)
  listener.stop()
  resolve(
    Response.json({ cursor: 1, events: [cloudEvent], serverNow: Date.now() }),
  )
  await pause()
  assert.equal(received.length, 0)
  assert.throws(() => listener.simulate("Ana", 1), /deshabilitada/)
})

test("authentication expiration stops polling until reconnect and cloud ignores local simulation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let authorized = false
  const calls = []
  const target = new EventTarget()
  const listener = new PaymentWebhookListener({
    mode: "cloud",
    target,
    fetcher: async (url, init) => {
      calls.push(url)
      if (url === "/api/pagos-sesion") {
        authorized = true
        assert.equal(JSON.parse(init.body).clave, "synthetic-key")
        return Response.json({ connected: true, serverNow: Date.now() })
      }
      if (!authorized)
        return Response.json({ error: "Conecta la caja" }, { status: 401 })
      return Response.json({ cursor: 0, events: [], serverNow: Date.now() })
    },
  })
  const received = []
  listener.subscribe((event) => received.push(event))
  listener.start()
  await pause()
  assert.equal(listener.getStatus().connected, false)
  t.mock.timers.tick(30000)
  await pause()
  assert.equal(calls.length, 1)
  await listener.connect("synthetic-key")
  assert.equal(listener.getStatus().connected, true)
  target.dispatchEvent(
    new CustomEvent("miabarrote:payment", {
      detail: { ...cloudEvent, source: "demo" },
    }),
  )
  assert.equal(received.length, 0)
  listener.stop()
})
