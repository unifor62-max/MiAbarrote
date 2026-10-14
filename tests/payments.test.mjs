import assert from "node:assert/strict"
import { test } from "node:test"
import {
  cashPayment,
  normalizePaymentPayload,
  parsePaymentMoney,
  paymentError,
  paymentInput,
  tiposPago,
  validatePaymentNotification,
} from "../src/data/payments.ts"
import {
  createPOSAppState,
  createPOSState,
  posReducer,
  prepareSale,
  registerSale,
} from "../src/data/sales.ts"

const day = "2026-10-13"
const date = day + "T23:00:00.000Z"
const row = { productoId: 1, presentacion: "unidad", cantidad: "1" }
const event = (amount) => ({
  id: "test-payment",
  titular: "Ana Pérez",
  montoCentavos: amount,
  timestamp: date,
  receivedAt: Date.parse(date),
  source: "demo",
})
const qr = (total) => ({
  tipoPagoId: 1,
  detallePago: { monto_qr: total, monto_efectivo: 0 },
  notificacion: event(total),
})

test("payment catalog and exact decimal parsing use cents without floating-point comparisons", () => {
  assert.deepEqual(
    tiposPago.map((item) => [item.id, item.nombre]),
    [
      [1, "QR"],
      [2, "Híbrido"],
      [3, "Efectivo"],
    ],
  )
  for (const [input, cents] of [
    ["150.50", 15050],
    ["0,30", 30],
    ["0", 0],
    ["38.5", 3850],
  ])
    assert.equal(parsePaymentMoney(input), cents)
  for (const value of [
    "",
    "-1",
    "0.001",
    "1e3",
    "NaN",
    "1.234,50",
    "9007199254740992",
  ])
    assert.equal(parsePaymentMoney(value), null)
  assert.equal(
    paymentError(
      {
        tipoPagoId: 2,
        detallePago: { monto_qr: 10, monto_efectivo: 20 },
        manual: true,
      },
      30,
    ),
    "",
  )
  const large = { ...event(Number.MAX_SAFE_INTEGER), id: "test-exact-cents" }
  assert.equal(validatePaymentNotification(large, "demo").montoCentavos, Number.MAX_SAFE_INTEGER)
  assert.equal(paymentInput(Number.MAX_SAFE_INTEGER), "90071992547409.91")
})

test("webhook normalization rejects invalid payloads and preserves exact amounts and ISO timezone", () => {
  assert.deepEqual(
    normalizePaymentPayload({
      titular: " Ana Pérez ",
      monto: 150.5,
      timestamp: "2026-10-13T19:00:00-04:00",
      id: "notice-1",
    }),
    {
      titular: "Ana Pérez",
      montoCentavos: 15050,
      timestamp: date,
      externalId: "notice-1",
    },
  )
  for (const override of [
    { monto: "150.50" },
    { monto: 1.005 },
    { monto: -1 },
    { monto: 0 },
    { monto: Infinity },
    { titular: "" },
    { titular: "x".repeat(121) },
    { titular: "x\n" },
    { timestamp: "2026-02-30T12:00:00Z" },
    { timestamp: "2026-10-13" },
    { id: "invalid id" },
  ])
    assert.throws(() =>
      normalizePaymentPayload({
        titular: "Ana",
        monto: 1,
        timestamp: date,
        ...override,
      }),
    )
})

test("cash, QR and hybrid enforce totals, evidence and positive hybrid portions", () => {
  assert.equal(paymentError(cashPayment(15050), 15050), "")
  assert.equal(paymentError(qr(15050), 15050), "")
  const hybrid = {
    tipoPagoId: 2,
    detallePago: { monto_qr: 10000, monto_efectivo: 5050 },
    notificacion: event(10000),
  }
  assert.equal(paymentError(hybrid, 15050), "")
  assert.equal(
    paymentError({ ...hybrid, notificacion: undefined, manual: true }, 15050),
    "",
  )
  for (const payment of [
    { ...qr(15050), notificacion: undefined },
    { ...qr(15050), manual: true },
    { ...qr(15050), notificacion: event(14950) },
    { ...hybrid, detallePago: { monto_qr: 0, monto_efectivo: 15050 } },
    { ...hybrid, detallePago: { monto_qr: 15050, monto_efectivo: 0 } },
    { ...hybrid, detallePago: { monto_qr: -1, monto_efectivo: 15051 } },
    { ...hybrid, detallePago: { monto_qr: 10000, monto_efectivo: 5051 } },
    { ...hybrid, notificacion: undefined },
    { ...hybrid, tipoPagoId: 99 },
    { ...cashPayment(15050), notificacion: event(1) },
  ])
    assert.ok(paymentError(payment, 15050))
})

