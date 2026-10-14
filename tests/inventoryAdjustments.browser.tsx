import React, { useReducer } from "react"
import { createRoot } from "react-dom/client"
import Inventory from "../src/pages/Inventory"
import { createPOSAppState, posReducer } from "../src/data/sales"
import "../src/index.css"

let latest = createPOSAppState()
latest.inventario.productos[0].precio_paquete = null
let rejectNext = false
function Fixture() {
  const [state, dispatch] = useReducer(posReducer, latest)
  latest = state
  return (
    <Inventory
      state={state.inventario}
      feedback={state.adjustmentFeedback}
      transferFeedback={state.transferFeedback}
      onTransfer={(draft) =>
        dispatch({
          type: "inventory/transfer",
          draft,
          fecha: new Date().toISOString(),
        })
      }
      onMinimumChange={(productoId, almacenId, minimum) =>
        dispatch({
          type: "inventory/setMinimum",
          productoId,
          almacenId,
          minimum,
        })
      }
      onAdjustment={(draft) => {
        dispatch({
          type: "inventory/adjust",
          draft: rejectNext
            ? {
                ...draft,
                items: draft.items.map((item, i) =>
                  i === 1 ? { ...item, cantidad: "0" } : item,
                ),
              }
            : draft,
          fecha: new Date().toISOString(),
        })
        rejectNext = false
      }}
    />
  )
}
createRoot(document.getElementById("test-root")!).render(<Fixture />)
const pause = () => new Promise((resolve) => setTimeout(resolve, 40))
const reports: string[] = []
function assert(value: unknown, message: string) {
  if (!value) throw new Error(message)
}
function button(text: string) {
  return [
    ...document.querySelectorAll<HTMLButtonElement>("dialog button"),
  ].find((item) => item.textContent?.trim() === text)!
}
function field(id: string) {
  return document.getElementById(id) as HTMLInputElement | HTMLSelectElement
}
function labeled(name: string) {
  return document.querySelector<HTMLInputElement>(
    'dialog input[aria-label="' + name + '"]',
  )!
}
function cards() {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      "dialog .purchase-product-card",
    ),
  ]
}
async function click(target: HTMLElement) {
  target.focus()
  target.click()
  await pause()
}
async function fill(
  target: HTMLInputElement | HTMLSelectElement,
  value: string,
) {
  const proto =
    target instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(target, value)
  target.dispatchEvent(
    new Event(target instanceof HTMLSelectElement ? "change" : "input", {
      bubbles: true,
    }),
  )
  await pause()
}
async function enter(target: HTMLElement) {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(event)
  assert(event.defaultPrevented, "Enter del código consumido")
  await pause()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}
async function scan(target: HTMLElement, code: string) {
  target.focus()
  const start = performance.now()
  for (const [index, key] of [...code, "Enter"].entries()) {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(event, "timeStamp", { value: start + index * 10 })
    target.dispatchEvent(event)
    if (index === 0 && target instanceof HTMLSelectElement)
      await fill(target, "1")
    if (key === "Enter")
      assert(event.defaultPrevented, "Enter global consumido")
  }
  await pause()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}
function selected(ids: number[]) {
  assert(
    cards()
      .slice(0, ids.length)
      .every(
        (card, index) =>
          card.id === "adjust-product-" + ids[index] &&
          card.getAttribute("aria-pressed") === "true",
      ),
    "Pinning en orden de llegada",
  )
}
const names = latest.inventario.productos.slice(0, 3).map((item) => item.nombre)
const quantity = (index: number) => labeled("Cantidad para " + names[index])
const expiry = (index: number) =>
  labeled("Vencimiento opcional para " + names[index])
