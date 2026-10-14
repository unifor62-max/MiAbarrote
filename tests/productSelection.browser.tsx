import React, { useState } from "react"
import { createRoot } from "react-dom/client"
import PurchaseModal from "../src/features/purchases/PurchaseModal"
import SaleModal from "../src/features/sales/SaleModal"
import { createPOSAppState, saleCatalog } from "../src/data/sales"
import "../src/index.css"

const state = createPOSAppState()
const products = saleCatalog(state.inventario, new Date().toISOString())
  .filter((p) => p.stockVendible)
  .slice(0, 3)
function Fixture() {
  const [kind, setKind] = useState<"sale" | "purchase" | null>(null)
  return (
    <>
      <button id="open-sale" onClick={() => setKind("sale")}>
        Venta
      </button>
      <button id="open-purchase" onClick={() => setKind("purchase")}>
        Compra
      </button>
      {kind === "sale" && (
        <SaleModal
          inventario={state.inventario}
          error=""
          onClose={() => setKind(null)}
          onSell={() => {
            throw new Error("Venta accidental")
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
            throw new Error("Compra accidental")
          }}
        />
      )}
    </>
  )
}
createRoot(document.getElementById("test-root")!).render(<Fixture />)
const pause = () => new Promise((resolve) => setTimeout(resolve, 40))
const reports: string[] = []
function assert(value: unknown, message: string) {
  if (!value) throw new Error(message)
}
function cards() {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      ".sale-product-card, .purchase-product-card",
    ),
  ]
}
function card(id: number) {
  return cards().find((c) => c.id.endsWith("-product-" + id))!
}
function code() {
  return document.querySelector<HTMLInputElement>("dialog input[id$='-code']")!
}
function category() {
  return document.querySelector<HTMLSelectElement>(
    "dialog select[id$='-category']",
  )!
}
function button(text: string) {
  return [
    ...document.querySelectorAll<HTMLButtonElement>("dialog button"),
  ].find((b) => b.textContent?.trim() === text)!
}
async function click(target: HTMLElement) {
  target.focus()
  target.click()
  await pause()
}
async function fill(
  field: HTMLInputElement | HTMLSelectElement,
  value: string,
) {
  const proto =
    field instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLSelectElement.prototype
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value)
  field.dispatchEvent(
    new Event(field instanceof HTMLInputElement ? "input" : "change", {
      bubbles: true,
    }),
  )
  await pause()
}
async function enter(field: HTMLElement) {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
  })
  field.dispatchEvent(event)
  assert(event.defaultPrevented, "Enter debe consumirse")
  await pause()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}
async function scan(field: HTMLElement, value: string) {
  field.focus()
  const start = performance.now()
  for (const [i, key] of [...value, "Enter"].entries()) {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(event, "timeStamp", { value: start + i * 10 })
    field.dispatchEvent(event)
    if (key === "Enter")
      assert(event.defaultPrevented, "Enter global consumido")
  }
  await pause()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}
function order(ids: number[]) {
  assert(
    cards()
      .slice(0, ids.length)
      .every(
        (c, i) =>
          c.id.endsWith("-product-" + ids[i]) &&
          c.getAttribute("aria-pressed") === "true",
      ),
    "Orden de seleccionados",
  )
}
async function test(name: string, action: () => Promise<void>) {
  await action()
  reports.push("✓ " + name)
  document.getElementById("results")!.textContent = reports.join("\n")
}
async function run() {
  await pause()
  for (const kind of ["sale", "purchase"] as const) {
    await click(document.getElementById("open-" + kind)!)
    const [first, second, third] = products
    await test(
      kind +
        ": selección manual se fija en orden de llegada y vuelve al catálogo al quitarse",
      async () => {
        await click(card(second.id))
        await click(card(first.id))
        order([second.id, first.id])
        await click(card(second.id))
        order([first.id])
        const remaining = cards()
          .slice(1)
          .map((c) => Number(c.id.split("-product-")[1]))
        assert(
          JSON.stringify(remaining) ===
            JSON.stringify(
              state.inventario.productos
                .filter((p) => p.id !== first.id)
                .map((p) => p.id),
            ),
          "Orden original del catálogo",
        )
        await click(card(second.id))
        order([first.id, second.id])
      },
    )
    await test(
      kind + ": código y categoría nunca ocultan seleccionados",
      async () => {
        await fill(code(), "UNKNOWN")
        await fill(category(), String(state.inventario.categorias.at(-1)!.id))
        order([first.id, second.id])
        assert(
          cards().length === 2,
          "Solo seleccionados con filtro sin resultados",
        )
      },
    )
    await test(
      kind +
        ": códigos de paquete, repetición y escáner global sin avanzar ni duplicar",
      async () => {
        const pack = state.inventario.paquetes.find(
          (p) => p.id === third.paqueteId,
        )!
        await fill(code(), pack.codigo_barra!)
        await enter(code())
        order([first.id, second.id, third.id])
        assert(code().value === "", "Código limpio")
        assert(
          category().value === String(state.inventario.categorias.at(-1)!.id),
          "Escanear conserva el filtro de categoría",
        )
        await scan(button("Cancelar"), third.codigo_barra)
        order([first.id, second.id, third.id])
        assert(
          cards().filter((c) => c.getAttribute("aria-pressed") === "true")
            .length === 3,
          "Sin duplicados",
        )
        assert(
          code().value === "" && document.activeElement === code(),
          "Listo para siguiente lectura",
        )
        await fill(code(), "UNKNOWN")
        await enter(code())
        order([first.id, second.id, third.id])
        assert(
          document.querySelector("dialog [role='alert']"),
          "Código desconocido",
        )
      },
    )
    await test(
      kind +
        ": Siguiente y Anterior conservan orden; Cancelar descarta y retira listeners",
      async () => {
        await click(button("Siguiente"))
        const names =
          kind === "sale"
            ? [
                ...document.querySelectorAll(
                  ".sale-config-table tbody tr td:first-child strong",
                ),
              ].map((e) => e.textContent)
            : [...document.querySelectorAll(".purchase-line-name strong")].map(
                (e) => e.textContent,
              )
        assert(
          JSON.stringify(names) ===
            JSON.stringify([first.nombre, second.nombre, third.nombre]),
          "Orden en paso 2",
        )
        await click(button("Anterior"))
        order([first.id, second.id, third.id])
        await click(button("Cancelar"))
        const event = new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        })
        for (const key of first.codigo_barra)
          window.dispatchEvent(new KeyboardEvent("keydown", { key }))
        window.dispatchEvent(event)
        assert(!event.defaultPrevented, "Listener retirado")
        await click(document.getElementById("open-" + kind)!)
        assert(
          button("Siguiente").disabled &&
            !cards().some((c) => c.getAttribute("aria-pressed") === "true"),
          "Reapertura limpia",
        )
        await click(button("Cancelar"))
      },
    )
  }
  document.getElementById("results")!.textContent += "\n8/8 pruebas aprobadas"
}
run().catch((error) => {
  document.getElementById("results")!.textContent =
    reports.join("\n") + "\nERROR: " + error.message
})
