import assert from "node:assert/strict"
import { test } from "node:test"
import { addCivilDays } from "../src/data/dates.ts"
import {
  appendCatalogName,
  appendProduct,
  createPurchaseState,
  inventoryProducts,
  setStockMinimum,
} from "../src/data/purchases.ts"
import { createPOSAppState, posReducer } from "../src/data/sales.ts"
import {
  filterInventory,
  inventoryCategories,
  parseStockMinimum,
} from "../src/features/inventory/inventory.ts"

const day = "2026-10-09"
const draft = {
  codigoBarra: "DEMO-000007",
  codigoPaquete: "PACK-000007",
  codigoPaqueteActivo: true,
  precioPaqueteActivo: true,
  categoriaId: "1",
  nombre: "Producto nuevo",
  cantidadUnitaria: "1",
  precioUnitario: "1",
  precioPaquete: "1",
}

test("demo minima and relative expirations are reproducible and retain linked purchase stock", () => {
  const state = createPurchaseState(day)
  const later = createPurchaseState(addCivilDays(day, 31))
  assert.deepEqual(state, createPurchaseState(day))
  assert.deepEqual(
    state.existencias
      .filter((item) => item.almacenId === 1)
      .map((item) => item.stock_minimo),
    [40, 48, 24, 24, 40, 48],
  )
  assert.deepEqual(state.compras, later.compras)
  assert.ok(state.lotes.some((lot) => lot.fecha_vencimiento === null))
  assert.ok(
    state.lotes.some(
      (lot) =>
        lot.fecha_vencimiento >= day &&
        lot.fecha_vencimiento < addCivilDays(day, 30),
    ),
  )
  assert.ok(
    state.lotes.some((lot) => lot.fecha_vencimiento >= addCivilDays(day, 30)),
  )
  for (let index = 0; index < state.lotes.length; index++) {
    const lot = state.lotes[index]
    assert.equal(
      later.lotes[index].fecha_vencimiento,
      lot.fecha_vencimiento ? addCivilDays(lot.fecha_vencimiento, 31) : null,
    )
  }
  for (const stock of state.existencias) {
    assert.equal(
      stock.stock,
      state.lotes
        .filter(
          (lot) =>
            lot.productoId === stock.productoId &&
            lot.almacenId === stock.almacenId,
        )
        .reduce((sum, lot) => sum + lot.stock_actual, 0),
    )
  }
  for (const invalid of ["", "invalid", "2026-02-30"])
    assert.throws(() => createPurchaseState(invalid))
})

test("package decomposition preserves physical units and handles exact, loose and absent packages", () => {
  const base = createPurchaseState(day)
  const withStock = (stock, paqueteId = base.productos[0].paqueteId) => ({
    ...base,
    productos: base.productos.map((product) =>
      product.id === 1 ? { ...product, paqueteId } : product,
    ),
    existencias: base.existencias.map((item) =>
      item.productoId === 1 ? { ...item, stock } : item,
    ),
  })
  for (const [stock, expected] of [
    [34, [2, 10]],
    [36, [3, 0]],
    [0, [0, 0]],
  ]) {
    const row = inventoryProducts(withStock(stock))[0]
    assert.deepEqual([row.packages, row.units], expected)
    assert.equal(row.packages * row.packageSize + row.units, stock)
  }
  assert.deepEqual(
    [
      inventoryProducts(withStock(34, null))[0].packages,
      inventoryProducts(withStock(34, null))[0].units,
    ],
    [0, 34],
  )
  const single = {
    ...withStock(34, 99),
    paquetes: [...base.paquetes, { id: 99, cantidad_unitaria: 1 }],
  }
  assert.deepEqual(
    [inventoryProducts(single)[0].packages, inventoryProducts(single)[0].units],
    [0, 34],
  )
  const otherWarehouse = {
    ...base,
    existencias: [
      ...base.existencias,
      { productoId: 1, almacenId: 99, stock: 900, stock_minimo: 1000 },
    ],
  }
  assert.equal(
    inventoryProducts(otherWarehouse)[0].stock,
    base.existencias[0].stock,
  )
})

test("category counts include zero-stock products and category, code/name and low-stock filters combine", () => {
  let state = appendProduct(createPurchaseState(day), draft)
  state = appendCatalogName(state, "categorias", "Vacía")
  const cards = inventoryCategories(state)
  assert.equal(cards[0].count, 2)
  assert.equal(cards.at(-1).count, 0)
  const products = inventoryProducts(state)
  assert.equal(filterInventory(products, 1, " NUEVO ", true).length, 1)
  assert.equal(filterInventory(products, 1, "DEMO-000007", true).length, 1)
  assert.equal(filterInventory(products, 3, " LACTEOS ", false).length, 0)
  state.productos[2].nombre = "Léché entera"
  assert.equal(
    filterInventory(inventoryProducts(state), 3, " leche ", false).length,
    1,
  )
  assert.equal(filterInventory(products, cards.at(-1).id, "", false).length, 0)
  assert.equal(filterInventory(products, 3, "ausente", false).length, 0)
})