test("historical payment seeds cover three methods and retain inventory and receipt sums", () => {
  const state = createPOSState(day)
  assert.equal(state.ventas.length, 24)
  assert.equal(new Set(state.ventas.map((sale) => sale.tipoPagoId)).size, 3)
  for (const sale of state.ventas) {
    assert.equal(
      sale.detallePago.monto_qr + sale.detallePago.monto_efectivo,
      sale.monto,
    )
    assert.equal(sale.origenPago, "historico")
    assert.equal(
      state.detallesVenta
        .filter((detail) => detail.ventaId === sale.id)
        .reduce((sum, detail) => sum + detail.subtotal, 0),
      sale.monto,
    )
  }
})

test("registration validates payment before stock mutation, snapshots receipt and rejects reuse", () => {
  const base = createPOSState(day)
  const before = structuredClone(base)
  const total = prepareSale(base.inventario, [row], date).total
  assert.throws(() => registerSale(base, [row], date, undefined, qr(total - 1)))
  assert.deepEqual(base, before)
  const draft = qr(total)
  const sold = registerSale(base, [row], date, undefined, draft)
  assert.equal(sold.ventas[0].tipoPagoId, 1)
  assert.equal(sold.ventas[0].notificacionPago.titular, "Ana Pérez")
  draft.notificacion.titular = "Changed"
  draft.detallePago.monto_qr = 1
  assert.equal(sold.ventas[0].notificacionPago.titular, "Ana Pérez")
  assert.equal(sold.ventas[0].detallePago.monto_qr, total)
  assert.throws(
    () => registerSale(sold, [row], date, undefined, qr(total)),
    /utilizada/,
  )
  const manual = registerSale(base, [row], date, undefined, {
    tipoPagoId: 2,
    detallePago: { monto_qr: 1, monto_efectivo: total - 1 },
    manual: true,
  })
  assert.equal(manual.ventas[0].origenPago, "manual")
})

test("prepared confirmation freezes mutations, can recover API errors and commits only once", () => {
  const base = posReducer(createPOSAppState(day), { type: "sale/open" })
  const total = prepareSale(base.inventario, [row], date).total
  const next = registerSale(base, [row], date, undefined, qr(total))
  const locked = posReducer(base, { type: "sale/beginConfirm" })
  for (const action of [
    { type: "sale/close" },
    { type: "sale/register", draft: [row], fecha: date },
    { type: "inventory/setMinimum", productoId: 1, almacenId: 1, minimum: 999 },
  ])
    assert.strictEqual(posReducer(locked, action), locked)
  const failed = posReducer(locked, {
    type: "sale/confirmError",
    error: "Sin conexión",
  })
  assert.strictEqual(failed.inventario, base.inventario)
  assert.equal(failed.saleOpen, true)
  assert.equal(failed.saleConfirming, false)
  const committed = posReducer(locked, {
    type: "sale/commitPrepared",
    base,
    next,
  })
  assert.equal(committed.ventas.length, base.ventas.length + 1)
  assert.equal(committed.saleSequence, 1)
  assert.equal(committed.saleOpen, false)
  assert.strictEqual(
    posReducer(committed, { type: "sale/commitPrepared", base, next }),
    committed,
  )
  const stale = posReducer(locked, {
    type: "sale/commitPrepared",
    base: { ...base, inventario: structuredClone(base.inventario) },
    next,
  })
  assert.equal(stale.saleOpen, true)
  assert.strictEqual(stale.inventario, base.inventario)
})
