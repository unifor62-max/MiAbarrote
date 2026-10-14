import assert from "node:assert/strict"
import { test } from "node:test"
import { addCivilDays, bolivianDay } from "../src/data/dates.ts"
import { annulPurchase, setStockMinimum } from "../src/data/purchases.ts"
import {
  buildReports,
  reportFilterError,
  reportLots,
} from "../src/data/reports.ts"
import { createPOSState, registerSale } from "../src/data/sales.ts"

const today = "2026-10-09"
const all = { inicio: "", final: "" }

test("historical KPIs use exact cents, negative margins and registered purchases only", () => {
  const state = createPOSState(today)
  const before = structuredClone(state)
  const report = buildReports(state, all, today)
  assert.equal(report.ingresos, 302700)
  assert.equal(report.egresos, 1262800)
  assert.equal(report.margen, -960100)
  assert.equal(report.stockAlerts, 2)
  assert.equal(report.criticalAlerts, report.stockAlerts + report.expiryAlerts)
  const canceled = state.inventario.compras[0]
  const changed = buildReports(
    { ...state, inventario: annulPurchase(state.inventario, canceled.id) },
    all,
    today,
  )
  assert.equal(changed.egresos, report.egresos - canceled.monto)
  assert.equal(changed.ingresos, report.ingresos)
  assert.deepEqual(state, before)
})

test("date boundaries include full Bolivian days for financials and sales details", () => {
  const base = createPOSState(today)
  const sampleSale = base.ventas[0]
  const sampleDetail = base.detallesVenta[0]
  const state = {
    ...base,
    ventas: [
      { ...sampleSale, id: 1, fecha: "2026-10-10T03:59:59.000Z", monto: 101 },
      { ...sampleSale, id: 2, fecha: "2026-10-10T04:00:00.000Z", monto: 202 },
      { ...sampleSale, id: 3, fecha: "2026-10-09T04:00:00.000Z", monto: 303 },
    ],
    detallesVenta: [1, 2, 3].map((id) => ({
      ...sampleDetail,
      ventaId: id,
      productoId: id,
      cantidad: 1,
      presentacion: "unidad",
      subtotal: 101 * id,
    })),
    inventario: {
      ...base.inventario,
      compras: [
        {
          ...base.inventario.compras[0],
          id: 1,
          fecha: "2026-10-10T03:59:59.000Z",
          monto: 451,
        },
        {
          ...base.inventario.compras[0],
          id: 2,
          fecha: "2026-10-10T04:00:00.000Z",
          monto: 600,
        },
        {
          ...base.inventario.compras[0],
          id: 3,
          fecha: "2026-10-09T04:00:00.000Z",
          monto: 900,
          estado: "anulada",
        },
      ],
    },
  }
  assert.equal(bolivianDay(state.ventas[0].fecha), today)
  const report = buildReports(state, { inicio: today, final: today }, today)
  assert.equal(report.ingresos, 404)
  assert.equal(report.egresos, 451)
  assert.deepEqual(
    report.topProducts.map((product) => product.id),
    [3, 1],
  )
  assert.equal(
    buildReports(state, { inicio: "2026-10-10", final: "" }, today).ingresos,
    202,
  )
  assert.equal(
    buildReports(state, { inicio: "", final: today }, today).ingresos,
    404,
  )
})

test("invalid ranges suspend monetary results and ranking while valid empty periods show zeros", () => {
  const state = createPOSState(today)
  const baseline = buildReports(state, all, today)
  for (const filters of [
    { inicio: "2026-10-10", final: today },
    { inicio: "2026-02-30", final: "" },
    { inicio: "", final: "invalid" },
  ]) {
    assert.ok(reportFilterError(filters))
    const report = buildReports(state, filters, today)
    assert.equal(report.ingresos, null)
    assert.equal(report.egresos, null)
    assert.equal(report.margen, null)
    assert.deepEqual(report.topProducts, [])
    assert.equal(report.criticalAlerts, baseline.criticalAlerts)
    assert.deepEqual(report.lots, baseline.lots)
  }
  const empty = buildReports(
    state,
    { inicio: "2030-01-01", final: "2030-01-31" },
    today,
  )
  assert.deepEqual([empty.ingresos, empty.egresos, empty.margen], [0, 0, 0])
  assert.deepEqual(empty.topProducts, [])
  assert.equal(empty.criticalAlerts, baseline.criticalAlerts)
})