test("all categories combine with search and low-stock filtering within the selected warehouse", () => {
  const state = createPurchaseState(day)
  const store = inventoryProducts(state, 1)
  assert.deepEqual(filterInventory(store, null, "", false), store)
  assert.deepEqual(
    filterInventory(store, null, " DEMO-000002 ", false),
    store.filter((product) => product.code === "DEMO-000002"),
  )
  assert.equal(filterInventory(store, 1, "DEMO-000002", false).length, 0)
  assert.equal(filterInventory(store, null, "Arroz", true).length, 0)

  const warehouse = inventoryProducts(state, 2)
  const rice = warehouse.find((product) => product.code === "DEMO-000002")
  assert.equal(rice.stock, 0)
  assert.deepEqual(filterInventory(warehouse, null, "Arroz", true), [rice])
  assert.deepEqual(filterInventory(warehouse, rice.categoryId, "Arroz", true), [rice])
  assert.equal(filterInventory(warehouse, 1, "Arroz", true).length, 0)
  assert.equal(filterInventory(warehouse, null, "ausente", true).length, 0)
  assert.deepEqual(
    filterInventory(inventoryProducts(state, 3), null, "", true),
    inventoryProducts(state, 3),
  )
})

test("minimum validation is atomic, allows zero and equality triggers the stock alert", () => {
  const state = createPurchaseState(day)
  const before = structuredClone(state)
  const stock = state.existencias[0].stock
  for (const [minimum, lowStock] of [
    [stock - 1, false],
    [stock, true],
    [stock + 1, true],
  ]) {
    const updated = setStockMinimum(state, 1, 1, minimum)
    assert.equal(inventoryProducts(updated)[0].lowStock, lowStock)
    assert.equal(updated.existencias[0].stock, stock)
    assert.strictEqual(updated.compras, state.compras)
    assert.strictEqual(updated.lotes, state.lotes)
  }
  assert.equal(setStockMinimum(state, 1, 1, 0).existencias[0].stock_minimo, 0)
  assert.strictEqual(
    setStockMinimum(state, 1, 1, state.existencias[0].stock_minimo),
    state,
  )
  for (const minimum of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => setStockMinimum(state, 1, 1, minimum))
  assert.throws(() => setStockMinimum(state, 999, 1, 10))
  assert.throws(() => setStockMinimum(state, 1, 999, 10))
  assert.deepEqual(state, before)
  for (const value of ["", "-1", "1.5", "1e3", "Infinity", "9007199254740992"])
    assert.equal(parseStockMinimum(value), null)
  assert.equal(parseStockMinimum(" 0 "), 0)
  assert.equal(parseStockMinimum("12"), 12)
})

test("minimum edits persist through sales, purchases and annulments without altering receipts", () => {
  const initial = createPOSAppState(day)
  const changed = posReducer(initial, {
    type: "inventory/setMinimum",
    productoId: 1,
    almacenId: 1,
    minimum: 75,
  })
  assert.strictEqual(changed.ventas, initial.ventas)
  assert.strictEqual(changed.detallesVenta, initial.detallesVenta)
  const sold = posReducer(posReducer(changed, { type: "sale/open" }), {
    type: "sale/register",
    draft: [{ productoId: 1, cantidad: "1", presentacion: "unidad" }],
    fecha: "2026-10-09T16:00:00.000Z",
  })
  assert.equal(sold.inventario.existencias[0].stock_minimo, 75)
  const bought = posReducer(sold, {
    type: "purchase/append",
    draft: {
      almacenId: "1",
      proveedorId: "1",
      categoriaId: "1",
      productoId: "1",
      cantidadPaquetes: "2",
      costoPaquete: "5",
      fechaVencimiento: "",
    },
  })
  const annulled = posReducer(bought, {
    type: "purchase/annul",
    id: bought.inventario.compras[0].id,
  })
  assert.equal(annulled.inventario.existencias[0].stock_minimo, 75)
  assert.equal(
    annulled.inventario.existencias[0].stock,
    sold.inventario.existencias[0].stock,
  )
  assert.deepEqual(annulled.detallesVenta, sold.detallesVenta)
  assert.equal(
    appendProduct(annulled.inventario, draft).existencias.at(-1).stock_minimo,
    10,
  )
})
