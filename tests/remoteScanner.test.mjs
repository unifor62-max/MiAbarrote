import test from "node:test"
import assert from "node:assert/strict"
import { DesktopScanner } from "../src/features/scanner/DesktopScanner.ts"
import { PhoneScanner } from "../src/features/scanner/PhoneScanner.ts"
import {
  desktopStorageKey,
  phoneStorageKey,
  SCANNER_LIFETIME,
  validScannerCode,
} from "../src/data/remoteScanner.ts"
import { FakePeerNetwork, MemoryScannerStorage } from "./helpers/peerNetwork.ts"
import { readFile } from "node:fs/promises"

const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 40))
}
async function fixture(t) {
  const network = new FakePeerNetwork()
  const storage = new MemoryScannerStorage()
  let now = Date.now()
  const options = {
    storage,
    clock: () => now,
    createPeer: network.createPeer,
    origin: () => "https://shop.example",
  }
  const desktop = new DesktopScanner(options)
  const phones = []
  let calls = 0
  const target = { id: crypto.randomUUID(), kind: "sale" }
  desktop.setConsumer({
    target,
    read: (scan) => {
      calls++
      return { ...scan, outcome: "selected", message: "Producto seleccionado" }
    },
  })
  await desktop.link()
  await flush()
  function phone(
    link = desktop.getSnapshot().url,
    phoneStorage = new MemoryScannerStorage(),
  ) {
    const reader = new PhoneScanner(phoneStorage, {
      clock: () => now,
      createPeer: network.createPeer,
      retryMs: 1,
    })
    phones.push(reader)
    reader.start(new URL(link).hash)
    return reader
  }
  t.after(() => {
    for (const reader of phones) reader.stop()
    desktop.stop()
  })
  return {
    network,
    storage,
    desktop,
    options,
    phone,
    target,
    advance: (ms) => {
      now += ms
    },
    count: () => calls,
  }
}

test("QR URL contains only fragment credentials, lasts exactly eight hours and is reused", async (t) => {
  const f = await fixture(t)
  const first = f.desktop.getSnapshot()
  const url = new URL(first.url)
  assert.equal(url.pathname, "/lector")
  assert.equal(url.search, "")
  assert.equal(url.hash.includes("token="), true)
  const saved = JSON.parse(f.storage.getItem(desktopStorageKey))
  assert.equal(saved.expiresAt - f.options.clock(), SCANNER_LIFETIME)
  assert.equal(
    Number(new URLSearchParams(url.hash.slice(1)).get("expires")),
    saved.expiresAt,
  )
  f.advance(3600000)
  await f.desktop.link()
  assert.equal(f.desktop.getSnapshot().url, first.url)
  assert.equal(f.desktop.getSnapshot().expiresAt, first.expiresAt)
  assert.equal(SCANNER_LIFETIME, 28800000)
})

test("reload restores the same link and stale StrictMode initialization cannot destroy the replacement", async (t) => {
  const f = await fixture(t)
  const link = f.desktop.getSnapshot().url
  f.desktop.stop()
  const restored = new DesktopScanner(f.options)
  t.after(() => restored.stop())
  const initial = restored.resume()
  restored.stop()
  await restored.resume()
  await initial
  await flush()
  assert.equal(restored.getSnapshot().url, link)
  assert.equal(
    f.network.peers.has(
      JSON.parse(f.storage.getItem(desktopStorageKey)).sessionId,
    ),
    true,
  )
  assert.equal(restored.getSnapshot().linking, false)
})

test("two browser controllers select a product and acknowledge exactly once", async (t) => {
  const f = await fixture(t),
    phone = f.phone()
  await flush()
  assert.equal(f.desktop.getSnapshot().paired, true)
  assert.equal(phone.getSnapshot().accepting, true)
  assert.equal(phone.getSnapshot().kind, "sale")
  phone.scan("000123")
  assert.equal(phone.getSnapshot().result, null)
  await flush()
  assert.equal(f.count(), 1)
  assert.equal(phone.getSnapshot().result.outcome, "selected")
  phone.scan("000123")
  await flush()
  assert.equal(f.count(), 1)
  assert.equal(
    f.network.frames.some(
      (frame) => frame.data.type === "hello" && frame.data.token,
    ),
    true,
  )
})

