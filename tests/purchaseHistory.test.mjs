import assert from "node:assert/strict"
import { test } from "node:test"
import { appendPurchase, createPurchaseState, createPurchaseHistory, deletePurchase } from "../src/data/purchases.ts"
import { createPOSAppState, posReducer } from "../src/data/sales.ts"
import { purchaseSummaries, filterPurchaseSummaries, emptySummaryFilters, purchaseMetrics, formatPurchaseMoney, paginateRows } from "../src/features/purchases/purchaseDetails.ts"

test("one summary per purchase joins every product, lot and expiry and reconciles totals", () => {
  const state = createPurchaseHistory(createPurchaseState())
  const before = structuredClone(state)
  const rows = purchaseSummaries(state)
  assert.equal(rows.length, 27)
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length)
  assert.deepEqual(rows.slice(0, 3).map((row) => row.detalles.length), [4, 3, 2])
  for (const row of rows) {
    assert.equal(row.detalles.reduce((sum, item) => sum + item.subtotal, 0), row.total)
    for (const item of row.detalles) {
      assert.ok(item.nombre)
      assert.equal(item.lotes[0].compraId, row.id)
      assert.equal(item.lotes[0].productoId, item.productoId)
    }
  }
  assert.equal(rows[0].detalles[0].lotes[0].fecha_vencimiento, null)
  assert.deepEqual(state, before)
})
test("inclusive dates and supplier combine; metrics count transactions across all pages", () => {
  const rows = purchaseSummaries(createPurchaseHistory(createPurchaseState()))
  const filtered = filterPurchaseSummaries(rows, { ...emptySummaryFilters, inicio: "2026-10-09", final: "2026-10-11" })
  assert.equal(filtered.length, 3)
  assert.equal(purchaseMetrics(filtered).proveedores, 3)
  assert.equal(purchaseMetrics(filtered).monto, filtered.reduce((sum, row) => sum + row.total, 0))
  assert.equal(filterPurchaseSummaries(rows, { ...emptySummaryFilters, proveedorId: "5" }).length, 1)
  assert.deepEqual(filterPurchaseSummaries(rows, { inicio: "2026-10-11", final: "2026-10-09", proveedorId: "" }), [])
  assert.deepEqual(purchaseMetrics([]), { cantidad: 0, monto: 0, proveedores: 0 })
  assert.equal(formatPurchaseMoney(0), "Bs 0.00")
  assert.equal(formatPurchaseMoney(123456), "Bs 1,234.56")
  assert.equal(paginateRows(rows, 1).rows.length, 10)
  assert.equal(paginateRows(rows, 3).rows.length, 7)
  assert.equal(purchaseMetrics(rows).cantidad, 27)
})
test("physical deletion cascades through details and lots, preserving other stock and minima", () => {
  const state = createPurchaseHistory(createPurchaseState())
  const before = structuredClone(state)
  const id = state.compras[0].id
  const remaining = state.lotes.filter((lot) => lot.compraId === id)
  const removed = deletePurchase(state, id)
  assert.equal(removed.compras.length, state.compras.length - 1)
  assert.ok(!removed.detalles.some((item) => item.compraId === id))
  assert.ok(!removed.lotes.some((item) => item.compraId === id))
  for (const stock of removed.existencias) {
    const old = state.existencias.find((item) => item.productoId === stock.productoId && item.almacenId === stock.almacenId)
    const units = remaining.filter((lot) => lot.productoId === stock.productoId && lot.almacenId === stock.almacenId).reduce((sum, lot) => sum + lot.stock_actual, 0)
    assert.equal(stock.stock, old.stock - units)
    assert.equal(stock.stock_minimo, old.stock_minimo)
    assert.equal(stock.stock, removed.lotes.filter((lot) => lot.productoId === stock.productoId && lot.almacenId === stock.almacenId).reduce((sum, lot) => sum + lot.stock_actual, 0))
  }
  assert.strictEqual(deletePurchase(removed, id), removed)
  assert.deepEqual(state, before)
  const next = appendPurchase(removed, { almacenId: "1", proveedorId: "1", items: [{ productoId: "1", categoriaId: "1", cantidadPaquetes: "1", costoPaquete: "2", fechaVencimiento: "" }] })
  assert.ok(next.compras[0].id > id)
  assert.ok(next.lotes[0].id > Math.max(...state.lotes.map((lot) => lot.id)))
})
test("deleting consumed purchases preserves sales receipts and never restores sold units", () => {
  const state = createPOSAppState()
  const receipt = state.detallesVenta.find((item) => item.consumos.length)
  const usedLot = state.inventario.lotes.find((item) => item.id === receipt.consumos[0].loteId)
  const result = posReducer(state, { type: "purchase/delete", id: usedLot.compraId })
  assert.deepEqual(result.detallesVenta, state.detallesVenta)
  assert.deepEqual(result.ventas, state.ventas)
  for (const stock of result.inventario.existencias) {
    const old = state.inventario.existencias.find((item) => item.productoId === stock.productoId && item.almacenId === stock.almacenId)
    assert.ok(stock.stock <= old.stock)
  }
})
test("deleting the last page clamps pagination and missing suppliers still have a receipt", () => {
  let state = createPurchaseHistory(createPurchaseState())
  for (const row of paginateRows(purchaseSummaries(state), 3).rows) state = deletePurchase(state, row.id)
  const page = paginateRows(purchaseSummaries(state), 3)
  assert.equal(page.page, 2)
  assert.equal(page.total, 20)
  const unknown = { ...state, proveedores: [] }
  assert.equal(purchaseSummaries(unknown)[0].proveedor, "Sin proveedor")
})
