import React, { useReducer, useState } from "react"
import { createRoot } from "react-dom/client"
import PurchaseModal from "../src/features/purchases/PurchaseModal"
import { createPOSAppState, posReducer } from "../src/data/sales"
import "../src/index.css"

// Browser integration fixture: real React controls, native dialog and window listener.
let latest = createPOSAppState()
const initialPurchaseCount = latest.inventario.compras.length
let rejectNext = false
function Fixture() {
  const [state, dispatch] = useReducer(posReducer, latest)
  const [open, setOpen] = useState(true)
  latest = state
  return (
    <>
      <button id="register-purchase-trigger" onClick={() => setOpen(true)}>
        Reabrir
      </button>
      {open && (
        <PurchaseModal
          state={state.inventario}
          feedback={state.purchaseFeedback}
          onClose={() => setOpen(false)}
          onSuccess={() => setOpen(false)}
          onSave={(draft) => {
            dispatch({
              type: "purchase/append",
              draft: rejectNext ? { ...draft, proveedorId: "" } : draft,
            })
            rejectNext = false
          }}
        />
      )}
    </>
  )
}
const root = createRoot(document.getElementById("test-root")!)
root.render(<Fixture />)
const pause = () => new Promise((resolve) => setTimeout(resolve, 30))
const output = document.getElementById("results")!
const results: string[] = []
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}
function input(suffix: string) {
  return document.querySelector<HTMLInputElement>(
    "dialog input[id$='-" + suffix + "']",
  )!
}
function select(suffix: string) {
  return document.querySelector<HTMLSelectElement>(
    "dialog select[id$='-" + suffix + "']",
  )!
}
function button(text: string) {
  return [
    ...document.querySelectorAll<HTMLButtonElement>("dialog button"),
  ].find((item) => item.textContent === text)!
}
async function fill(
  field: HTMLInputElement | HTMLSelectElement,
  value: string,
) {
  const prototype =
    field instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLSelectElement.prototype
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value)
  field.dispatchEvent(
    new Event(field instanceof HTMLSelectElement ? "change" : "input", {
      bubbles: true,
    }),
  )
  await pause()
}
async function click(text: string) {
  button(text).click()
  await pause()
}
async function enter(field: HTMLInputElement) {
  field.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  )
  await pause()
}
async function scan(field: HTMLElement, code: string) {
  field.focus()
  const start = performance.now()
  const keyEvent = (key: string, index: number) => {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    })
    // Deterministic hardware timing, independent of slow CI rendering between keys.
    Object.defineProperty(event, "timeStamp", { value: start + index * 10 })
    return event
  }
  for (const [index, char] of [...code].entries()) {
    field.dispatchEvent(keyEvent(char, index))
    if (field instanceof HTMLInputElement) await fill(field, field.value + char)
    else await pause()
  }
  const event = keyEvent("Enter", code.length)
  field.dispatchEvent(event)
  assert(event.defaultPrevented, "El Enter del escáner debe consumirse")
  await pause()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}
