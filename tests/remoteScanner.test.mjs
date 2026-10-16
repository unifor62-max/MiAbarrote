import test from "node:test"
import assert from "node:assert/strict"
import { createScannerApi, scannerApiFromEnv } from "../server/scannerApi.ts"
import { DesktopScanner } from "../src/features/scanner/DesktopScanner.ts"
import { PhoneScanner } from "../src/features/scanner/PhoneScanner.ts"
import { scannerRequest, validScannerCode } from "../src/data/remoteScanner.ts"
import { LuaScannerStore } from "./helpers/scannerStore.mjs"
import { MemoryStorage } from "./helpers/paymentStore.mjs"

const origin = "https://shop.example"
function fixture() {
  const store = new LuaScannerStore()
  let now = Date.now()
  const api = createScannerApi(store, () => now)
  async function send(route, session, body, headers = {}, eventId) {
    const query = new URLSearchParams(
      session ? { sessionId: session.sessionId } : {},
    )
    if (eventId) query.set("eventId", eventId)
    return api(
      new Request(`${origin}/api/lector-${route}?${query}`, {
        method: body ? "POST" : "GET",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          ...(session ? { Authorization: "Bearer " + session.token } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      "lector-" + route,
      "test-ip",
    )
  }
  const request = async (route, credentials, body, options = {}) => {
    const response = await send(route, credentials, body, {}, options.eventId)
    const result = await response.json()
    if (!response.ok) {
      const { ScannerApiError } = await import("../src/data/remoteScanner.ts")
      throw new ScannerApiError(result.error, response.status)
    }
    return result
  }
  const setup = async () => {
    const owner = await request("sesion", undefined, { operation: "create" })
    const phone = { sessionId: owner.sessionId, token: "a".repeat(64) }
    await request("sesion", phone, {
      operation: "pair",
      pair: owner.pair,
      sender: phone.token,
    })
    const target = { id: crypto.randomUUID(), kind: "sale" }
    await request("sesion", owner, {
      operation: "heartbeat",
      version: 1,
      target,
    })
    return { owner, phone, target }
  }
  return {
    store,
    send,
    request,
    setup,
    advance(ms) {
      now += ms
    },
  }
}
const flush = async () => {
  for (let i = 0; i < 6; i++)
    await new Promise((resolve) => setImmediate(resolve))
}

test("atomic mailbox pairs one phone, deduplicates scans and only confirms after laptop acknowledgement", async () => {
  const f = fixture(),
    { owner, phone, target } = await f.setup()
  assert.equal(
    (
      await f.send("sesion", phone, {
        operation: "pair",
        pair: owner.pair,
        sender: "b".repeat(64),
      })
    ).status,
    409,
  )
  const scan = {
    id: crypto.randomUUID(),
    contextId: target.id,
    code: "0001234567890",
  }
  assert.equal(
    (await f.send("eventos", phone, { operation: "scan", scan })).status,
    202,
  )
  assert.equal(
    (await f.send("eventos", phone, { operation: "scan", scan })).status,
    200,
  )
  const state = await f.request("eventos", phone, undefined, {
    eventId: scan.id,
  })
  assert.equal(state.result, undefined)
  assert.equal((await f.request("eventos", owner)).pending.code, scan.code)
  const result = {
    ...scan,
    outcome: "selected",
    message: "Producto seleccionado",
  }
  await f.request("eventos", owner, { operation: "result", result })
  assert.deepEqual(
    (await f.request("eventos", phone, undefined, { eventId: scan.id })).result,
    result,
  )
  assert.deepEqual(
    (await f.request("eventos", phone, { operation: "scan", scan })).result,
    result,
  )
  assert.equal(
    (
      await f.send("eventos", phone, {
        operation: "scan",
        scan: { ...scan, code: "another" },
      })
    ).status,
    409,
  )
})

test("stale targets, out-of-order updates, heartbeat loss and closing prevent delivery to later operations", async () => {
  const f = fixture(),
    { owner, phone, target } = await f.setup()
  const scan = {
    id: crypto.randomUUID(),
    contextId: target.id,
    code: "DEMO-000001",
  }
  await f.request("eventos", phone, { operation: "scan", scan })
  await f.request("sesion", owner, {
    operation: "heartbeat",
    version: 3,
    target: null,
  })
  assert.equal(
    (await f.request("eventos", phone, undefined, { eventId: scan.id })).result
      .outcome,
    "paused",
  )
  await f.request("sesion", owner, {
    operation: "heartbeat",
    version: 2,
    target,
  })
  assert.equal((await f.request("eventos", phone)).accepting, false)
  const next = { id: crypto.randomUUID(), kind: "purchase" }
  await f.request("sesion", owner, {
    operation: "heartbeat",
    version: 4,
    target: next,
  })
  assert.equal(
    (
      await f.send("eventos", phone, {
        operation: "scan",
        scan: { ...scan, id: crypto.randomUUID() },
      })
    ).status,
    409,
  )
  f.advance(30001)
  assert.equal(
    (
      await f.send("eventos", phone, {
        operation: "scan",
        scan: { ...scan, id: crypto.randomUUID(), contextId: next.id },
      })
    ).status,
    409,
  )
  f.advance(30000)
  assert.equal((await f.send("eventos", phone)).status, 410)
})

test("QR expires while laptop remains alive; invalid credentials, foreign origins, payloads and Redis failure are rejected", async () => {
  const f = fixture(),
    owner = await f.request("sesion", undefined, { operation: "create" })
  for (let i = 1; i <= 9; i++) {
    f.advance(15000)
    await f.request("sesion", owner, {
      operation: "heartbeat",
      version: i,
      target: null,
    })
  }
  assert.equal(
    (
      await f.send("sesion", owner, {
        operation: "pair",
        pair: owner.pair,
        sender: "a".repeat(64),
      })
    ).status,
    410,
  )
  assert.equal(
    (
      await f.send(
        "sesion",
        owner,
        { operation: "heartbeat", version: 10, target: null },
        { Origin: "https://other.example" },
      )
    ).status,
    403,
  )
  assert.equal(
    (await f.send("eventos", { ...owner, token: "b".repeat(64) })).status,
    401,
  )
  assert.equal(
    (
      await f.send("eventos", owner, {
        operation: "scan",
        scan: {
          id: crypto.randomUUID(),
          contextId: crypto.randomUUID(),
          code: "x".repeat(129),
        },
      })
    ).status,
    400,
  )
  f.store.unavailable = true
  assert.equal((await f.send("eventos", owner)).status, 503)
  assert.equal(
    (await scannerApiFromEnv({})(new Request(origin), "lector-sesion")).status,
    503,
  )
})

test("permissions separate phone and laptop; session close is immediate and creation is rate limited", async () => {
  const f = fixture(),
    { owner, phone, target } = await f.setup()
  assert.equal(
    (
      await f.send("sesion", phone, {
        operation: "heartbeat",
        version: 2,
        target,
      })
    ).status,
    403,
  )
  assert.equal(
    (
      await f.send("eventos", owner, {
        operation: "scan",
        scan: { id: crypto.randomUUID(), contextId: target.id, code: "123" },
      })
    ).status,
    403,
  )
  await f.request("sesion", phone, { operation: "close" })
  assert.equal((await f.send("eventos", owner)).status, 410)
  for (let i = 0; i < 28; i++)
    await f.request("sesion", undefined, { operation: "create" })
  assert.equal(
    (await f.send("sesion", undefined, { operation: "create" })).status,
    429,
  )
})

test("desktop and phone perform a complete scan with actual Lua and preserve selection on lost acknowledgement", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const previousWindow = globalThis.window
  globalThis.window = { location: { origin } }
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  })
  const f = fixture()
  let failReceipt = true,
    applications = 0
  const desktop = new DesktopScanner(async (...args) => {
    if (args[2]?.operation === "result" && failReceipt) {
      failReceipt = false
      throw Error("Response lost")
    }
    return f.request(...args)
  })
  desktop.setConsumer({
    target: { id: crypto.randomUUID(), kind: "sale" },
    read: (scan) => {
      applications++
      return { ...scan, outcome: "selected", message: "Producto seleccionado" }
    },
  })
  const phone = new PhoneScanner(new MemoryStorage(), f.request)
  try {
    await desktop.link()
    await flush()
    phone.start(new URL(desktop.getSnapshot().url).hash)
    await flush()
    assert.equal(phone.getSnapshot().accepting, true)
    phone.scan("DEMO-000001")
    await flush()
    assert.equal(phone.getSnapshot().result, null)
    t.mock.timers.tick(1000)
    await flush()
    assert.equal(applications, 1)
    for (let i = 0; i < 3; i++) {
      t.mock.timers.tick(2000)
      await flush()
    }
    assert.equal(applications, 1)
    assert.equal(phone.getSnapshot().result.outcome, "selected")
    phone.scan("DEMO-000001")
    await flush()
    assert.equal(phone.getSnapshot().busy, false)
    desktop.setConsumer(null)
    await flush()
    t.mock.timers.tick(2000)
    await flush()
    assert.equal(phone.getSnapshot().accepting, false)
  } finally {
    phone.stop()
    await desktop.disconnect()
  }
})

