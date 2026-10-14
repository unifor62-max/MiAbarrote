import React, { useCallback, useState } from "react"
import { createRoot } from "react-dom/client"
import CatalogModal from "../src/features/purchases/CatalogModal"
import SupplierToast from "../src/features/purchases/SupplierToast"
import { appendProduct, createPurchaseState } from "../src/data/purchases"
import "../src/index.css"

let latest = createPurchaseState()
function Fixture() {
  const [state, setState] = useState(latest)
  const [open, setOpen] = useState(true)
  const [notice, setNotice] = useState("")
  const clearNotice = useCallback(() => setNotice(""), [])
  latest = state
  return (
    <>
      <button
        id="reopen"
        onClick={() => {
          setNotice("")
          setOpen(true)
        }}
      >
        Nuevo producto
      </button>
      {open && (
        <CatalogModal
          kind="product"
          state={state}
          onClose={() => setOpen(false)}
          onName={() => {
            throw new Error("Ruta incorrecta")
          }}
          onProduct={(draft) => {
            setState(appendProduct(state, draft))
            setOpen(false)
            setNotice("Producto agregado: " + draft.nombre)
          }}
        />
      )}
      <SupplierToast message={notice} onClose={clearNotice} />
    </>
  )
}
createRoot(document.getElementById("test-root")!).render(<Fixture />)
const pause = () => new Promise((resolve) => setTimeout(resolve, 30))
function assert(value: unknown, message: string) {
  if (!value) throw new Error(message)
}
function input(suffix: string) {
  return document.querySelector<HTMLInputElement>(
    "dialog input[id$='-" + suffix + "']",
  )!
}
function button(name: string) {
  return [
    ...document.querySelectorAll<HTMLButtonElement>("dialog button"),
  ].find((item) => item.textContent === name)!
}
function checkbox(name: string) {
  return document.querySelector<HTMLInputElement>(
    "dialog input[aria-label='" + name + "']",
  )!
}
async function fill(
  field: HTMLInputElement | HTMLSelectElement,
  value: string,
) {
  const proto =
    field instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value)
  field.dispatchEvent(
    new Event(field instanceof HTMLSelectElement ? "change" : "input", {
      bubbles: true,
    }),
  )
  await pause()
}
async function scan(field: HTMLInputElement, value: string) {
  field.focus()
  for (const char of value) {
    field.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: char,
        bubbles: true,
        cancelable: true,
      }),
    )
    await fill(field, field.value + char)
  }
  const enter = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
  })
  field.dispatchEvent(enter)
  assert(enter.defaultPrevented, "Enter del lector no envía el formulario")
  await pause()
}
const results: string[] = []
const output = document.getElementById("results")!
async function test(name: string, work: () => Promise<void>) {
  await work()
  results.push("✓ " + name)
  output.textContent = results.join("\n")
}
async function reopen() {
  document.getElementById("reopen")!.click()
  await pause()
}
async function run() {
  await pause()
  await test("Paquete desactivado al abrir, campos visibles en gris y código producto obligatorio", async () => {
    assert(
      input("package-code").disabled && input("package").disabled,
      "Ambos inputs deshabilitados",
    )
    assert(
      !checkbox("Activar código paquete").checked &&
        !checkbox("Activar precio por paquete").checked,
      "Checkboxes desmarcados",
    )
    assert(
      getComputedStyle(input("package-code")).cursor === "not-allowed",
      "Cursor de campo bloqueado",
    )
    assert(button("Guardar").disabled, "No guardar vacíos")
    await fill(document.querySelector<HTMLSelectElement>("dialog select")!, "1")
    await fill(input("name"), "Producto escaneado")
    await fill(input("unit"), "2,50")
    assert(button("Guardar").disabled, "Código producto obligatorio")
  })
  await test("Escaneo individual conserva ceros, avanza a Nombre y no guarda", async () => {
    await scan(input("barcode"), "001234567890")
    assert(
      input("barcode").value === "001234567890",
      "Ceros iniciales conservados",
    )
    assert(document.activeElement === input("name"), "Saltar paquete inactivo")
    assert(
      latest.productos.length === 6 && document.querySelector("dialog[open]"),
      "Escanear no guarda",
    )
    assert(!button("Guardar").disabled, "Datos base suficientes")
  })
  await test("Checkboxes independientes, código de caja escaneado y limpieza al desmarcar", async () => {
    checkbox("Activar código paquete").click()
    await pause()
    assert(
      !input("package-code").disabled && input("package").disabled,
      "Solo código activado",
    )
    await fill(input("barcode"), "")
    await scan(input("barcode"), "001234567890")
    assert(
      document.activeElement === input("package-code"),
      "Avanzar a paquete activo",
    )
    await scan(input("package-code"), "009876543210")
    assert(
      document.activeElement === input("name"),
      "Código paquete avanza a Nombre",
    )
    checkbox("Activar precio por paquete").click()
    await pause()
    await fill(input("package"), "25.00")
    checkbox("Activar código paquete").click()
    await pause()
    assert(
      input("package-code").disabled && input("package-code").value === "",
      "Desmarcar código limpia y bloquea",
    )
    assert(
      !input("package").disabled && input("package").value === "25.00",
      "Precio independiente",
    )
    checkbox("Activar precio por paquete").click()
    await pause()
    assert(
      input("package").disabled && input("package").value === "",
      "Desmarcar precio limpia y bloquea",
    )
    button("Guardar").click()
    await pause()
    assert(!document.querySelector("dialog"), "Guardar cierra")
    assert(latest.productos.length === 7, "Una inserción")
    const product = latest.productos.at(-1)!
    assert(
      product.codigo_paquete === null &&
        product.precio_paquete === null &&
        product.paqueteId === null,
      "Valores null exactos",
    )
    assert(
      document
        .querySelector(".product-toast")
        ?.textContent?.includes("Producto agregado"),
      "Toast de éxito",
    )
  })
  await test("Cancelar y X reabren el formulario limpio y sin mutaciones", async () => {
    await reopen()
    assert(
      input("barcode").value === "" && input("package").disabled,
      "Estado inicial restaurado",
    )
    checkbox("Activar código paquete").click()
    await fill(input("package-code"), "TEMP")
    button("Cancelar").click()
    await pause()
    assert(latest.productos.length === 7, "Cancelar no modifica productos")
    await reopen()
    assert(
      input("package-code").value === "" && input("package-code").disabled,
      "Cancelar limpia checkbox",
    )
    document
      .querySelector<HTMLButtonElement>(
        "dialog button[aria-label='Cerrar nuevo producto']",
      )!
      .click()
    await pause()
    await reopen()
    assert(
      !checkbox("Activar código paquete").checked &&
        !checkbox("Activar precio por paquete").checked,
      "X limpia checkboxes",
    )
    assert(latest.productos.length === 7, "X no modifica productos")
  })
  output.textContent =
    results.join("\n") + "\n4 pruebas de navegador aprobadas."
}
run().catch((error) => {
  output.textContent = results.join("\n") + "\n✗ " + error.message
  console.error(error)
})