async function test(name: string, work: () => Promise<void>) {
  await work()
  results.push("✓ " + name)
  output.textContent = results.join("\n")
}
function itemInput(productId: number, suffix: string) {
  return document.querySelector<HTMLInputElement>(
    "dialog input[id$='-" + productId + "-" + suffix + "']",
  )!
}
function accordion(index: number) {
  return document.querySelectorAll<HTMLButtonElement>(".purchase-line-heading")[
    index
  ]
}
async function run() {
  await pause()
  await test("Selección múltiple manual y por código, sin duplicados al repetir escaneos", async () => {
    assert(button("Siguiente").disabled, "Siguiente sin selección")
    const card = document.querySelector<HTMLButtonElement>(
      ".purchase-product-card",
    )!
    card.click()
    await pause()
    assert(!button("Siguiente").disabled, "Seleccionar habilita Siguiente")
    card.click()
    await pause()
    assert(
      button("Siguiente").disabled,
      "Deseleccionar el último deshabilita Siguiente",
    )
    card.click()
    await pause()
    await fill(input("code"), "PACK-000002")
    await enter(input("code"))
    await fill(input("code"), "PACK-000002")
    await enter(input("code"))
    assert(
      document
        .querySelector(".purchase-selection-hint")
        ?.textContent?.includes("2 productos"),
      "Dos productos sin duplicados",
    )
    await click("Siguiente")
    assert(
      document.querySelectorAll(".purchase-line-card").length === 2,
      "Una tarjeta por producto",
    )
  })
  await test("Paso 2 sin buscador ni escáner; campos individuales y total reactivo", async () => {
    assert(
      !document.querySelector("input[id$='-code']"),
      "No hay campo Código en paso 2",
    )
    assert(!button("Buscar"), "No hay botón Buscar")
    await fill(select("destination"), "2")
    await fill(select("supplier"), "1")
    await fill(itemInput(1, "quantity"), "2")
    await fill(itemInput(1, "cost"), "12.50")
    await fill(itemInput(1, "expiration"), "2028-02-29")
    await fill(itemInput(2, "quantity"), "3")
    await fill(itemInput(2, "cost"), "10.25")
    assert(
      document.querySelector(".purchase-total")?.textContent === "Bs 55,75",
      "Total suma ambos subtotales",
    )
    assert(
      document.querySelectorAll(".purchase-line-subtotal")[0].textContent ===
        "Bs 25,00",
      "Subtotal independiente",
    )
    assert(
      itemInput(1, "quantity").type === "number" &&
        itemInput(1, "cost").type === "number",
      "Campos numéricos",
    )
    assert(!button("Comprar").disabled, "Vencimiento vacío permitido")
    const start = performance.now()
    for (const [index, char] of [..."PACK-000003"].entries()) {
      const event = new KeyboardEvent("keydown", {
        key: char,
        bubbles: true,
        cancelable: true,
      })
      Object.defineProperty(event, "timeStamp", { value: start + index * 10 })
      itemInput(1, "quantity").dispatchEvent(event)
    }
    const end = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(end, "timeStamp", { value: start + 120 })
    itemInput(1, "quantity").dispatchEvent(end)
    assert(!end.defaultPrevented, "Listener de escáner retirado en paso 2")
    assert(
      document.querySelectorAll(".purchase-line-card").length === 2,
      "Paso 2 no incorpora productos escaneados",
    )
  })
  await test("Acordeones conservan datos y los ítems inválidos bloquean Comprar aun colapsados", async () => {
    accordion(0).click()
    await pause()
    assert(
      accordion(0).getAttribute("aria-expanded") === "false",
      "Cabecera comunica colapso",
    )
    assert(
      document
        .querySelectorAll(".purchase-line-panel")[0]
        .hasAttribute("inert"),
      "Campos colapsados fuera del foco",
    )
    assert(itemInput(1, "cost").value === "12.50", "Colapsar conserva costo")
    assert(
      document.querySelector(".purchase-total")?.textContent === "Bs 55,75",
      "Colapsar conserva total",
    )
    accordion(0).click()
    await fill(itemInput(2, "cost"), "0")
    accordion(1).click()
    await pause()
    assert(
      button("Comprar").disabled,
      "Costo inválido colapsado impide compra parcial",
    )
    accordion(1).click()
    await fill(itemInput(2, "cost"), "10.25")
    assert(!button("Comprar").disabled, "Corregir habilita Comprar")
  })
  await test("Anterior conserva selección, proveedor, destino y datos individuales", async () => {
    await click("Anterior")
    assert(
      document
        .querySelector(".purchase-selection-hint")
        ?.textContent?.includes("2 productos"),
      "Selección intacta",
    )
    await fill(select("category"), "")
    const third = document.querySelectorAll<HTMLButtonElement>(
      ".purchase-product-card",
    )[2]
    third.click()
    await pause()
    await click("Siguiente")
    assert(
      document.querySelectorAll(".purchase-line-card").length === 3,
      "Nuevo producto entra desde paso 1",
    )
    assert(button("Comprar").disabled, "Producto nuevo pendiente impide compra")
    assert(
      itemInput(1, "quantity").value === "2" &&
        itemInput(2, "cost").value === "10.25",
      "Borradores conservados",
    )
    assert(
      itemInput(1, "expiration").value === "2028-02-29",
      "Fecha individual conservada",
    )
    await click("Anterior")
    document
      .querySelectorAll<HTMLButtonElement>(".purchase-product-card")[2]
      .click()
    await pause()
    await click("Siguiente")
    assert(
      select("destination").value === "2" && select("supplier").value === "1",
      "Cabecera conservada",
    )
    assert(
      document.querySelectorAll(".purchase-line-card").length === 2,
      "Deseleccionar retira su fila",
    )
  })
  await test("Error conserva la compra completa; reintento registra una compra y dos lotes una sola vez", async () => {
    rejectNext = true
    await click("Comprar")
    assert(document.querySelector("dialog[open]"), "Error conserva modal")
    assert(
      latest.inventario.compras.length === initialPurchaseCount &&
        itemInput(2, "cost").value === "10.25",
      "Error conserva estado y ambas filas",
    )
    const buy = button("Comprar")
    buy.click()
    buy.click()
    await pause()
    assert(!document.querySelector("dialog"), "Éxito cierra modal")
    assert(latest.inventario.compras.length === initialPurchaseCount + 1, "Una compra nueva")
    assert(
      latest.inventario.compras[0].monto === 5575,
      "Total completo registrado",
    )
    assert(
      latest.inventario.lotes.slice(0, 2).every((lot) => lot.almacenId === 2),
      "Ambos lotes en destino elegido",
    )
    assert(
      latest.inventario.lotes[0].cantidad_inicial === 24 &&
        latest.inventario.lotes[1].cantidad_inicial === 72,
      "Stock individual correcto",
    )
  })
  await test("Reapertura limpia, selección global en paso 1 y limpieza al cancelar", async () => {
    document.getElementById("register-purchase-trigger")!.click()
    await pause()
    assert(
      button("Siguiente").disabled && input("code").value === "",
      "Reabrir sin borrador",
    )
    await scan(button("Cancelar"), "DEMO-000003")
    assert(!button("Siguiente").disabled, "Selección global en paso 1")
    assert(document.activeElement === input("code"), "Código listo para el siguiente escaneo")
    await click("Cancelar")
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    })
    for (const char of "DEMO-000003")
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: char, bubbles: true }),
      )
    window.dispatchEvent(event)
    assert(!event.defaultPrevented, "No queda listener activo")
    assert(latest.inventario.compras.length === initialPurchaseCount + 1, "Cancelar no compra")
  })
  output.textContent =
    results.join("\n") + "\n6 pruebas de navegador aprobadas."
}
run().catch((error) => {
  output.textContent = results.join("\n") + "\n✗ " + error.message
  console.error(error)
})