test("lot urgency excludes expired, undated, exhausted, annulled and foreign warehouse stock", () => {
  const base = createPOSState(today)
  const specs = [
    { offset: -1 },
    { offset: 0 },
    { offset: 7 },
    { offset: 8 },
    { offset: 29 },
    { offset: 30 },
    { offset: null },
    { offset: 3, stock: 0 },
    { offset: 3, compraId: 999 },
    { offset: 3, almacenId: 999 },
    { offset: 3, productoId: 999 },
  ]
  const lotes = specs.map((spec, index) => ({
    ...base.inventario.lotes[0],
    id: index + 1,
    productoId: 1,
    almacenId: spec.almacenId ?? 1,
    compraId: spec.compraId ?? 1,
    stock_actual: spec.stock ?? 2,
    cantidad_inicial: 2,
    fecha_vencimiento:
      spec.offset === null ? null : addCivilDays(today, spec.offset),
    ...("productoId" in spec ? { productoId: spec.productoId } : {}),
  }))
  const state = {
    ...base,
    inventario: {
      ...base.inventario,
      productos: [base.inventario.productos[0]],
      compras: [
        { ...base.inventario.compras[0], id: 1, estado: "registrada" },
        { ...base.inventario.compras[0], id: 999, estado: "anulada" },
      ],
      existencias: [
        { ...base.inventario.existencias[0], stock_minimo: 0, stock: 20 },
      ],
      lotes: [...lotes].reverse(),
    },
  }
  const lots = reportLots(state, today)
  assert.deepEqual(
    lots.map((lot) => lot.days),
    [0, 7, 8, 29, 30],
  )
  assert.deepEqual(
    lots.map((lot) => lot.urgency),
    ["critical", "critical", "soon", "soon", "healthy"],
  )
  assert.equal(buildReports(state, all, today).expiryAlerts, 4)
  assert.equal(buildReports(state, all, today).stockAlerts, 0)
})

test("ranking uses saved package sizes and changes neither revenue nor units after master edits", () => {
  const state = createPOSState(today)
  const report = buildReports(state, all, today)
  assert.equal(report.topProducts.length, 5)
  const mostSold = report.topProducts[0]
  const expected = state.detallesVenta
    .filter((detail) => detail.productoId === mostSold.id)
    .reduce(
      (sum, detail) =>
        sum +
        detail.cantidad *
          (detail.presentacion === "paquete" ? detail.unidadesPorPaquete : 1),
      0,
    )
  assert.equal(mostSold.unidades, expected)
  const changed = {
    ...state,
    inventario: {
      ...state.inventario,
      paquetes: state.inventario.paquetes.map((pack) => ({
        ...pack,
        cantidad_unitaria: 99,
      })),
      productos: state.inventario.productos.map((product) => ({
        ...product,
        precio_unitario: 1,
        precio_paquete: 2,
      })),
    },
  }
  assert.deepEqual(
    buildReports(changed, all, today).topProducts,
    report.topProducts,
  )
})

test("ranking resolves ties by revenue then ID and excludes orphan sale details", () => {
  const base = createPOSState(today)
  const sample = base.detallesVenta[0]
  const state = {
    ...base,
    ventas: [{ ...base.ventas[0], id: 1 }],
    detallesVenta: [
      ...[3, 2, 1].map((id) => ({
        ...sample,
        ventaId: 1,
        productoId: id,
        presentacion: "unidad",
        cantidad: 2,
        subtotal: id === 3 ? 400 : 500,
      })),
      { ...sample, ventaId: 999, productoId: 4, cantidad: 5000 },
    ],
  }
  assert.deepEqual(
    buildReports(state, all, today).topProducts.map((product) => product.id),
    [1, 2, 3],
  )
})

test("sales, purchases, annulments and minimum edits immediately change live projections", () => {
  const initial = createPOSState(today)
  const before = buildReports(initial, all, today)
  const sold = registerSale(
    initial,
    [{ productoId: 1, cantidad: "1", presentacion: "unidad" }],
    "2026-10-09T16:00:00.000Z",
  )
  assert.equal(
    buildReports(sold, all, today).ingresos,
    before.ingresos + initial.inventario.productos[0].precio_unitario,
  )
  const edited = {
    ...sold,
    inventario: setStockMinimum(sold.inventario, 2, 1, 1000),
  }
  assert.equal(
    buildReports(edited, all, today).stockAlerts,
    before.stockAlerts + 1,
  )
  const purchase = edited.inventario.compras[0]
  const annulled = {
    ...edited,
    inventario: annulPurchase(edited.inventario, purchase.id),
  }
  assert.equal(
    buildReports(annulled, all, today).egresos,
    before.egresos - purchase.monto,
  )
  assert.ok(
    buildReports(annulled, all, today).lots.every(
      (lot) =>
        !edited.inventario.lotes.some(
          (original) =>
            original.id === lot.id && original.compraId === purchase.id,
        ),
    ),
  )
})
