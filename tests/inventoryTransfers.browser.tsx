import React, { useReducer } from "react"
import { createRoot } from "react-dom/client"
import Inventory from "../src/pages/Inventory"
import { createPOSAppState, posReducer } from "../src/data/sales"
import { applyInventoryAdjustment } from "../src/data/inventoryAdjustments"
import "../src/index.css"

let latest = createPOSAppState()
latest.inventario = applyInventoryAdjustment(latest.inventario, {
  almacenId: 2,
  tipo: "entrada",
  items: [1, 2].map((productoId) => ({
    productoId,
    presentacion: "unidad",
    cantidad: "30",
    fechaVencimiento: "",
  })),
})
let rejectNext = false
function Fixture() {
  const [state, dispatch] = useReducer(posReducer, latest)
  latest = state
  return (
    <div style={{ padding: 16, maxWidth: 1400, margin: "auto" }}>
      <Inventory
        state={state.inventario}
        feedback={state.adjustmentFeedback}
        transferFeedback={state.transferFeedback}
        onMinimumChange={(productoId, almacenId, minimum) =>
          dispatch({
            type: "inventory/setMinimum",
            productoId,
            almacenId,
            minimum,
          })
        }
        onAdjustment={(draft) =>
          dispatch({
            type: "inventory/adjust",
            draft,
            fecha: new Date().toISOString(),
          })
        }
        onTransfer={(draft) => {
          dispatch({
            type: "inventory/transfer",
            draft: rejectNext
              ? {
                  ...draft,
                  items: draft.items.map((item, index) =>
                    index === 1 ? { ...item, cantidad: "0" } : item,
                  ),
                }
              : draft,
            fecha: new Date().toISOString(),
          })
          rejectNext = false
        }}
      />
    </div>
  )
}
createRoot(document.getElementById("test-root")!).render(<Fixture />)
const pause = () => new Promise((resolve) => setTimeout(resolve, 45))
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
const names = latest.inventario.productos.map((item) => item.nombre)
function quantity(id: number) {
  return document.querySelector<HTMLInputElement>(
    'dialog input[aria-label="Cantidad para ' + names[id - 1] + '"]',
  )!
}
function cards() {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      "dialog .purchase-product-card",
    ),
  ]
}
function selected(ids: number[]) {
  assert(
    cards()
      .filter((item) => item.getAttribute("aria-pressed") === "true")
      .map((item) => item.id)
      .join() === ids.map((id) => "transfer-product-" + id).join(),
    "Orden FIFO y selección",
  )
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
  assert(event.defaultPrevented, "Enter de escáner consumido")
  await pause()
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
      await fill(target, "4")
    if (key === "Enter") assert(event.defaultPrevented, "Escáner global")
  }
  await pause()
}
async function test(name: string, action: () => Promise<void>) {
  await action()
  reports.push("✓ " + name)
  document.getElementById("results")!.textContent = reports.join("\n")
}
async function open() {
  await click(document.getElementById("inventory-transfer-trigger")!)
}
async function run() {
  await pause()
  await test("Tres ubicaciones y origen obligatorio inicialmente vacío", async () => {
    assert(
      document.querySelectorAll('[id^="inventory-location-"]').length === 3,
      "Ubicaciones",
    )
    await open()
    assert(
      field("transfer-origin").value === "" && button("Siguiente").disabled,
      "Origen vacío",
    )
    assert(
      getComputedStyle(document.querySelector("dialog")!).backdropFilter ===
        "blur(8px)",
      "Glassmorphism",
    )
  })
  await test("FIFO, desmarcado y filtros aislados de categoría, código y origen", async () => {
    await click(document.getElementById("transfer-product-2")!)
    await click(document.getElementById("transfer-product-3")!)
    selected([2, 3])
    await click(document.getElementById("transfer-product-2")!)
    assert(
      cards()
        .map((card) => card.id)
        .join() ===
        [3, 1, 2, 4, 5, 6].map((id) => "transfer-product-" + id).join(),
      "Vuelve al catálogo",
    )
    await click(document.getElementById("transfer-product-2")!)
    await fill(field("transfer-code"), "UNKNOWN")
    await fill(field("transfer-category"), "4")
    await fill(field("transfer-origin"), "3")
    selected([3, 2])
    assert(cards().length === 2, "Filtros no ocultan seleccionados")
    await click(document.getElementById("transfer-product-3")!)
    await click(document.getElementById("transfer-product-2")!)
    assert(
      cards().length === 0 && button("Siguiente").disabled,
      "Origen sin stock",
    )
    await fill(field("transfer-code"), "")
    await fill(field("transfer-category"), "")
    await fill(field("transfer-origin"), "1")
  })
  await test("Escáner individual, paquete y fuera del campo; duplicados y desconocidos", async () => {
    await fill(field("transfer-code"), "PACK-000001")
    await enter(field("transfer-code"))
    selected([1])
    assert(field("transfer-code").value === "", "Limpia código")
    await scan(field("transfer-category"), "DEMO-000002")
    selected([1, 2])
    assert(
      field("transfer-category").value === "",
      "Restaura filtro alterado por lector",
    )
    await fill(field("transfer-code"), "DEMO-000001")
    await enter(field("transfer-code"))
    selected([1, 2])
    await fill(field("transfer-code"), "UNKNOWN")
    await enter(field("transfer-code"))
    assert(
      document
        .querySelector('[role="alert"]')
        ?.textContent?.includes("Código no encontrado"),
      "Código desconocido",
    )
    await click(button("Siguiente"))
    assert(
      document.querySelector<HTMLInputElement>(
        'input[name="transfer-presentation-1"][aria-label^="Paquete"]',
      )!.checked,
      "Escaneo paquete sin sobrescribir por duplicado",
    )
    assert(
      document.querySelector<HTMLInputElement>(
        'input[name="transfer-presentation-2"][aria-label^="Unidad"]',
      )!.checked,
      "Escaneo individual",
    )
  })
  await test("Anterior conserva cantidades; cambiar origen limpia destino coincidente", async () => {
    await fill(quantity(1), "2")
    await fill(quantity(2), "3")
    await fill(field("transfer-destination"), "2")
    const originOption = document.querySelector<HTMLOptionElement>(
      '#transfer-destination option[value="1"]',
    )!
    assert(originOption.disabled, "Destino no coincide")
    await click(button("Anterior"))
    selected([1, 2])
    await fill(field("transfer-origin"), "2")
    await click(button("Siguiente"))
    assert(
      field("transfer-destination").value === "",
      "Limpia destino anterior",
    )
    assert(
      quantity(1).value === "2" && quantity(2).value === "3",
      "Conserva cantidades",
    )
    await fill(field("transfer-destination"), "3")
    await fill(quantity(1), "3")
    assert(button("Confirmar").disabled, "36 unidades exceden stock 30")
    await fill(quantity(1), "2")
    assert(!button("Confirmar").disabled, "24 unidades válidas")
  })
  await test("Revalidación del reducer mantiene modal y stock; doble envío confirma una sola vez", async () => {
    const before = JSON.stringify(latest.inventario)
    rejectNext = true
    await click(button("Confirmar"))
    assert(document.querySelector("dialog"), "Error mantiene modal abierto")
    assert(
      JSON.stringify(latest.inventario) === before,
      "Error conserva inventario",
    )
    assert(
      document
        .querySelector('[role="alert"]')
        ?.textContent?.includes("entera positiva"),
      "Error del reducer visible",
    )
    const confirm = button("Confirmar")
    confirm.click()
    confirm.click()
    await pause()
    assert(latest.inventario.traspasos.length === 1, "Un solo movimiento")
    assert(!document.querySelector("dialog"), "Cierra al éxito")
    assert(
      latest.inventario.existencias.find(
        (item) => item.productoId === 1 && item.almacenId === 2,
      )!.stock === 6,
      "Descuenta paquetes",
    )
    assert(
      latest.inventario.existencias.find(
        (item) => item.productoId === 1 && item.almacenId === 3,
      )!.stock === 24,
      "Suma destino",
    )
    assert(
      document
        .querySelector(".product-toast")
        ?.textContent?.includes("Traspaso de 2 productos"),
      "Toast",
    )
    assert(
      document.activeElement?.id === "inventory-transfer-trigger",
      "Restaura foco",
    )
  })
  await test("Reapertura limpia, papelera y escáner inactivo en paso 2", async () => {
    await open()
    assert(
      field("transfer-origin").value === "" && button("Siguiente").disabled,
      "Borrador reiniciado",
    )
    await click(document.getElementById("transfer-product-1")!)
    await fill(field("transfer-origin"), "1")
    await click(button("Siguiente"))
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    })
    for (const key of "PACK-000003")
      quantity(1).dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      )
    quantity(1).dispatchEvent(event)
    assert(!event.defaultPrevented, "Lector retirado")
    await click(
      document.querySelector<HTMLButtonElement>(
        'button[aria-label="Quitar ' + names[0] + '"]',
      )!,
    )
    assert(
      button("Confirmar").disabled &&
        !document.querySelector(".transfer-table tbody tr"),
      "Lista vacía",
    )
    await click(button("Anterior"))
    assert(button("Siguiente").disabled, "Siguiente bloqueado")
    await click(button("Cancelar"))
  })
  await test("Cancelar, X, Escape y clic exterior descartan y retiran listeners", async () => {
    const before = JSON.stringify(latest.inventario)
    await open()
    await click(document.getElementById("transfer-product-1")!)
    await click(button("Cancelar"))
    await open()
    await click(
      document.querySelector<HTMLButtonElement>("dialog .purchase-close")!,
    )
    await open()
    document
      .querySelector("dialog")!
      .dispatchEvent(new Event("cancel", { cancelable: true }))
    await pause()
    await open()
    const dialog = document.querySelector("dialog")!
    const bounds = dialog.getBoundingClientRect()
    for (const type of ["pointerdown", "pointerup"])
      dialog.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          clientX: bounds.left - 2,
          clientY: bounds.top - 2,
        }),
      )
    await pause()
    assert(!document.querySelector("dialog"), "Clic exterior cierra")
    assert(
      JSON.stringify(latest.inventario) === before,
      "Cancelar nunca modifica stock",
    )
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    })
    for (const key of "PACK-000003")
      window.dispatchEvent(new KeyboardEvent("keydown", { key }))
    window.dispatchEvent(event)
    assert(!event.defaultPrevented, "Sin listener residual")
  })
  document.getElementById("results")!.textContent += "\n7/7 pruebas aprobadas"
}
if (new URLSearchParams(window.location.search).has("preview"))
  document.getElementById("results")!.textContent =
    "Vista manual para revisar tamaños de pantalla"
else
  run().catch((error) => {
    document.getElementById("results")!.textContent =
      reports.join("\n") + "\nERROR: " + error.message
    console.error(error)
  })
