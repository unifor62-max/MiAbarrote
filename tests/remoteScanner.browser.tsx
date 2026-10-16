import React, { useState } from "react"
import { createRoot } from "react-dom/client"
import { BrowserQRCodeReader } from "@zxing/browser"
import SaleModal from "../src/features/sales/SaleModal"
import PurchaseModal from "../src/features/purchases/PurchaseModal"
import PhoneReaderPage from "../src/features/scanner/PhoneReaderPage"
import { desktopScanner } from "../src/features/scanner/DesktopScanner"
import { createPOSAppState, saleCatalog } from "../src/data/sales"
import type {
  RemoteScan,
  ScannerResult,
  ScannerTarget,
} from "../src/data/remoteScanner"
import "../src/index.css"

// This page exercises real UI components against a controlled transport, without Redis or payments.
let paired = false,
  target: ScannerTarget | null = null,
  pending: RemoteScan | null = null
const results = new Map<string, ScannerResult>()
const sessionId = crypto.randomUUID(),
  token = "a".repeat(64),
  pair = "b".repeat(64)
const originalFetch = window.fetch.bind(window)
window.fetch = async (input, options) => {
  const url = new URL(String(input), location.origin)
  if (!url.pathname.startsWith("/api/lector-"))
    return originalFetch(input, options)
  const body = options?.body ? JSON.parse(String(options.body)) : null
  if (body?.operation === "create")
    return Response.json({
      sessionId,
      token,
      pair,
      pairUntil: Date.now() + 120000,
    })
  if (body?.operation === "heartbeat") target = body.target
  if (body?.operation === "result") {
    results.set(body.result.id, body.result)
    pending = null
  }
  if (body?.operation === "close") {
    paired = false
    target = null
  }
  return Response.json({
    paired,
    accepting: !!target,
    target,
    pending,
    result: results.get(url.searchParams.get("eventId") ?? ""),
  })
}
const state = createPOSAppState()
const [first, second, empty] = saleCatalog(
  state.inventario,
  new Date().toISOString(),
)
  .filter((p) => p.stockVendible)
  .slice(0, 3)
