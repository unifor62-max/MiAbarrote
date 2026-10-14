import assert from "node:assert/strict"
import { test } from "node:test"
import { applyInventoryAdjustment, prepareInventoryAdjustment } from "../src/data/inventoryAdjustments.ts"
import { appendProduct, appendPurchase, applyProductEdits, annulPurchase, availableProductLots, createPurchaseState, deletePurchase, inventoryProducts } from "../src/data/purchases.ts"
import { createPOSAppState, posReducer, registerSale, saleCatalog } from "../src/data/sales.ts"
import { reportLots } from "../src/data/reports.ts"
import { createProductEditDraft, productRows } from "../src/features/purchases/productDetails.ts"

const fecha = "2026-10-13T16:00:00.000Z"
function empty() {
  const state = createPurchaseState("2026-10-13")
  return { ...state, compras: [], detalles: [], lotes: [], existencias: state.existencias.map((stock) => ({ ...stock, stock: 0 })) }
}
const row = (productoId = 1, cantidad = "1", presentacion = "unidad", fechaVencimiento = "") => ({ productoId, cantidad, presentacion, fechaVencimiento })
const draft = (items, almacenId = 1, tipo = "entrada") => ({ items, almacenId, tipo })
function conciliated(state) {
  for (const relation of state.existencias) {
    assert.equal(relation.stock, state.lotes.filter((lot) => lot.productoId === relation.productoId && lot.almacenId === relation.almacenId).reduce((sum, lot) => sum + lot.stock_actual, 0))
    assert.ok(relation.stock >= 0)
  }
}

test("multi-item entries in every origin create independent adjustment lots and preserve minima", () => {
  for (const origin of [1, 2, 3]) {
    const base = empty()
    const before = structuredClone(base)
    const result = applyInventoryAdjustment(base, draft([row(1, "2", "paquete"), row(2, "3", "unidad", "2026-11-01")], origin), fecha)
    assert.equal(result.ajustes.length, 1)
    assert.equal(result.lotes.length, 2)
    assert.equal(result.lotes[0].stock_actual, 24)
    assert.equal(result.lotes[1].stock_actual, 3)
    assert.equal(result.lotes[0].compraId, null)
    assert.equal(result.lotes[0].ajusteId, result.ajustes[0].id)
    assert.equal(result.lotes[0].fecha_vencimiento, null)
    assert.equal(result.lotes[1].fecha_vencimiento, "2026-11-01")
    assert.ok(result.lotes.every((lot) => lot.almacenId === origin))
    assert.equal(result.ajustes[0].detalles[0].unidadesPorPaquete, 12)
    assert.equal(result.existencias.find((item) => item.productoId === 1 && item.almacenId === origin).stock_minimo, origin === 1 ? 40 : 10)
    conciliated(result)
    assert.deepEqual(base, before)
    assert.deepEqual(result.compras, [])
  }
})

test("missing relations are created with minimum 10 and package price is irrelevant to adjustments", () => {
  let base = empty()
  base = { ...base, existencias: base.existencias.filter((item) => item.almacenId !== 2), productos: base.productos.map((item) => ({ ...item, precio_paquete: null })) }
  const result = applyInventoryAdjustment(base, draft([row(1, "2", "paquete")], 2), fecha)
  const relation = result.existencias.find((item) => item.productoId === 1 && item.almacenId === 2)
  assert.deepEqual(relation, { productoId: 1, almacenId: 2, stock: 24, stock_minimo: 10 })
  conciliated(result)
})