async function test(name: string, action: () => Promise<void>) {
  await action()
  reports.push("✓ " + name)
  document.getElementById("results")!.textContent = reports.join("\n")
}
async function open() {
  await click(document.getElementById("inventory-adjust-trigger")!)
}
async function run() {
  await pause()
  await test("Tres ubicaciones, tabla directa, Volver y Traspaso disponible", async () => {
    assert(
      document.querySelectorAll('[id^="inventory-location-"]').length === 3,
      "Ubicaciones",
    )
    assert(
      !document
        .getElementById("inventory-transfer-trigger")!
        .hasAttribute("disabled"),
      "Traspaso disponible",
    )
    await click(document.getElementById("inventory-location-3")!)
    assert(
      document.querySelector(".stock-table") &&
        document.querySelectorAll(".inventory-category-filter option").length === 5 &&
        !document.querySelector(".inventory-heading, .inventory-actions"),
      "Tabla directa con filtros y sin cabecera redundante",
    )
    await click(
      [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
        item.textContent?.includes("Volver"),
      )!,
    )
    await open()
    assert(field("adjust-origin").value === "3", "Origen actual")
  })
  await test("Selección de stock cero y filtros conservan pinning al cambiar de origen", async () => {
    await click(document.getElementById("adjust-product-1")!)
    await click(document.getElementById("adjust-product-2")!)
    await fill(field("adjust-code"), "UNKNOWN")
    await fill(field("adjust-category"), "4")
    await fill(field("adjust-origin"), "2")
    selected([1, 2])
    assert(cards().length === 2, "Solo seleccionados")
    assert(
      cards().every((item) => item.textContent?.includes("0 unidades físicas")),
      "Stock del origen",
    )
  })
  await test("Escáner de paquete global restaura Origen, limpia Código y no duplica ni avanza", async () => {
    await scan(field("adjust-origin"), "PACK-000003")
    selected([1, 2, 3])
    assert(field("adjust-origin").value === "2", "Origen restaurado")
    assert(
      field("adjust-code").value === "" &&
        document.activeElement === field("adjust-code"),
      "Foco y campo limpio",
    )
    await fill(field("adjust-code"), "DEMO-000003")
    await enter(field("adjust-code"))
    assert(
      cards().filter((item) => item.getAttribute("aria-pressed") === "true")
        .length === 3,
      "Sin duplicados",
    )
    await fill(field("adjust-code"), "UNKNOWN")
    await enter(field("adjust-code"))
    selected([1, 2, 3])
    assert(
      document.querySelector("dialog [role='alert']"),
      "Código desconocido",
    )
    await click(button("Siguiente"))
  })
  await test("Presentaciones físicas, fecha opcional y cambio Entrada/Salida conservan borradores", async () => {
    assert(
      document.querySelectorAll(".adjustment-table tbody tr").length === 3,
      "Tres filas",
    )
    const pack = labeled("Paquete para " + names[0])
    assert(!pack.disabled, "Paquete sin precio sigue habilitado")
    await click(pack)
    await fill(quantity(0), "2")
    await fill(expiry(0), "2028-01-01")
    await fill(quantity(1), "3")
    await fill(quantity(2), "4")
    assert(
      document
        .querySelector(".adjustment-table")!
        .textContent!.includes("24 u. de entrada"),
      "Unidades físicas",
    )
    await click(
      document.querySelector<HTMLInputElement>(
        'input[name="adjust-type"][value="salida"]',
      )!,
    )
    assert(
      button("Confirmar").disabled && !expiry(0),
      "Salida insuficiente y fechas ocultas",
    )
    await click(
      document.querySelector<HTMLInputElement>(
        'input[name="adjust-type"][value="entrada"]',
      )!,
    )
    assert(expiry(0).value === "2028-01-01", "Fecha conservada")
    await click(button("Anterior"))
    selected([1, 2, 3])
    await fill(field("adjust-origin"), "3")
    await click(button("Siguiente"))
    assert(
      quantity(0).value === "2" && expiry(0).value === "2028-01-01",
      "Datos conservados",
    )
    assert(
      document
        .querySelector(".sale-step-heading")!
        .textContent!.includes("Almacén 2"),
      "Origen único actualizado",
    )
  })
  await test("Error del reducer conserva el modal; reintentar guarda una vez y muestra toast", async () => {
    rejectNext = true
    await click(button("Confirmar"))
    assert(
      document.querySelector("dialog[open]") &&
        latest.inventario.ajustes.length === 0,
      "Error atómico",
    )
    assert(
      quantity(1).value === "3" && !button("Confirmar").disabled,
      "Reintento habilitado",
    )
    const confirm = button("Confirmar")
    confirm.click()
    confirm.click()
    await pause()
    assert(
      !document.querySelector("dialog") &&
        latest.inventario.ajustes.length === 1,
      "Un guardado",
    )
    assert(latest.inventario.ajustes[0].almacenId === 3, "Almacén final")
    const lots = latest.inventario.lotes.filter((lot) => lot.ajusteId === 1)
    assert(
      JSON.stringify(lots.map((lot) => lot.stock_actual)) ===
        JSON.stringify([24, 3, 4]),
      "Lotes y cantidades",
    )
    assert(
      document.body.textContent!.includes("registrado correctamente"),
      "Toast",
    )
    assert(
      document.activeElement?.id === "inventory-adjust-trigger",
      "Foco restaurado",
    )
  })
  await test("Reapertura limpia y salida exacta hasta cero", async () => {
    await open()
    assert(
      button("Siguiente").disabled && field("adjust-code").value === "",
      "Borrador limpio",
    )
    assert(field("adjust-origin").value === "3", "Origen conservado")
    await click(document.getElementById("adjust-product-1")!)
    await click(button("Siguiente"))
    await click(
      document.querySelector<HTMLInputElement>(
        'input[name="adjust-type"][value="salida"]',
      )!,
    )
    await fill(quantity(0), "25")
    assert(button("Confirmar").disabled, "Evita negativo")
    await fill(quantity(0), "24")
    assert(!button("Confirmar").disabled, "Salida exacta")
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    })
    for (const key of "PACK-000003")
      quantity(0).dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      )
    quantity(0).dispatchEvent(event)
    assert(!event.defaultPrevented, "Escáner retirado en paso 2")
    await click(button("Confirmar"))
    assert(
      latest.inventario.existencias.find(
        (item) => item.productoId === 1 && item.almacenId === 3,
      )!.stock === 0,
      "Stock cero",
    )
  })
  await test("Papelera vacía la lista; Cancelar y Escape descartan y limpian listeners", async () => {
    await open()
    await click(document.getElementById("adjust-product-2")!)
    await click(button("Siguiente"))
    await click(
      document.querySelector<HTMLButtonElement>(
        'button[aria-label="Quitar ' + names[1] + '"]',
      )!,
    )
    assert(
      button("Confirmar").disabled &&
        !document.querySelector(".adjustment-table tbody tr"),
      "Lista vacía",
    )
    await click(button("Anterior"))
    assert(button("Siguiente").disabled, "Sin selección")
    await click(button("Cancelar"))
    await open()
    document
      .querySelector("dialog")!
      .dispatchEvent(new Event("cancel", { cancelable: true }))
    await pause()
    assert(!document.querySelector("dialog"), "Escape")
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    })
    for (const key of "PACK-000003")
      window.dispatchEvent(new KeyboardEvent("keydown", { key }))
    window.dispatchEvent(event)
    assert(!event.defaultPrevented, "Listener retirado")
    assert(latest.inventario.ajustes.length === 2, "Cancelar no ajusta")
  })
  document.getElementById("results")!.textContent += "\n7/7 pruebas aprobadas"
}
run().catch((error) => {
  document.getElementById("results")!.textContent =
    reports.join("\n") + "\nERROR: " + error.message
  console.error(error)
})
