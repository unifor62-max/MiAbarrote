import assert from "node:assert/strict"
import { test } from "node:test"
import {
  appendProduct,
  appendPurchase,
  annulPurchase,
  createPurchaseState,
  inventoryProducts,
  preparePurchaseBatch,
  purchaseItemSubtotal,
} from "../src/data/purchases.ts"
import { createPOSAppState, posReducer } from "../src/data/sales.ts"
import { purchaseRows } from "../src/features/purchases/purchaseDetails.ts"

const first = {
  productoId: "1",
  categoriaId: "1",
  cantidadPaquetes: "2",
  costoPaquete: "12,50",
  fechaVencimiento: "2028-02-29",
}
const second = {
  productoId: "2",
  categoriaId: "2",
  cantidadPaquetes: "3",
  costoPaquete: "10.25",
  fechaVencimiento: "",
}
const draft = { almacenId: "2", proveedorId: "1", items: [first, second] }
const stock = (state, productId, warehouseId) =>
  state.existencias.find(
    (item) => item.productoId === productId && item.almacenId === warehouseId,
  )

test("one multi-item purchase creates independent details and lots with an exact combined total", () => {
  const state = createPurchaseState()
  const before = structuredClone(state)
  const prepared = preparePurchaseBatch(state, draft)
  assert.equal(prepared.total, 5575)
  assert.equal(prepared.detalles.length, 2)
  const result = appendPurchase(state, draft)
  assert.deepEqual(state, before)
  assert.equal(result.compras.length, 25)
  assert.equal(result.compras[0].monto, 5575)
  assert.equal(result.detalles.length, 26)
  assert.equal(result.lotes.length, 26)
  const id = result.compras[0].id
  const details = result.detalles.filter((item) => item.compraId === id)
  const lots = result.lotes.filter((item) => item.compraId === id)
  assert.equal(details.length, 2)
  assert.equal(new Set(lots.map((item) => item.id)).size, 2)
  assert.deepEqual(
    lots.map((item) => item.fecha_vencimiento),
    ["2028-02-29", null],
  )
  assert.deepEqual(
    lots.map((item) => item.cantidad_inicial),
    [24, 72],
  )
  assert.equal(stock(result, 1, 2).stock, 24)
  assert.equal(stock(result, 2, 2).stock, 72)
  assert.deepEqual(
    result.existencias.filter((item) => item.almacenId !== 2),
    state.existencias.filter((item) => item.almacenId !== 2),
  )
  assert.equal(
    purchaseRows(result)
      .filter((item) => item.compraId === id)
      .reduce((sum, item) => sum + item.total, 0),
    5575,
  )
  assert.equal(inventoryProducts(result, 2)[0].expiration, "2028-02-29")
})

test("an invalid second item rejects the complete purchase, including hidden or duplicate items", () => {
  const state = createPurchaseState()
  const before = structuredClone(state)
  for (const items of [
    [],
    [first, first],
    [first, { ...second, costoPaquete: "0" }],
    [first, { ...second, cantidadPaquetes: "1.5" }],
    [first, { ...second, productoId: "999" }],
    [first, { ...second, fechaVencimiento: "2026-02-29" }],
  ]) {
    const invalid = { ...draft, items }
    assert.equal(preparePurchaseBatch(state, invalid), null)
    assert.throws(() => appendPurchase(state, invalid))
    assert.deepEqual(state, before)
  }
})

test("combined amounts cannot exceed the safe integer limit even if each item is valid", () => {
  const state = createPurchaseState()
  const expensive = { cantidadPaquetes: "1", costoPaquete: "45035996273704.96" }
  const invalid = {
    ...draft,
    items: [
      { ...first, ...expensive },
      { ...second, ...expensive },
    ],
  }
  assert.equal(purchaseItemSubtotal(invalid.items[0]), 4503599627370496)
  assert.equal(preparePurchaseBatch(state, invalid), null)
  assert.throws(() => appendPurchase(state, invalid))
})

test("mixed unit and package purchases upsert missing stock and annul together", () => {
  const created = appendProduct(createPurchaseState(), {
    codigoBarra: "DEMO-000007",
    nombre: "Unidad",
    categoriaId: "1",
    cantidadUnitaria: "",
    precioUnitario: "2",
    precioPaquete: "",
  })
  const state = {
    ...created,
    existencias: created.existencias.filter((item) => item.almacenId !== 3),
  }
  const mixed = {
    ...draft,
    almacenId: "3",
    items: [
      first,
      {
        ...second,
        productoId: "7",
        categoriaId: "1",
        cantidadPaquetes: "5",
        costoPaquete: "2",
      },
    ],
  }
  const result = appendPurchase(state, mixed)
  assert.equal(result.compras[0].monto, 3500)
  assert.deepEqual(
    result.detalles.slice(0, 2).map((item) => item.presentacion),
    ["paquete", "unidad"],
  )
  assert.equal(stock(result, 7, 3).stock, 5)
  assert.equal(stock(result, 1, 3).stock, 24)
  const annulled = annulPurchase(result, result.compras[0].id)
  assert.equal(stock(annulled, 7, 3).stock, 0)
  assert.equal(stock(annulled, 1, 3).stock, 0)
  assert.ok(annulled.lotes.slice(0, 2).every((item) => item.stock_actual === 0))
  assert.strictEqual(annulPurchase(annulled, result.compras[0].id), annulled)
})

test("reducer reports an atomic failure and retries the same multi-item transaction", () => {
  const initial = createPOSAppState()
  const failed = posReducer(initial, {
    type: "purchase/append",
    draft: { ...draft, items: [first, { ...second, costoPaquete: "" }] },
  })
  assert.strictEqual(failed.inventario, initial.inventario)
  assert.equal(failed.purchaseFeedback.compraId, null)
  assert.ok(failed.purchaseFeedback.error)
  const saved = posReducer(failed, { type: "purchase/append", draft })
  assert.equal(saved.purchaseFeedback.intento, 2)
  assert.equal(saved.purchaseFeedback.compraId, Math.max(...initial.inventario.compras.map((item) => item.id)) + 1)
  assert.equal(
    saved.inventario.compras.length,
    initial.inventario.compras.length + 1,
  )
  assert.equal(
    saved.inventario.detalles.length,
    initial.inventario.detalles.length + 2,
  )
})
