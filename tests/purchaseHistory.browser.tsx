import React, { useReducer } from "react"
import { createRoot } from "react-dom/client"
import Purchases from "../src/pages/Purchases"
import { createPOSAppState, posReducer } from "../src/data/sales"
import "../src/index.css"

let latest = createPOSAppState("2026-10-13")
function Fixture() {
  const [state, dispatch] = useReducer(posReducer, latest)
  latest = state
  return <Purchases state={state.inventario} feedback={state.purchaseFeedback}
    onDelete={(id) => dispatch({ type: "purchase/delete", id })}
    onSave={() => {}} onProduct={() => {}} onName={() => {}}
    onEdit={() => {}} onDirtyChange={() => {}}
    onSupplierCreate={() => {}} onSupplierEdit={() => {}} />
}
createRoot(document.getElementById("test-root")!).render(<Fixture />)
const pause = () => new Promise((resolve) => setTimeout(resolve, 50))
function assert(value: unknown, message: string) {
  if (!value) throw new Error(message)
}
async function click(name: string) {
  const target = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((item) => item.getAttribute("aria-label") === name || item.textContent?.trim() === name)
  assert(target, "Botón no encontrado: " + name)
  target!.focus()
  target!.click()
  await pause()
}
async function fill(id: string, value: string) {
  const field = document.getElementById(id) as HTMLInputElement | HTMLSelectElement
  const proto = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value)
  field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }))
  await pause()
}
const reports: string[] = []
async function test(name: string, action: () => Promise<void>) {
  await action()
  reports.push("✓ " + name)
  document.getElementById("results")!.textContent = reports.join("\n")
}
async function run() {
  await pause()
  await test("Navegación, tabla de cuatro columnas y paginación", async () => {
    document.getElementById("purchase-details-trigger")!.click()
    await pause()
    assert(document.querySelectorAll(".purchase-history-table th").length === 4, "Columnas")
    assert(document.querySelectorAll(".purchase-history-table tbody tr").length === 10, "Filas iniciales")
    assert(document.querySelector(".purchase-history-metrics")!.textContent!.includes("27"), "Métricas")
    await click("Página siguiente")
    assert(document.querySelector("[aria-current='page']")!.textContent === "2", "Página 2")
  })
  await test("Filtros combinados, rango inválido y reinicio de página", async () => {
    await fill("purchase-history-inicio", "2026-10-09")
    await fill("purchase-history-final", "2026-10-11")
    assert(document.querySelectorAll(".purchase-history-table tbody tr").length === 3, "Rango inclusivo")
    assert(document.querySelector("[aria-current='page']")!.textContent === "1", "Reinicio")
    await fill("purchase-history-supplier", "5")
    assert(document.querySelectorAll(".purchase-history-table tbody tr").length === 1, "Proveedor")
    await fill("purchase-history-inicio", "2026-10-12")
    assert(document.querySelector("#purchase-history-filter-error"), "Error de rango")
    await fill("purchase-history-inicio", "")
    await fill("purchase-history-final", "")
    await fill("purchase-history-supplier", "")
  })
  await test("Recibo completo, cierre con Escape y restauración de foco", async () => {
    await click("Ver compra C-1027")
    assert(document.querySelectorAll(".purchase-receipt-table tbody tr").length === 4, "Cuatro productos")
    assert(document.querySelector("dialog")!.textContent!.includes("Sin caducidad"), "Sin caducidad")
    assert(document.querySelector("dialog")!.textContent!.includes("Total liquidado"), "Total")
    const dialog = document.querySelector("dialog")!
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }))
    await pause()
    assert(!document.querySelector("dialog"), "Cierre")
    assert(document.activeElement?.getAttribute("aria-label") === "Ver compra C-1027", "Foco")
    await click("Ver compra C-1027")
    await click("Cerrar")
  })
  await test("Cancelar conserva datos; confirmar elimina, ajusta stock y muestra toast", async () => {
    await click("Eliminar compra C-1027")
    await click("Cancelar")
    assert(latest.inventario.compras.length === 27, "Cancelación")
    await click("Eliminar compra C-1027")
    await click("Confirmar eliminación")
    assert(latest.inventario.compras.length === 26, "Eliminación")
    assert(!latest.inventario.lotes.some((lot) => lot.compraId === 1027), "Lotes")
    assert(document.body.textContent!.includes("eliminada"), "Toast")
    assert(!document.querySelector("dialog"), "Modal cerrado")
    await click("← Volver")
    assert(document.getElementById("purchase-details-trigger"), "Menú")
    document.getElementById("purchase-details-trigger")!.click()
    await pause()
    assert(document.querySelector(".purchase-history-metrics")!.textContent!.includes("26"), "Estado conservado")
  })
  document.getElementById("results")!.textContent += "\n4/4 pruebas aprobadas"
}
run().catch((error) => {
  document.getElementById("results")!.textContent = reports.join("\n") + "\nERROR: " + error.message
})