test("request wrapper preserves global fetch receiver and code validation preserves leading zeros", async (t) => {
  t.mock.method(globalThis, "fetch", async function (path, options) {
    assert.equal(this, globalThis)
    assert.equal(options.cache, "no-store")
    return Response.json({ ok: true })
  })
  assert.deepEqual(
    await scannerRequest("sesion", undefined, { operation: "create" }),
    { ok: true },
  )
  assert.equal(validScannerCode("0000123456789"), true)
  for (const code of ["", " 123", "x".repeat(129), "123\n"])
    assert.equal(validScannerCode(code), false)
})

test("receipts remain idempotent after more than fifty scans and expire with the session", async () => {
  const f = fixture(),
    { owner, phone, target } = await f.setup()
  let first
  for (let i = 0; i < 55; i++) {
    const scan = {
      id: crypto.randomUUID(),
      contextId: target.id,
      code: "000" + i,
    }
    first ??= scan
    await f.request("eventos", phone, { operation: "scan", scan })
    await f.request("eventos", owner, {
      operation: "result",
      result: { ...scan, outcome: "selected", message: "Seleccionado" },
    })
  }
  f.advance(45000)
  await f.request("sesion", owner, {
    operation: "heartbeat",
    version: 2,
    target,
  })
  f.advance(20000)
  assert.equal(
    (await f.request("eventos", phone, { operation: "scan", scan: first }))
      .result.id,
    first.id,
  )
  assert.equal((await f.request("eventos", owner)).pending, null)
  await f.request("sesion", owner, { operation: "close" })
  assert.equal(f.store.values.has("receipts:" + owner.sessionId), false)
})

