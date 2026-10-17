import React, { useEffect, useState, useSyncExternalStore } from "react"
import { createRoot } from "react-dom/client"
import { BrowserQRCodeReader } from "@zxing/browser"
import SaleModal from "../src/features/sales/SaleModal"
import PurchaseModal from "../src/features/purchases/PurchaseModal"
import CatalogModal from "../src/features/purchases/CatalogModal"
import { appendProduct } from "../src/data/purchases"
import PhoneReaderPage from "../src/features/scanner/PhoneReaderPage"
import { PhoneScanner } from "../src/features/scanner/PhoneScanner"
import {
  DesktopScanner,
  desktopScanner,
} from "../src/features/scanner/DesktopScanner"
import { scannerTransport } from "../src/features/scanner/PeerTransport"
import {
  desktopStorageKey,
  phoneStorageKey,
  type ScannerCredentials,
} from "../src/data/remoteScanner"
import { FakePeerNetwork, MemoryScannerStorage } from "./helpers/peerNetwork"
import { createPOSAppState, saleCatalog } from "../src/data/sales"
import "../src/index.css"

const live = new URLSearchParams(location.search).has("live")
const network = new FakePeerNetwork()
if (!live) scannerTransport.createPeer = network.createPeer
const state = createPOSAppState()
const [first, second, empty] = saleCatalog(
  state.inventario,
  new Date().toISOString(),
)
  .filter((product) => product.stockVendible)
  .slice(0, 3)