test("lost confirmation retries the same ID without applying the selection again", async (t) => {
  const f = await fixture(t),
    phone = f.phone()
  await flush()
  f.network.drop = (data) => data.type === "result"
  phone.scan("PACK-000001")
  await flush()
  assert.equal(f.count(), 1)
  assert.equal(phone.getSnapshot().busy, true)
  assert.equal(phone.getSnapshot().result, null)
  f.network.drop = undefined
  f.network.replay("scan")
  await flush()
  assert.equal(f.count(), 1)
  assert.equal(phone.getSnapshot().busy, false)
  assert.equal(phone.getSnapshot().result.code, "PACK-000001")
})

test("pausing and changing operation rejects old frames and resets the scan latch", async (t) => {
  const f = await fixture(t),
    phone = f.phone()
  await flush()
  phone.scan("DEMO-000001")
  await flush()
  f.desktop.setConsumer(null)
  await flush()
  assert.equal(phone.getSnapshot().accepting, false)
  phone.scan("OTHER")
  await flush()
  assert.equal(f.count(), 1)
  const target = { id: crypto.randomUUID(), kind: "purchase" }
  f.desktop.setConsumer({
    target,
    read: (scan) => ({
      ...scan,
      outcome: "already-selected",
      message: "Ya seleccionado",
    }),
  })
  await flush()
  assert.equal(phone.getSnapshot().kind, "purchase")
  f.network.replay("scan")
  await flush()
  assert.equal(f.count(), 1)
  phone.scan("DEMO-000001")
  await flush()
  assert.equal(phone.getSnapshot().result.contextId, target.id)
  assert.equal(phone.getSnapshot().result.outcome, "already-selected")
})

test("unprocessed old operation cannot select a product in a new operation", async (t) => {
  const f = await fixture(t),
    phone = f.phone()
  await flush()
  f.network.drop = (data) => data.type === "scan"
  phone.scan("DEMO-000001")
  await flush()
  f.network.drop = undefined
  f.desktop.setConsumer({
    target: { id: crypto.randomUUID(), kind: "purchase" },
    read: () => {
      throw Error("Old frame reached new consumer")
    },
  })
  await flush()
  assert.equal(phone.getSnapshot().result.outcome, "paused")
  assert.equal(f.count(), 0)
})

test("wrong secret and a second phone cannot take over the paired connection", async (t) => {
  const f = await fixture(t)
  const bad = new URL(f.desktop.getSnapshot().url)
  const params = new URLSearchParams(bad.hash.slice(1))
  params.set("token", "0".repeat(64))
  bad.hash = params.toString()
  const invalid = f.phone(bad.href)
  await flush()
  assert.match(invalid.getSnapshot().message, /no es válido/)
  assert.equal(f.desktop.getSnapshot().paired, false)
  const first = f.phone()
  await flush()
  const second = f.phone()
  await flush()
  assert.equal(first.getSnapshot().connected, true)
  assert.match(second.getSnapshot().message, /otro teléfono/)
  assert.equal(f.desktop.getSnapshot().paired, true)
  second.scan("DEMO-000001")
  await flush()
  assert.equal(f.count(), 0)
})

test("another desktop tab fails visibly instead of silently rotating or taking the link", async (t) => {
  const f = await fixture(t)
  const duplicate = new DesktopScanner(f.options)
  t.after(() => duplicate.stop())
  await duplicate.resume()
  await flush()
  assert.equal(duplicate.getSnapshot().url, f.desktop.getSnapshot().url)
  assert.match(duplicate.getSnapshot().message, /otra pestaña/)
  const phone = f.phone()
  await flush()
  phone.scan("DEMO-000001")
  await flush()
  assert.equal(f.count(), 1)
})

test("reconnection preserves link, deadline and pending scan ID", async (t) => {
  const f = await fixture(t),
    phone = f.phone()
  await flush()
  f.network.drop = (data) => data.type === "result"
  phone.scan("DEMO-000001")
  await flush()
  const originalScan = f.network.frames.find(
    (frame) => frame.data.type === "scan",
  ).data.scan
  const client = f.network.frames.find((frame) => frame.data.type === "hello")
    .connection.owner
  f.network.drop = undefined
  client.destroy()
  await flush()
  await flush()
  assert.equal(phone.getSnapshot().connected, true)
  assert.equal(phone.getSnapshot().result.id, originalScan.id)
  assert.equal(f.count(), 1)
})