test("phone restores the same pending identifier after a lost response and never overlaps requests", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const f = fixture(),
    { owner, phone: credentials, target } = await f.setup(),
    storage = new MemoryStorage()
  storage.setItem("miabarrote:phone-reader", JSON.stringify({ credentials }))
  let active = 0,
    maxActive = 0,
    lose = true,
    scanId
  const request = async (...args) => {
    active++
    maxActive = Math.max(maxActive, active)
    try {
      const result = await f.request(...args)
      if (args[2]?.operation === "scan") {
        if (scanId) assert.equal(args[2].scan.id, scanId)
        scanId = args[2].scan.id
        if (lose) {
          lose = false
          throw Error("Accepted, response lost")
        }
      }
      return result
    } finally {
      active--
    }
  }
  const first = new PhoneScanner(storage, request)
  first.start()
  await flush()
  first.scan("0123456789012")
  first.scan("another")
  await flush()
  t.mock.timers.tick(30000)
  await flush()
  assert.ok(scanId)
  assert.equal(first.getSnapshot().accepting, true)
  assert.equal(first.getSnapshot().result, null)
  first.stop()
  const restored = new PhoneScanner(storage, request)
  try {
    restored.start()
    await flush()
    const pending = (await f.request("eventos", owner)).pending
    assert.equal(pending.id, scanId)
    await f.request("eventos", owner, {
      operation: "result",
      result: { ...pending, outcome: "unknown", message: "Código desconocido" },
    })
    t.mock.timers.tick(2000)
    await flush()
    assert.equal(restored.getSnapshot().result.outcome, "unknown")
    restored.scan(pending.code)
    await flush()
    // Reload can reset the camera latch; after confirmation, holding the same code is suppressed.
    t.mock.timers.tick(2000)
    await flush()
    restored.scan(pending.code)
    await flush()
    assert.equal(maxActive, 1)
  } finally {
    restored.stop()
    await f.request("sesion", owner, { operation: "close" })
  }
})

test("rapid link clicks create one session; disconnect cancels creation and stale work", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const previousWindow = globalThis.window
  globalThis.window = { location: { origin } }
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  })
  let creates = 0,
    release
  const wait = new Promise((resolve) => {
    release = resolve
  })
  const desktop = new DesktopScanner(async (route, credentials, body) => {
    if (body?.operation === "create") {
      creates++
      await wait
      return {
        sessionId: crypto.randomUUID(),
        token: "a".repeat(64),
        pair: "b".repeat(64),
        pairUntil: Date.now() + 120000,
      }
    }
    return { paired: false, accepting: false, target: null }
  })
  const linking = desktop.link()
  await desktop.link()
  await flush()
  assert.equal(creates, 1)
  await desktop.disconnect()
  release()
  await linking
  assert.equal(desktop.getSnapshot().url, "")
})