test("outgoing consumes expired lots first, then dated lots, then undated, leaving initial snapshots unchanged", () => {
  let state = empty()
  for (const item of [row(1, "5", "unidad", "2026-10-01"), row(1, "3", "unidad", "2026-10-20"), row(1, "4")]) state = applyInventoryAdjustment(state, draft([item]), fecha)
  const before = structuredClone(state)
  const result = applyInventoryAdjustment(state, draft([row(1, "7")], 1, "salida"), fecha)
  assert.deepEqual(result.lotes.map((item) => item.stock_actual), [0, 1, 4])
  assert.deepEqual(result.ajustes.at(-1).detalles[0].lotes, [{ loteId: state.lotes[0].id, unidades: 5 }, { loteId: state.lotes[1].id, unidades: 2 }])
  assert.deepEqual(result.lotes.map((item) => item.cantidad_inicial), [5, 3, 4])
  assert.deepEqual(result.ajustes.slice(0, 3), before.ajustes)
  conciliated(result)
  const zero = applyInventoryAdjustment(result, draft([row(1, "5")], 1, "salida"), fecha)
  assert.equal(inventoryProducts(zero)[0].stock, 0)
  assert.equal(availableProductLots(zero).length, 0)
  assert.throws(() => applyInventoryAdjustment(zero, draft([row()], 1, "salida"), fecha), /Stock insuficiente/)
})

test("outgoing ties use receipt time and lot ID across purchases and adjustment entries", () => {
  let state = appendPurchase(empty(), { almacenId: "1", proveedorId: "1", items: [{ productoId: "1", categoriaId: "1", cantidadPaquetes: "1", costoPaquete: "1", fechaVencimiento: "2026-11-01" }] }, "2026-10-12T16:00:00.000Z")
  state = applyInventoryAdjustment(state, draft([row(1, "5", "unidad", "2026-11-01")]), fecha)
  state = applyInventoryAdjustment(state, draft([row(1, "5", "unidad", "2026-11-01")]), fecha)
  const prepared = prepareInventoryAdjustment(state, draft([row(1, "18")], 1, "salida"), fecha)
  assert.equal(prepared.valid, true)
  assert.deepEqual(prepared.rows[0].lotes.map((item) => item.unidades), [12, 5, 1])
  assert.deepEqual(prepared.rows[0].lotes.map((item) => item.loteId), state.lotes.map((item) => item.id))
})

test("invalid rows, duplicates, origins, movements, dates and numeric limits reject atomically", () => {
  const base = applyInventoryAdjustment(empty(), draft([row(1, "10")]), fecha)
  const before = structuredClone(base)
  const invalid = [
    draft([]), draft([row(), row()]), draft([row(999)]), draft([row()], 99), draft([row()], 1, "other"),
    ...["", "0", "-1", "1.5", "1e2", "Infinity", "9007199254740992"].map((amount) => draft([row(2, "2"), row(1, amount)])),
    draft([row(1, "2", "other")]), draft([row(1, "2", "unidad", "2026-02-30")]), draft([row(1, "11")], 1, "salida"),
    draft([row(1, "9007199254740991", "paquete")]), draft([row(1, "9007199254740991")]),
  ]
  for (const value of invalid) assert.throws(() => applyInventoryAdjustment(base, value, fecha))
  assert.throws(() => applyInventoryAdjustment(base, draft([row()]), "invalid"))
  assert.throws(() => applyInventoryAdjustment({ ...base, lotes: [...base.lotes, base.lotes[0]] }, draft([row()]), fecha), /repetidos/)
  assert.throws(() => applyInventoryAdjustment({ ...base, nextLotId: Number.MAX_SAFE_INTEGER }, draft([row()]), fecha), /identificadores/)
  assert.throws(() => applyInventoryAdjustment({ ...base, existencias: base.existencias.map((item) => item.productoId === 1 && item.almacenId === 1 ? { ...item, stock: 9 } : item) }, draft([row()]), fecha), /conciliados/)
  assert.deepEqual(base, before)
})

test("unit-only products reject package adjustments but allow units and ignore dates on outgoing", () => {
  let base = appendProduct(empty(), { codigoBarra: "000987", nombre: "Suelto", categoriaId: "1", cantidadUnitaria: "", precioUnitario: "2", precioPaquete: "", codigoPaqueteActivo: false, precioPaqueteActivo: false })
  const id = base.productos.at(-1).id
  assert.throws(() => applyInventoryAdjustment(base, draft([row(id, "1", "paquete")]), fecha), /paquete/)
  base = applyInventoryAdjustment(base, draft([row(id, "2")]), fecha)
  const removed = applyInventoryAdjustment(base, draft([row(id, "2", "unidad", "invalid")], 1, "salida"), fecha)
  assert.equal(removed.ajustes.at(-1).detalles[0].fechaVencimiento, null)
  conciliated(removed)
})