state.inventario.existencias.forEach((item) => {
  if (item.productoId === empty.id) item.stock = 0
})
state.inventario.lotes.forEach((item) => {
  if (item.productoId === empty.id) item.stock_actual = 0
})
function Fixture() {
  const [kind, setKind] =
    useState<"sale" | "purchase" | "product" | "phone" | null>(null)
  return (
    <>
      <button id="open-sale" onClick={() => setKind("sale")}>
        Venta
      </button>
      <button id="open-purchase" onClick={() => setKind("purchase")}>
        Compra
      </button>
      <button id="open-phone" onClick={() => setKind("phone")}>
        Teléfono
      </button>
      <button id="open-product" onClick={() => setKind("product")}>
        Nuevo producto
      </button>
      {kind === "product" && (
        <CatalogModal
          kind="product"
          state={state.inventario}
          onClose={() => setKind(null)}
          onName={() => {
            throw Error("Categoría accidental")
          }}
          onProduct={(draft) => {
            state.inventario = appendProduct(state.inventario, draft)
            setKind(null)
          }}
        />
      )}
      {kind === "sale" && (
        <SaleModal
          inventario={state.inventario}
          error=""
          onClose={() => setKind(null)}
          onSell={() => {
            throw Error("Venta accidental")
          }}
        />
      )}
      {kind === "purchase" && (
        <PurchaseModal
          state={state.inventario}
          feedback={state.purchaseFeedback}
          onClose={() => setKind(null)}
          onSuccess={() => setKind(null)}
          onSave={() => {
            throw Error("Compra accidental")
          }}
        />
      )}
      {kind === "phone" && <PhoneReaderPage />}
    </>
  )
}
function LivePhoneProbe() {
  const [reader] = useState(() => new PhoneScanner(new MemoryScannerStorage()))
  const snapshot = useSyncExternalStore(reader.subscribe, reader.getSnapshot)
  const [code, setCode] = useState("DEMO-000001")
  useEffect(() => {
    reader.start(location.hash)
    return () => reader.stop()
  }, [reader])
  return (
    <main className="phone-reader-page">
      <section className="phone-reader-card">
        <h2>Prueba de conexión WebRTC sin cámara</h2>
        <p role="status">{snapshot.message}</p>
        <label className="purchase-field">
          <span>Código de prueba</span>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
        <button
          className="purchase-button purchase-button-primary"
          disabled={!snapshot.accepting || snapshot.busy}
          onClick={() => {
            reader.resetLatch()
            reader.scan(code)
          }}
        >
          Enviar código de prueba
        </button>
        <p>
          El código viaja por PeerJS real. Esta pantalla no sustituye la prueba
          de cámara física.
        </p>
      </section>
    </main>
  )
}
createRoot(document.getElementById("test-root")!).render(
  new URLSearchParams(location.search).get("live") === "phone" ? (
    <LivePhoneProbe />
  ) : (
    <Fixture />
  ),
)
const delay = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms))
function assert(value: unknown, message: string) {
  if (!value) throw Error(message)
}
async function until(condition: () => unknown, timeout = 7500) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (condition()) return
    await delay(50)
  }
  throw Error("Tiempo de espera agotado")
}
function button(text: string) {
  return [
    ...document.querySelectorAll<HTMLButtonElement>("dialog button"),
  ].find((item) => item.textContent?.trim() === text)!
}
async function click(element: HTMLElement) {
  element.click()
  await delay()
}
function card(id: number) {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      ".sale-product-card,.purchase-product-card",
    ),
  ].find((item) => item.id.endsWith("-product-" + id))!
}
async function fill(
  field: HTMLInputElement | HTMLSelectElement,
  value: string,
) {
  Object.getOwnPropertyDescriptor(
    field instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLSelectElement.prototype,
    "value",
  )!.set!.call(field, value)
  field.dispatchEvent(
    new Event(field instanceof HTMLInputElement ? "input" : "change", {
      bubbles: true,
    }),
  )
  await delay()
}
const reports: string[] = []
function report(text: string) {
  reports.push("✓ " + text)
  document.getElementById("results")!.textContent = reports.join("\n")
}
let phone: PhoneScanner
async function send(code: string) {
  const old = phone.getSnapshot().result?.id
  phone.resetLatch()
  phone.scan(code)
  await until(
    () => phone.getSnapshot().result && phone.getSnapshot().result!.id !== old,
  )
  await delay()
  return phone.getSnapshot().result!
}
async function run() {
  await delay()
  await desktopScanner.disconnect()
  let link = ""
  for (const kind of ["sale", "purchase"] as const) {
    await click(document.getElementById("open-" + kind)!)
    if (kind === "sale") {
      await click(button("Usar teléfono como lector"))
      await until(() => document.querySelector('img[alt^="QR"]'))
      const image = document.querySelector<HTMLImageElement>('img[alt^="QR"]')!
      await until(() => image.complete)
      link = (await new BrowserQRCodeReader().decodeFromImageElement(image))
        .getText()
      assert(
        new URL(link).hash.includes("token=") && !new URL(link).search,
        "Secreto solo en fragmento",
      )
      assert(
        document.querySelector<HTMLInputElement>("#phone-reader-url")!.value ===
          link,
        "Enlace visible coincide con QR",
      )
      assert(
        document.querySelector("dialog")!.textContent!.includes("8 horas"),
        "Vigencia de ocho horas visible",
      )
      assert(
        !network.frames.some((frame) => frame.data.type === "state"),
        "Sin teléfono no hay lecturas",
      )
      let copied = ""
      const clipboard = navigator.clipboard
      const originalCopy = clipboard.writeText
      clipboard.writeText = async (value) => {
        copied = value
      }
      try {
        await click(button("Copiar enlace"))
        assert(copied === link, "Copia el enlace exacto")
      } finally {
        clipboard.writeText = originalCopy
      }
      phone = new PhoneScanner(new MemoryScannerStorage(), {
        createPeer: network.createPeer,
      })
      phone.start(new URL(link).hash)
      await until(() => desktopScanner.getSnapshot().paired)
      assert(!phone.getSnapshot().accepting, "Modal QR pausa el lector")
      await click(button("Continuar"))
      await until(() => phone.getSnapshot().accepting)
      report(
        "QR decodificable, enlace copiable de 8 horas y pausa mientras está abierto",
      )
    }
    await until(
      () => phone.getSnapshot().kind === kind && phone.getSnapshot().accepting,
    )
    await click(button("Usar teléfono como lector"))
    assert(
      desktopScanner.getSnapshot().url === link,
      "Mismo enlace entre operaciones",
    )
    await click(button("Continuar"))
    await until(() => phone.getSnapshot().accepting)
    const input = document.querySelector<HTMLInputElement>(
      'dialog input[id$="-code"]',
    )!
    const category = document.querySelector<HTMLSelectElement>(
      'dialog select[id$="-category"]',
    )!
    await fill(input, "NO-MATCH")
    await fill(category, String(state.inventario.categorias.at(-1)!.id))
    assert(
      (await send(first.codigo_barra)).outcome === "selected",
      "Selección remota",
    )
    assert(
      card(first.id).getAttribute("aria-pressed") === "true",
      "Seleccionado visible pese a filtros",
    )
    const pack = state.inventario.paquetes.find(
      (item) => item.id === second.paqueteId,
    )!
    assert((await send(pack.codigo_barra!)).outcome === "selected", "Paquete")
    assert(
      (await send(first.codigo_barra)).outcome === "already-selected",
      "Repetido",
    )
    assert((await send("UNKNOWN")).outcome === "unknown", "Desconocido")
    if (kind === "sale")
      assert(
        (await send(empty.codigo_barra)).outcome === "no-stock",
        "Sin stock",
      )
    assert(
      document.querySelectorAll('[aria-pressed="true"]').length === 2,
      "Sin duplicados",
    )
    report(
      kind +
        ": selección FIFO pese a filtros, códigos unitarios/paquete, repetidos y avisos",
    )
    const old = network.frames
      .filter((frame) => frame.data.type === "state")
      .at(-1)!.data.target.id
    await click(button("Siguiente"))
    await until(() => !phone.getSnapshot().accepting)
    const quantitySelector =
      kind === "sale" ? ".sale-quantity" : ".purchase-line-fields input"
    const quantity = document.querySelector<HTMLInputElement>(quantitySelector)
    if (quantity) await fill(quantity, "3")
    await click(button("Anterior"))
    await until(() => phone.getSnapshot().accepting)
    const stale = {
      id: crypto.randomUUID(),
      contextId: old,
      code: second.codigo_barra,
    }
    const connection = network.frames.find(
      (frame) => frame.data.type === "hello",
    )!.connection
    connection.send({ type: "scan", scan: stale })
    await until(() =>
      network.frames.some(
        (frame) =>
          frame.data.type === "result" && frame.data.result.id === stale.id,
      ),
    )
    const outcome = network.frames.find(
      (frame) =>
        frame.data.type === "result" && frame.data.result.id === stale.id,
    )!.data.result.outcome
    assert(outcome === "paused", "Lectura de operación anterior rechazada")
    assert(
      (await send(first.codigo_barra)).outcome === "already-selected",
      "Repetido conserva cantidad",
    )
    await click(button("Siguiente"))
    await until(() => !phone.getSnapshot().accepting)
    if (quantity)
      assert(
        document.querySelector<HTMLInputElement>(quantitySelector)?.value ===
          "3",
        "Cantidad conservada",
      )
    await click(
      kind === "sale"
        ? button("Cancelar")
        : document.querySelector<HTMLButtonElement>(
            'dialog button[aria-label^="Cerrar"]',
          )!,
    )
    assert(
      desktopScanner.getSnapshot().paired,
      "Cancelar conserva la vinculación",
    )
    report(
      kind +
        ": pausa, contexto obsoleto rechazado, cantidades y enlace conservados",
    )
  }
  await click(document.getElementById("open-product")!)
  await until(
    () =>
      phone.getSnapshot().accepting && phone.getSnapshot().kind === "product",
  )
  assert(
    desktopScanner.getSnapshot().url === link,
    "Registro reutiliza el teléfono de Ventas y Compras",
  )
  const catalogInput = (suffix: string) =>
    document.querySelector<HTMLInputElement>(`dialog input[id$='-${suffix}']`)!
  const beforeRegistration = state.inventario.productos.length
  await fill(document.querySelector<HTMLSelectElement>("dialog select")!, "1")
  await fill(catalogInput("name"), "Nuevo producto escaneado")
  await fill(catalogInput("unit"), "2,50")
  assert(
    (await send("0012345678905")).outcome === "selected",
    "Acepta código nuevo que no existe en catálogo",
  )
  assert(
    catalogInput("barcode").value === "0012345678905",
    "Código individual conserva ceros",
  )
  assert(
    state.inventario.productos.length === beforeRegistration,
    "Escaneo no guarda automáticamente",
  )
  assert(
    catalogInput("name").value === "Nuevo producto escaneado",
    "Conserva nombre al escanear",
  )
  assert(
    (await send(first.codigo_barra)).outcome === "unknown",
    "Detecta código registrado",
  )
  assert(button("Guardar").disabled, "No permite guardar duplicado")
  await send("0012345678905")
  await click(
    document.querySelector<HTMLInputElement>(
      'input[aria-label="Activar código paquete"]',
    )!,
  )
  await click(button("Escanear código paquete"))
  await until(
    () =>
      phone.getSnapshot().kind === "package" && phone.getSnapshot().accepting,
  )
  assert(
    (await send("0098765432105")).outcome === "selected",
    "Acepta paquete remoto",
  )
  assert(
    catalogInput("package-code").value === "0098765432105",
    "Paquete va a su campo",
  )
  assert(
    catalogInput("barcode").value === "0012345678905",
    "Paquete no reemplaza código individual",
  )
  await click(button("Usar teléfono como lector"))
  await until(() => !phone.getSnapshot().accepting)
  await click(button("Continuar"))
  await until(
    () =>
      phone.getSnapshot().kind === "package" && phone.getSnapshot().accepting,
  )
  await click(
    document.querySelector<HTMLInputElement>(
      'input[aria-label="Activar código paquete"]',
    )!,
  )
  await until(
    () =>
      phone.getSnapshot().kind === "product" && phone.getSnapshot().accepting,
  )
  assert(
    catalogInput("package-code").value === "",
    "Desactivar paquete limpia y devuelve destino al producto",
  )
  await click(button("Escanear código producto"))
  catalogInput("name").focus()
  let time = performance.now()
  for (const key of [..."0077777777777", "Enter"]) {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(event, "timeStamp", { value: (time += 10) })
    catalogInput("name").dispatchEvent(event)
    if (key !== "Enter")
      await fill(catalogInput("name"), catalogInput("name").value + key)
    else assert(event.defaultPrevented, "Lector físico impide envío accidental")
  }
  await delay()
  assert(
    catalogInput("barcode").value === "0077777777777",
    "Lector físico captura código con foco en Nombre",
  )
  assert(
    catalogInput("name").value === "Nuevo producto escaneado",
    "Lector físico restaura nombre",
  )
  assert(!button("Guardar").disabled, "Producto listo para guardar")
  await click(button("Guardar"))
  await until(() => !phone.getSnapshot().accepting)
  assert(
    state.inventario.productos.length === beforeRegistration + 1,
    "Guarda exactamente un producto",
  )
  assert(
    state.inventario.productos.at(-1)!.codigo_barra === "0077777777777",
    "Guarda código escaneado",
  )
  assert(
    desktopScanner.getSnapshot().paired &&
      desktopScanner.getSnapshot().url === link,
    "Guardar mantiene vínculo",
  )
  await click(document.getElementById("open-product")!)
  await until(
    () =>
      phone.getSnapshot().kind === "product" && phone.getSnapshot().accepting,
  )
  assert(catalogInput("barcode").value === "", "Siguiente registro abre vacío")
  await click(button("Cancelar"))
  await until(() => !phone.getSnapshot().accepting)
  await click(document.getElementById("open-sale")!)
  await until(
    () => phone.getSnapshot().kind === "sale" && phone.getSnapshot().accepting,
  )
  await click(button("Cancelar"))
  report(
    "Registro: teléfono vinculado, códigos nuevos y duplicados, paquete, pausa, lector físico, guardado único y regreso a Ventas",
  )
  phone.stop()
  desktopScanner.stop()
  await desktopScanner.resume()
  await delay()
  assert(
    desktopScanner.getSnapshot().url === link,
    "Restauración conserva enlace",
  )
  report("Restaurar transporte no regenera QR ni extiende vencimiento")
  const url = new URL(link),
    params = new URLSearchParams(url.hash.slice(1))
  const credentials: ScannerCredentials = {
    sessionId: params.get("session")!,
    token: params.get("token")!,
    expiresAt: Number(params.get("expires")),
  }
  localStorage.setItem(phoneStorageKey, JSON.stringify(credentials))
  const media = navigator.mediaDevices
  const previous = media?.getUserMedia
  if (media)
    media.getUserMedia = async () => {
      throw new DOMException("Test permission denied", "NotAllowedError")
    }
  await click(document.getElementById("open-phone")!)
  await until(() =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].some(
      (item) => item.textContent === "Iniciar cámara" && !item.disabled,
    ),
  )
  try {
    await click(
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (item) => item.textContent === "Iniciar cámara",
      )!,
    )
    await until(() => document.querySelector('[role="alert"]'))
    assert(
      document
        .querySelector('[role="alert"]')!
        .textContent?.includes(media ? "Permite el acceso" : "HTTPS"),
      "Cámara denegada con ayuda",
    )
  } finally {
    if (media && previous) media.getUserMedia = previous
  }
  report("Página móvil sin login y error de cámara con recuperación")
  document.getElementById("results")!.textContent +=
    "\n" + reports.length + "/" + reports.length + " comprobaciones aprobadas"
  document.getElementById("results")!.dataset.complete = "true"
}
async function runRealConnection() {
  const desktop = new DesktopScanner({
    storage: new MemoryScannerStorage(),
    origin: () => location.origin,
  })
  const reader = new PhoneScanner(new MemoryScannerStorage())
  let selections = 0
  const display = () => {
    document.getElementById("results")!.textContent =
      "Ensayo WebRTC real sin cámara\nComputadora: " +
      desktop.getSnapshot().message +
      "\nTeléfono: " +
      reader.getSnapshot().message
  }
  const offDesktop = desktop.subscribe(display),
    offPhone = reader.subscribe(display)
  try {
    desktop.setConsumer({
      target: { id: crypto.randomUUID(), kind: "sale" },
      read: (scan) => {
        selections++
        return {
          ...scan,
          outcome: "selected",
          message: "Código recibido mediante WebRTC real",
        }
      },
    })
    await desktop.link()
    const link = desktop.getSnapshot().url
    reader.start(new URL(link).hash)
    await until(() => reader.getSnapshot().accepting, 30000)
    reader.scan(first.codigo_barra)
    await until(() => reader.getSnapshot().result?.outcome === "selected")
    assert(selections === 1, "Una lectura confirmada por canal real")
    desktop.setConsumer(null)
    await until(() => !reader.getSnapshot().accepting)
    desktop.stop()
    await desktop.resume()
    assert(desktop.getSnapshot().url === link, "Recarga mantiene enlace real")
    desktop.setConsumer({
      target: { id: crypto.randomUUID(), kind: "purchase" },
      read: (scan) => {
        selections++
        return {
          ...scan,
          outcome: "selected",
          message: "Compra recibió código mediante WebRTC real",
        }
      },
    })
    await until(
      () =>
        reader.getSnapshot().connected &&
        reader.getSnapshot().kind === "purchase",
      30000,
    )
    reader.scan(second.codigo_barra)
    await until(() => reader.getSnapshot().result?.code === second.codigo_barra)
    assert(selections === 2, "Dos operaciones por canal real")
    offDesktop()
    offPhone()
    document.getElementById("results")!.textContent =
      "✓ Canal WebRTC real establecido con PeerJS Cloud\n✓ Código enviado y confirmado\n✓ Pausa y reconexión con el mismo enlace\n✓ Cambio de venta a compra\n4/4 comprobaciones reales aprobadas (sin cámara física)"
  } catch (error) {
    offDesktop()
    offPhone()
    document.getElementById("results")!.textContent =
      "ERROR en ensayo real: " +
      String(error) +
      "\nComputadora: " +
      desktop.getSnapshot().message +
      "\nTeléfono: " +
      reader.getSnapshot().message
  } finally {
    reader.stop()
    desktop.stop()
  }
}
if (new URLSearchParams(location.search).get("live") === "real")
  void runRealConnection()
else if (live)
  document.getElementById("results")!.textContent =
    "Modo real PeerJS: abre Venta o Compra y usa el QR o el enlace para conectar otro navegador."
else
  run().catch((error) => {
    phone?.stop()
    desktopScanner.stop()
    document.getElementById("results")!.textContent =
      reports.join("\n") + "\nERROR: " + String(error?.stack ?? error)
  })
