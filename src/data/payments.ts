export const tiposPago = [
  { id: 1, nombre: "QR" },
  { id: 2, nombre: "Híbrido" },
  { id: 3, nombre: "Efectivo" },
] as const

export type PaymentMode = 1 | 2 | 3
export interface DetallePago {
  /** Todos los importes internos están en centavos. */
  monto_qr: number
  monto_efectivo: number
}
export interface PaymentNotification {
  id: string
  titular: string
  montoCentavos: number
  timestamp: string
  receivedAt: number
  source: "demo" | "cloud"
  sequence?: number
}
export interface SalePaymentDraft {
  tipoPagoId: PaymentMode
  detallePago: DetallePago
  notificacion?: PaymentNotification
  manual?: boolean
}

export function parsePaymentMoney(value: string): number | null {
  const text = value.trim().replace(",", ".")
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null
  const [whole, fraction = ""] = text.split(".")
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
  return Number.isSafeInteger(cents) ? cents : null
}

export function paymentInput(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`
}

function normalizePaymentIdentity(data: Record<string, unknown>) {
  const titular = typeof data.titular === "string" ? data.titular.trim() : ""
  const timestamp = typeof data.timestamp === "string" ? data.timestamp : ""
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(
      timestamp,
    )
  if (
    !titular ||
    titular.length > 120 ||
    /[\u0000-\u001f]/.test(String(data.titular))
  )
    throw new Error("El titular es obligatorio y admite hasta 120 caracteres.")
  if (
    !match ||
    !Number.isFinite(Date.parse(timestamp)) ||
    Number(match[2]) < 1 ||
    Number(match[2]) > 12 ||
    Number(match[3]) < 1 ||
    Number(match[3]) >
      new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate()
  )
    throw new Error(
      "El timestamp debe ser una fecha ISO válida con zona horaria.",
    )
  return { titular, timestamp: new Date(timestamp).toISOString() }
}

export function normalizePaymentPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") throw new Error("Pago inválido.")
  const data = payload as Record<string, unknown>
  const identity = normalizePaymentIdentity(data)
  const cents = typeof data.monto === "number" ? parsePaymentMoney(String(data.monto)) : null
  if (cents === null || cents <= 0) throw new Error("El monto debe ser positivo, con hasta dos decimales.")
  if (
    data.id !== undefined &&
    (typeof data.id !== "string" || !/^[\w.-]{1,128}$/.test(data.id))
  )
    throw new Error("El id de notificación es inválido.")
  return {
    ...identity,
    montoCentavos: cents,
    externalId: data.id as string | undefined,
  }
}

export function validatePaymentNotification(value: unknown, source: "demo" | "cloud"): PaymentNotification {
  if (!value || typeof value !== "object") throw new Error("Notificación inválida.")
  const data = value as PaymentNotification
  const identity = normalizePaymentIdentity(value as Record<string, unknown>)
  if (data.source !== source || typeof data.id !== "string" || !/^[\w.-]{1,128}$/.test(data.id) ||
    !Number.isSafeInteger(data.montoCentavos) || data.montoCentavos <= 0 ||
    !Number.isSafeInteger(data.receivedAt) || data.receivedAt < 0 ||
    (source === "cloud" && (!/^[a-f0-9]{64}$/.test(data.id) || !Number.isSafeInteger(data.sequence))))
    throw new Error("Notificación inválida.")
  // Already normalized amounts never make a round trip through floating-point bolivianos.
  return { ...data, ...identity }
}

export function paymentError(payment: SalePaymentDraft, total: number): string {
  const { monto_qr: qr, monto_efectivo: cash } = payment.detallePago
  if (![1, 2, 3].includes(payment.tipoPagoId))
    return "Selecciona un método de pago válido."
  if (
    !Number.isSafeInteger(total) ||
    total <= 0 ||
    !Number.isSafeInteger(qr) ||
    !Number.isSafeInteger(cash) ||
    qr < 0 ||
    cash < 0
  )
    return "Ingresa importes válidos, sin negativos y con hasta dos decimales."
  if (qr + cash !== total)
    return "QR y efectivo deben sumar exactamente el total de la venta."
  if (payment.tipoPagoId === 3)
    return qr === 0 &&
      cash === total &&
      !payment.notificacion &&
      !payment.manual
      ? ""
      : "El pago en efectivo debe cubrir el total."
  if (
    payment.tipoPagoId === 1 &&
    (cash !== 0 || qr !== total || payment.manual)
  )
    return "El pago QR debe coincidir exactamente con el total."
  if (payment.tipoPagoId === 2 && (qr <= 0 || cash <= 0))
    return "El pago híbrido requiere importes QR y efectivo mayores a cero."
  if (payment.manual && payment.tipoPagoId === 2 && !payment.notificacion)
    return ""
  const event = payment.notificacion
  if (
    !event ||
    !event.id ||
    !event.titular ||
    event.montoCentavos !== qr ||
    !Number.isSafeInteger(event.montoCentavos) ||
    !Number.isFinite(Date.parse(event.timestamp)) ||
    !Number.isFinite(event.receivedAt) ||
    !["demo", "cloud"].includes(event.source)
  )
    return "Espera una notificación QR válida o registra el desglose híbrido manualmente."
  return ""
}

export function cashPayment(total: number): SalePaymentDraft {
  return { tipoPagoId: 3, detallePago: { monto_qr: 0, monto_efectivo: total } }
}