test("entry lots feed sales, product expiry editing and reports without inventing purchases", () => {
  let inventory = applyInventoryAdjustment(empty(), draft([row(1, "5", "unidad", "2026-10-01"), row(2, "4", "unidad", "2026-10-20"), row(3, "3")]), fecha)
  inventory = applyInventoryAdjustment(inventory, draft([row(2, "9")], 2), fecha)
  assert.equal(saleCatalog(inventory, fecha)[0].stockVendible, 0)
  assert.equal(saleCatalog(inventory, fecha)[1].stockVendible, 4)
  assert.equal(saleCatalog(inventory, "2026-10-12T16:00:00.000Z")[1].stockVendible, 0)
  assert.equal(productRows(inventory).length, 4)
  assert.equal(inventoryProducts(inventory)[1].expiration, "2026-10-20")
  const edits = createProductEditDraft(inventory, "expiration")
  edits.lots[inventory.lotes[1].id] = "2026-10-22"
  inventory = applyProductEdits(inventory, edits)
  assert.equal(inventoryProducts(inventory)[1].expiration, "2026-10-22")
  let state = { inventario: inventory, ventas: [], detallesVenta: [] }
  assert.deepEqual(reportLots(state, "2026-10-13").map((item) => item.producto), [inventory.productos[1].nombre])
  state = registerSale(state, [{ productoId: 2, presentacion: "unidad", cantidad: "2" }], fecha)
  assert.equal(state.detallesVenta[0].consumos[0].loteId, inventory.lotes[1].id)
  conciliated(state.inventario)
  assert.equal(state.inventario.existencias.find((item) => item.productoId === 2 && item.almacenId === 2).stock, 9)
  assert.equal(state.inventario.compras.length, 0)
})

test("purchase annulment and deletion keep unrelated adjustment stock and immutable sales history", () => {
  let state = createPOSAppState("2026-10-13")
  state = posReducer(state, { type: "inventory/adjust", draft: draft([row(1, "15")]), fecha })
  const adjustmentLot = state.inventario.lotes.find((lot) => lot.compraId === null)
  const purchaseId = state.inventario.compras[0].id
  const annulled = annulPurchase(state.inventario, purchaseId)
  const deleted = deletePurchase(annulled, purchaseId)
  assert.equal(deleted.lotes.find((lot) => lot.id === adjustmentLot.id).stock_actual, 15)
  conciliated(deleted)
  assert.equal(availableProductLots(deleted).some((lot) => lot.id === adjustmentLot.id), true)
  assert.deepEqual(state.detallesVenta, createPOSAppState("2026-10-13").detallesVenta)
})

test("reducer preserves inventory on failure and returns attempt, success ID and monotonic lot IDs", () => {
  const base = createPOSAppState("2026-10-13")
  const failed = posReducer(base, { type: "inventory/adjust", draft: draft([row(1, "0")]), fecha })
  assert.strictEqual(failed.inventario, base.inventario)
  assert.equal(failed.adjustmentFeedback.intento, 1)
  assert.equal(failed.adjustmentFeedback.ajusteId, null)
  assert.ok(failed.adjustmentFeedback.error)
  const success = posReducer(failed, { type: "inventory/adjust", draft: draft([row(1, "2")], 3), fecha })
  assert.deepEqual(success.adjustmentFeedback, { intento: 2, ajusteId: 1, error: "" })
  const another = posReducer(success, { type: "inventory/adjust", draft: draft([row(2, "2")], 3), fecha })
  assert.equal(another.adjustmentFeedback.ajusteId, 2)
  assert.ok(another.inventario.lotes.at(-1).id > success.inventario.lotes.at(-1).id)
  conciliated(another.inventario)
})
