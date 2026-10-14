import React from "react"
import { createRoot } from "react-dom/client"
import App from "../src/App"
import { getPaymentListener } from "../src/features/payments/PaymentWebhookListener"
import type { PaymentNotification } from "../src/data/payments"
import "../src/index.css"

createRoot(document.getElementById("test-root")!).render(<App />)
const pause = () => new Promise((resolve) => setTimeout(resolve, 70))
const reports: string[] = []
const listener = getPaymentListener()
let lastPayment: PaymentNotification
const unsubscribe = listener.subscribe((event) => {
  lastPayment = event
})
function assert(value: unknown, message: string) {
  if (!value) throw new Error(message)
}
function button(text: string, scope: ParentNode = document) {
  const result = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === text,
  )
  assert(result, "No se encontró botón " + text)
  return result!
}
function input(id: string) {
  return document.getElementById(id) as HTMLInputElement
}
async function click(target: HTMLElement) {
  target.click()
  await pause()
}
async function waitFor(condition: () => unknown) {
  const deadline = performance.now() + 5000
  while (!condition()) {
    if (performance.now() > deadline)
      throw new Error("La interfaz no completó la operación esperada.")
    await pause()
  }
}
async function fill(target: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!.call(target, value)
  target.dispatchEvent(new Event("input", { bubbles: true }))
  await pause()
}
async function mode(text: string) {
  const label = [
    ...document.querySelectorAll<HTMLLabelElement>(".sale-payment-mode"),
  ].find((item) => item.textContent?.trim() === text)!
  await click(label.querySelector("input")!)
}
function amount() {
  return (
    Number(input("sale-payment-cash").value) +
    Number(input("sale-payment-qr").value)
  )
}
function confirmation() {
  return button("Confirmar")
}
async function newSale(step2 = true) {
  await click(document.getElementById("register-sale-trigger")!)
  await click(document.getElementById("sale-product-1")!)
  if (step2) await click(button("Siguiente"))
}
async function simulate(titular: string, value: number) {
  window.simularPagoQR!(titular, value)
  await pause()
}
async function test(name: string, run: () => Promise<void>) {
  await run()
  reports.push("✓ " + name)
  document.getElementById("results")!.textContent = reports.join("\n")
}
async function receipt(id: number) {
  await click(
    document.querySelector<HTMLButtonElement>(
      `button[aria-label="Ver detalle de venta V-${id}"]`,
    )!,
  )
}
async function run() {
  await pause()
  await click(button("Iniciar sesión"))
  await click(button("Ventas"))
  await test("Efectivo inicial cubre todo el total y conserva el wizard de dos pasos", async () => {
    await newSale()
    assert(
      document.querySelectorAll(".sale-payment-mode input").length === 3,
      "Tres modos",
    )
    assert(
      input("sale-payment-qr").disabled && input("sale-payment-cash").disabled,
      "Campos de efectivo bloqueados",
    )
    assert(
      input("sale-payment-qr").value === "0.00" &&
        input("sale-payment-cash").value === "38.50",
      "Importes por defecto",
    )
    assert(!confirmation().disabled, "Efectivo confirma sin webhook")
  })
  await test("QR exige igualdad exacta y conserva la primera notificación válida", async () => {
    await mode("QR")
    assert(confirmation().disabled, "QR espera notificación")
    await simulate("Importe incorrecto", 38)
    assert(
      confirmation().disabled &&
        document
          .querySelector('[role="alert"]')
          ?.textContent?.includes("Discrepancia"),
      "Rechaza discrepancia",
    )
    await simulate("Ana Pérez", 38.5)
    assert(
      !confirmation().disabled && input("sale-payment-qr").value === "38.50",
      "Acepta igualdad",
    )
    await simulate("Otro cliente", 99)
    assert(
      input("sale-payment-qr").value === "38.50" &&
        document
          .querySelector(".sale-payment-help")
          ?.textContent?.includes("Ana Pérez"),
      "No reemplaza pago aplicado",
    )
    assert(
      document.querySelector(".payment-toast:popover-open"),
      "Toast visible sobre dialog",
    )
    const quantity = document.querySelector<HTMLInputElement>(
      'input[aria-label="Cantidad para Aceite vegetal 900 ml"]',
    )!
    await fill(quantity, "2")
    assert(confirmation().disabled, "Cambio de total invalida QR")
    await fill(quantity, "1")
    assert(!confirmation().disabled, "Restauración revalida importe")
  })
  await test("Error de confirmación mantiene modal y stock; doble envío registra una sola venta", async () => {
    const original = listener.transition.bind(listener)
    listener.transition = async (...args) => {
      if (args[1] === "consume") throw new Error("Error de conexión de prueba")
      return original(...args)
    }
    await click(confirmation())
    assert(
      document.querySelector("dialog") &&
        document
          .querySelector('[role="alert"]')
          ?.textContent?.includes("Error de conexión"),
      "Error conserva modal",
    )
    assert(
      document
        .querySelector(".details-pagination")
        ?.textContent?.includes("24 ventas"),
      "Sin nueva venta",
    )
    let releaseConsume: (() => void) | undefined
    listener.transition = async (...args) => {
      if (args[1] === "consume")
        await new Promise<void>((resolve) => {
          releaseConsume = resolve
        })
      return original(...args)
    }
    const confirm = confirmation()
    confirm.click()
    confirm.click()
    await pause()
    assert(
      document
        .querySelector("fieldset.sale-editable-fields")
        ?.hasAttribute("disabled"),
      "Bloqueo mientras consume",
    )
    await click(document.querySelector<HTMLButtonElement>(".purchase-close")!)
    assert(
      document.querySelector("dialog"),
      "Cerrar bloqueado durante confirmación",
    )
    releaseConsume!()
    await waitFor(() => !document.querySelector("dialog"))
    listener.transition = original
    assert(!document.querySelector("dialog"), "Cierra al éxito")
    assert(
      document
        .querySelector(".details-pagination")
        ?.textContent?.includes("25 ventas"),
      "Una sola venta",
    )
    await receipt(25)
    assert(
      document.querySelector("dialog")?.textContent?.includes("Ana Pérez") &&
        document
          .querySelector("dialog")
          ?.textContent?.includes("Método de pagoQR"),
      "Comprobante QR con titular",
    )
    await click(button("Cerrar", document.querySelector("dialog")!))
  })
  await test("Híbrido rellena QR y diferencia, rechaza sobrepago y recalcula al cambiar total", async () => {
    await newSale()
    await mode("Híbrido")
    await simulate("Sobrepago", 100)
    assert(confirmation().disabled, "Sobrepago rechazado")
    await simulate("Bruno", 10)
    assert(
      input("sale-payment-qr").value === "10.00" &&
        input("sale-payment-cash").value === "28.50",
      "Diferencia automática",
    )
    const quantity = document.querySelector<HTMLInputElement>(
      'input[aria-label="Cantidad para Aceite vegetal 900 ml"]',
    )!
    await fill(quantity, "2")
    assert(
      input("sale-payment-cash").value === "67.00" && !confirmation().disabled,
      "Recalcula efectivo",
    )
    await fill(quantity, "1")
  })
  await test("Contingencia manual libera evidencia y valida importes positivos y suma exacta", async () => {
    await fill(input("sale-payment-qr"), "12.50")
    assert(confirmation().disabled, "Suma incorrecta bloquea")
    await fill(input("sale-payment-cash"), "26.00")
    assert(!confirmation().disabled, "Suma exacta habilita")
    await fill(input("sale-payment-qr"), "0")
    assert(confirmation().disabled, "Ambos deben ser positivos")
    await fill(input("sale-payment-qr"), "-1")
    assert(confirmation().disabled, "Negativo rechazado")
    await fill(input("sale-payment-qr"), "12.50")
    await click(confirmation())
    await waitFor(() => !document.querySelector("dialog"))
    await receipt(26)
    assert(
      document
        .querySelector("dialog")
        ?.textContent?.includes("Registro manual de contingencia"),
      "Comprobante manual",
    )
    assert(
      !document.querySelector("dialog")?.textContent?.includes("Bruno"),
      "No atribuye evidencia liberada",
    )
    await click(button("Cerrar", document.querySelector("dialog")!))
  })
  await test("Pagos anteriores al paso 2 no se aplican; Cambiar pago y Cancelar liberan reservas", async () => {
    await newSale(false)
    await simulate("Anterior al paso 2", 38.5)
    await click(button("Siguiente"))
    await mode("QR")
    assert(confirmation().disabled, "No reaplica pago anterior")
    await simulate("Cambio", 38.5)
    assert(!confirmation().disabled, "Pago actual válido")
    const replaced = lastPayment!
    await click(button("Cambiar pago"))
    assert(confirmation().disabled, "Espera una notificación nueva")
    await listener.transition(replaced, "reserve", "other-owner")
    await listener.transition(replaced, "release", "other-owner")
    await simulate("Cancelado", 38.5)
    const cancelled = lastPayment!
    await click(button("Cancelar"))
    assert(!document.querySelector("dialog"), "Cancelación cierra")
    await listener.transition(cancelled, "reserve", "other-owner")
    await listener.transition(cancelled, "release", "other-owner")
    assert(
      document
        .querySelector(".details-pagination")
        ?.textContent?.includes("26 ventas"),
      "Cancelar no registra",
    )
  })
  await test("Cancelar permite salir aunque falle la liberación de la reserva", async () => {
    await newSale()
    await mode("QR")
    await simulate("Conexión interrumpida", 38.50)
    await waitFor(() => !confirmation().disabled)
    const event = lastPayment!
    const lease = JSON.parse(localStorage.getItem("miabarrote:payment-lease:" + event.id)!)
    const original = listener.transition.bind(listener)
    listener.transition = async (...args) => {
      if (args[1] === "release") throw new Error("Sesión vencida")
      return original(...args)
    }
    try {
      await click(button("Cancelar"))
      await waitFor(() => !document.querySelector("dialog"))
      assert(document.querySelector('.details-pagination')?.textContent?.includes("26 ventas"), "Cancelar no registra ni queda atrapado")
    } finally {
      listener.transition = original
      await original(event, "release", lease.owner)
    }
  })
  await test("Cambiar método reinicia desglose y el pago efectivo se registra correctamente", async () => {
    await newSale()
    await mode("Híbrido")
    await fill(input("sale-payment-qr"), "10.00")
    await fill(input("sale-payment-cash"), "28.50")
    assert(amount() === 38.5, "Desglose manual")
    await mode("Efectivo")
    assert(
      input("sale-payment-qr").value === "0.00" &&
        input("sale-payment-cash").value === "38.50",
      "Reinicia efectivo",
    )
    await click(confirmation())
    await waitFor(() => !document.querySelector("dialog"))
    await receipt(27)
    assert(
      document
        .querySelector("dialog")
        ?.textContent?.includes("Método de pagoEfectivo"),
      "Comprobante de efectivo",
    )
    await click(button("Cerrar", document.querySelector("dialog")!))
  })
  unsubscribe()
  document.getElementById("results")!.textContent += "\n8/8 pruebas aprobadas"
}
if (new URLSearchParams(location.search).has("preview"))
  document.getElementById("results")!.textContent =
    "Vista manual del flujo de pagos"
else
  run().catch((error) => {
    unsubscribe()
    document.getElementById("results")!.textContent =
      reports.join("\n") + "\nERROR: " + error.message
    console.error(error)
  })