test("expired desktop rejects a raw scan and generates a different eight-hour link only on demand", async (t) => {
  const f = await fixture(t),
    phone = f.phone()
  await flush()
  const old = f.desktop.getSnapshot().url
  f.advance(SCANNER_LIFETIME)
  const connection = f.network.frames.find(
    (frame) => frame.data.type === "hello",
  ).connection
  connection.send({
    type: "scan",
    scan: {
      id: crypto.randomUUID(),
      code: "DEMO-000001",
      contextId: f.target.id,
    },
  })
  await flush()
  assert.equal(f.count(), 0)
  assert.equal(f.desktop.getSnapshot().paired, false)
  assert.match(f.desktop.getSnapshot().message, /venció/)
  await f.desktop.link()
  await flush()
  assert.notEqual(f.desktop.getSnapshot().url, old)
  const expired = f.phone(old)
  await flush()
  assert.equal(expired.getSnapshot().connected, false)
  assert.match(expired.getSnapshot().message, /venció/)
  phone.stop()
})

test("explicit disconnect revokes the saved session; storage never contains barcodes", async (t) => {
  const f = await fixture(t)
  const storage = new MemoryScannerStorage()
  const phone = f.phone(undefined, storage)
  await flush()
  phone.scan("PRIVATE-CODE-123")
  await flush()
  assert.equal(
    [...storage.values.values()].some((value) =>
      value.includes("PRIVATE-CODE"),
    ),
    false,
  )
  assert.equal(
    [...f.storage.values.values()].some((value) =>
      value.includes("PRIVATE-CODE"),
    ),
    false,
  )
  await phone.disconnect()
  await new Promise((resolve) => setTimeout(resolve, 130))
  assert.equal(f.storage.getItem(desktopStorageKey), null)
  assert.equal(storage.getItem(phoneStorageKey), null)
  assert.equal(f.desktop.getSnapshot().paired, false)
})

test("invalid, legacy and expired links fail clearly and manual code validation preserves leading zeros", () => {
  const storage = new MemoryScannerStorage(),
    reader = new PhoneScanner(storage)
  reader.start("#session=invalid&pair=old")
  assert.match(reader.getSnapshot().message, /anterior/)
  assert.equal(validScannerCode("000123"), true)
  for (const code of ["", " ", " a", "a\n", "\u0000", "a".repeat(129), 123])
    assert.equal(validScannerCode(code), false)
})

test("reader entry point and transport have no scanner HTTP calls or Redis requirement", async () => {
  for (const file of [
    "DesktopScanner",
    "PhoneScanner",
    "PeerTransport",
    "PhoneReaderButton",
  ]) {
    const source = await readFile(
      new URL(
        "../src/features/scanner/" +
          file +
          (file === "PhoneReaderButton" ? ".tsx" : ".ts"),
        import.meta.url,
      ),
      "utf8",
    )
    assert.equal(source.includes("/api/lector-"), false)
    assert.equal(source.includes("scannerRequest"), false)
  }
})

test("invalid stored metadata can be replaced without configuring any service", async (t) => {
  const network = new FakePeerNetwork(),
    storage = new MemoryScannerStorage()
  storage.setItem(desktopStorageKey, "{broken")
  const desktop = new DesktopScanner({
    storage,
    createPeer: network.createPeer,
    origin: () => "https://shop.example",
  })
  t.after(() => desktop.stop())
  await desktop.resume()
  await desktop.link()
  assert.equal(new URL(desktop.getSnapshot().url).pathname, "/lector")
  assert.ok(JSON.parse(storage.getItem(desktopStorageKey)).token)
})

test("storage denied reports recovery guidance and does not create a misleading temporary link", async () => {
  const desktop = new DesktopScanner({
    storage: {
      getItem() {
        throw Error("Storage denied")
      },
    },
  })
  await desktop.link()
  assert.equal(desktop.getSnapshot().url, "")
  assert.match(desktop.getSnapshot().message, /almacenamiento/)
  desktop.stop()
})