state.inventario.existencias.forEach((item) => {
  if (item.productoId === empty.id) item.stock = 0
})
state.inventario.lotes.forEach((item) => {
  if (item.productoId === empty.id) item.stock_actual = 0
})
function Fixture() {
  const [kind, setKind] = useState<"sale" | "purchase" | "phone" | null>(null)
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
createRoot(document.getElementById("test-root")!).render(<Fixture />)
const delay = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms))
function assert(value: unknown, message: string) {
  if (!value) throw Error(message)
}
async function until(condition: () => unknown) {
  for (let i = 0; i < 140; i++) {
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
async function send(code: string, contextId = target?.id) {
  assert(contextId, "El lector debe estar activo")
  const scan = { id: crypto.randomUUID(), code, contextId: contextId! }
  pending = scan
  await until(() => results.has(scan.id))
  await delay()
  return results.get(scan.id)!
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
async function run() {
  await delay()
  for (const kind of ["sale", "purchase"] as const) {
    await click(document.getElementById("open-" + kind)!)
    if (kind === "sale") {
      await click(button("Usar teléfono como lector"))
      await until(() => document.querySelector('img[alt^="QR"]'))
      const image = document.querySelector<HTMLImageElement>('img[alt^="QR"]')!
      await until(() => image.complete)
      const qr = await new BrowserQRCodeReader().decodeFromImageElement(image)
      assert(
        new URL(qr.getText()).hash.includes("pair="),
        "QR con secreto en fragmento",
      )
      assert(!target, "El diálogo de vinculación pausa la selección")
      paired = true
      await until(() => desktopScanner.getSnapshot().paired)
      await click(button("Continuar"))
      report(
        "QR local decodificable, cierre conserva vinculación y pausa tras otro diálogo",
      )
    }
    await until(() => target?.kind === kind)
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
      "Producto seleccionado por teléfono",
    )
    assert(
      card(first.id).getAttribute("aria-pressed") === "true",
      "Selección fijada pese a filtros",
    )
    const pack = state.inventario.paquetes.find(
      (p) => p.id === second.paqueteId,
    )!
    assert(
      (await send(pack.codigo_barra!)).outcome === "selected",
      "Código de paquete",
    )
    assert(
      (await send(first.codigo_barra)).outcome === "already-selected",
      "Repetición confirmada",
    )
    assert((await send("UNKNOWN")).outcome === "unknown", "Código desconocido")
    if (kind === "sale")
      assert(
        (await send(empty.codigo_barra)).outcome === "no-stock",
        "Stock vendible",
      )
    assert(
      document.querySelectorAll('[aria-pressed="true"]').length === 2,
      "No se duplican ni desmarcan productos",
    )
    report(
      kind +
        ": códigos unitarios/paquete, repetidos, filtros y avisos correctos",
    )
    const old = target!.id
    await click(button("Siguiente"))
    await until(() => !target)
    const quantity = document.querySelector<HTMLInputElement>(
      kind === "sale" ? ".sale-quantity" : ".purchase-line-fields input",
    )
    if (quantity) await fill(quantity, "3")
    await click(button("Anterior"))
    await until(() => target && target.id !== old)
    assert(
      (await send(second.codigo_barra, old)).outcome === "paused",
      "Lectura atrasada descartada",
    )
    assert(
      (await send(first.codigo_barra)).outcome === "already-selected",
      "Repetición conserva cantidad",
    )
    await click(button("Siguiente"))
    await until(() => !target)
    if (quantity) {
      const restored = document.querySelector<HTMLInputElement>(
        kind === "sale" ? ".sale-quantity" : ".purchase-line-fields input",
      )
      assert(restored?.value === "3", "Cantidad conservada")
    }
    await click(
      kind === "sale"
        ? button("Cancelar")
        : document.querySelector<HTMLButtonElement>(
            'dialog button[aria-label^="Cerrar"]',
          )!,
    )
    await delay()
    assert(
      desktopScanner.getSnapshot().paired,
      "Cancelar conserva la vinculación",
    )
    await click(document.getElementById("open-" + kind)!)
    await until(() => target?.kind === kind)
    assert(
      !document.querySelector('[aria-pressed="true"]'),
      "La nueva operación empieza vacía",
    )
    await click(button("Cancelar"))
    report(
      kind +
        ": pausa en paso 2, nuevo contexto, cantidad conservada y cancelación limpia",
    )
  }
  await desktopScanner.disconnect()
  target = { id: crypto.randomUUID(), kind: "sale" }
  paired = true
  sessionStorage.setItem(
    "miabarrote:phone-reader",
    JSON.stringify({ credentials: { sessionId, token } }),
  )
  const media = navigator.mediaDevices
  const previous = media?.getUserMedia
  if (media)
    media.getUserMedia = async () => {
      throw new DOMException("Test permission denied", "NotAllowedError")
    }
  await click(document.getElementById("open-phone")!)
  await until(() =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].some(
      (b) => b.textContent === "Iniciar cámara" && !b.disabled,
    ),
  )
  await click(
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Iniciar cámara",
    )!,
  )
  await until(() => document.querySelector('[role="alert"]'))
  assert(
    document
      .querySelector('[role="alert"]')!
      .textContent?.includes(media ? "Permite el acceso" : "HTTPS"),
    "Error de permiso orienta al usuario",
  )
  if (media && previous) media.getUserMedia = previous
  report(
    "Página móvil sin login y error de cámara con instrucciones de recuperación",
  )
  document.getElementById("results")!.textContent +=
    "\n6/6 comprobaciones aprobadas"
}
run().catch((error) => {
  document.getElementById("results")!.textContent =
    reports.join("\n") +
    "\nERROR: " +
    String(error?.stack ?? error?.message ?? error)
})
