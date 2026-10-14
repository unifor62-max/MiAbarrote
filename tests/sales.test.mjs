import assert from "node:assert/strict"
import { test } from "node:test"
import {
  annulPurchase,
  createPurchaseState,
  cuenta,
  inventoryProducts,
} from "../src/data/purchases.ts"
import {
  createPOSState,
  createPOSAppState,
  formatSaleDate,
  posReducer,
  prepareSale,
  registerSale,
  saleableLots,
  saleCatalog,
  saleDay,
} from "../src/data/sales.ts"
import { paginateRows } from "../src/features/purchases/purchaseDetails.ts"

const now = "2026-10-09T16:00:00.000Z"
const row = (productoId = 1, cantidad = "1", presentacion = "unidad") => ({
  productoId,
  cantidad,
  presentacion,
})
const emptyState = () => ({
  inventario: createPurchaseState(),
  ventas: [],
  detallesVenta: [],
})

function withLots(specs) {
  const inventory = createPurchaseState()
  const compras = [1, 2].map((id) => ({
    ...inventory.compras[0],
    id,
    fecha: `2026-10-0${id}T16:00:00.000Z`,
  }))
  const lotes = specs.map((spec, index) => ({
    ...inventory.lotes[0],
    id: index + 1,
    productoId: 1,
    almacenId: 1,
    compraId: 1,
    stock_actual: spec.stock,
    cantidad_inicial: spec.stock,
    fecha_vencimiento: spec.expiration,
    ...spec,
  }))
  return {
    ...inventory,
    compras,
    lotes,
    existencias: inventory.existencias.map((item) => ({
      ...item,
      stock:
        item.productoId === 1
          ? lotes.reduce((sum, lot) => sum + lot.stock_actual, 0)
          : 0,
    })),
  }
}

test("24 seed sales consume inventory once, have valid snapshots and preserve initial purchase fixtures", () => {
  const purchase = createPurchaseState()
  const state = createPOSState()
  assert.deepEqual(state, createPOSState())
  assert.equal(state.ventas.length, 24)
  assert.equal(new Set(state.ventas.map((sale) => sale.id)).size, 24)
  assert.deepEqual(state.inventario.productos, purchase.productos)
  assert.deepEqual(state.inventario.compras, purchase.compras)
  const lastPurchase = Math.max(
    ...purchase.compras.map((item) => Date.parse(item.fecha)),
  )
  for (const sale of state.ventas) {
    const details = state.detallesVenta.filter(
      (item) => item.ventaId === sale.id,
    )
    assert.ok(Date.parse(sale.fecha) > lastPurchase)
    assert.ok(details.length >= 1 && details.length <= 3)
    assert.equal(
      sale.monto,
      details.reduce((sum, item) => sum + item.subtotal, 0),
    )
    assert.equal(sale.cajeroNombre, cuenta.nombre)
    assert.equal(sale.cuentaId, cuenta.id)
    for (const detail of details) {
      assert.equal(detail.subtotal, detail.cantidad * detail.precio)
      assert.equal(
        detail.consumos.reduce((sum, item) => sum + item.unidades, 0),
        detail.cantidad *
          (detail.presentacion === "paquete" ? detail.unidadesPorPaquete : 1),
      )
    }
  }
  assert.ok(state.detallesVenta.some((item) => item.presentacion === "paquete"))
  for (const stock of state.inventario.existencias) {
    const consumed = state.detallesVenta
      .filter(
        (item) =>
          item.productoId === stock.productoId &&
          item.almacenId === stock.almacenId,
      )
      .flatMap((item) => item.consumos)
      .reduce((sum, item) => sum + item.unidades, 0)
    assert.equal(
      stock.stock,
      purchase.existencias.find(
        (item) =>
          item.productoId === stock.productoId &&
          item.almacenId === stock.almacenId,
      ).stock - consumed,
    )
    assert.ok(stock.almacenId === 1 ? stock.stock > 0 : stock.stock === 0)
    assert.equal(
      stock.stock,
      state.inventario.lotes
        .filter(
          (item) =>
            item.productoId === stock.productoId &&
            item.almacenId === stock.almacenId,
        )
        .reduce((sum, item) => sum + item.stock_actual, 0),
    )
  }
  assert.equal(paginateRows(state.ventas, 1).rows.length, 10)
  assert.equal(paginateRows(state.ventas, 2).rows.length, 10)
  assert.equal(paginateRows(state.ventas, 3).rows.length, 4)
})

test("unit and package prices use exact cents, two products remain two distinct items", () => {
  const state = emptyState()
  state.inventario.productos[0].precio_unitario = 123
  const prepared = prepareSale(
    state.inventario,
    [row(1, "3"), row(2, "2", "paquete")],
    now,
  )
  assert.equal(prepared.valid, true)
  assert.equal(prepared.total, 369 + 67200 * 2)
  const result = registerSale(state, [row(1, "3"), row(2, "2", "paquete")], now)
  assert.equal(result.ventas[0].monto, prepared.total)
  assert.equal(
    new Set(result.detallesVenta.map((item) => item.productoId)).size,
    2,
  )
  assert.equal(
    result.inventario.existencias[0].stock,
    state.inventario.existencias[0].stock - 3,
  )
  assert.equal(
    result.inventario.existencias[1].stock,
    state.inventario.existencias[1].stock - 48,
  )
  assert.equal(
    inventoryProducts(result.inventario)[0].stock,
    result.inventario.existencias[0].stock,
  )
})

test("FEFO spans lots, includes today's expiry, excludes expired stock and leaves undated stock last", () => {
  const inventario = withLots([
    { stock: 5, expiration: "2026-10-08" },
    { stock: 8, expiration: null },
    { stock: 3, expiration: "2026-10-10" },
    { stock: 2, expiration: "2026-10-09" },
  ])
  assert.equal(saleCatalog(inventario, now)[0].stockVendible, 13)
  const before = structuredClone(inventario)
  const result = registerSale(
    { inventario, ventas: [], detallesVenta: [] },
    [row(1, "7")],
    now,
  )
  assert.deepEqual(result.detallesVenta[0].consumos, [
    { loteId: 4, unidades: 2 },
    { loteId: 3, unidades: 3 },
    { loteId: 2, unidades: 2 },
  ])
  assert.deepEqual(
    result.inventario.lotes.map((item) => item.stock_actual),
    [5, 6, 0, 0],
  )
  assert.equal(result.inventario.existencias[0].stock, 11)
  assert.equal(saleCatalog(result.inventario, now)[0].stockVendible, 6)
  assert.deepEqual(inventario, before)
  assert.equal(inventoryProducts(result.inventario)[0].expiration, "2026-10-08")
})

test("FEFO ties use oldest purchase then ID, null sorts after even the maximum civil date", () => {
  const inventory = withLots([
    { stock: 2, expiration: "2026-10-10", compraId: 2 },
    { stock: 2, expiration: "2026-10-10", compraId: 1, id: 8 },
    { stock: 2, expiration: "2026-10-10", compraId: 1, id: 7 },
    { stock: 2, expiration: null },
    { stock: 2, expiration: "9999-12-31" },
  ])
  assert.deepEqual(
    saleableLots(inventory, now).map((item) => item.id),
    [7, 8, 1, 5, 4],
  )
})

test("expiry changes at Bolivian midnight, and date display uses the same timezone", () => {
  const inventory = withLots([{ stock: 2, expiration: "2026-10-09" }])
  assert.equal(saleDay("2026-10-10T03:59:59.000Z"), "2026-10-09")
  assert.equal(
    saleCatalog(inventory, "2026-10-10T03:59:59.000Z")[0].stockVendible,
    2,
  )
  assert.equal(
    saleCatalog(inventory, "2026-10-10T04:00:00.000Z")[0].stockVendible,
    0,
  )
  assert.match(formatSaleDate("2026-10-10T03:59:59.000Z"), /09\/10\/2026/)
  assert.match(formatSaleDate("2026-10-10T03:59:59.000Z"), /23:59/)
})

test("invalid rows, duplicate products and partial shortages reject the entire transaction", () => {
  const state = emptyState()
  const before = structuredClone(state)
  const invalidDrafts = [
    [],
    [row(999)],
    [row(1), row(1)],
    [row(1, "1", "invalid")],
    ...["", "0", "-1", "1.5", "1e3", "9007199254740992", "999"].map(
      (quantity) => [row(1, quantity)],
    ),
    [row(1), row(2, "999", "paquete")],
  ]
  for (const draft of invalidDrafts) {
    assert.equal(prepareSale(state.inventario, draft, now).valid, false)
    assert.throws(() => registerSale(state, draft, now))
  }
  assert.throws(() => registerSale(state, [row(1)], "invalid-date"))
  assert.deepEqual(state, before)
  const noPackage = {
    ...state.inventario,
    productos: state.inventario.productos.map((product) =>
      product.id === 1 ? { ...product, paqueteId: null } : product,
    ),
  }
  assert.equal(
    prepareSale(noPackage, [row(1, "1", "paquete")], now).valid,
    false,
  )
  assert.equal(prepareSale(noPackage, [row(1)], now).valid, true)
})

test("unavailable, annulled, future and invalid warehouse lots cannot supply a sale", () => {
  const inventory = withLots([
    { stock: 2, expiration: null },
    { stock: 0, expiration: null },
  ])
  const annulled = annulPurchase(inventory, 1)
  assert.equal(saleCatalog(annulled, now)[0].stockVendible, 0)
  assert.equal(
    saleCatalog({ ...inventory, existencias: [] }, now)[0].stockVendible,
    0,
  )
  assert.equal(
    saleCatalog(
      {
        ...inventory,
        lotes: inventory.lotes.map((lot) => ({ ...lot, almacenId: 999 })),
      },
      now,
    )[0].stockVendible,
    0,
  )
  assert.equal(
    saleCatalog(inventory, "2026-09-30T16:00:00.000Z")[0].stockVendible,
    0,
  )
})

test("receipt snapshots survive master edits and annulling a purchase never restores sold units", () => {
  const state = emptyState()
  const sold = registerSale(state, [row(1, "3")], now)
  const detail = structuredClone(sold.detallesVenta[0])
  const changed = posReducer(
    {
      ...sold,
      saleOpen: false,
      saleError: "",
      saleNotice: "",
      saleSequence: 1,
    },
    {
      type: "supplier/edit",
      id: 1,
      draft: { nombre: "Proveedor actualizado", telefono: "70123456" },
    },
  )
  assert.deepEqual(changed.detallesVenta[0], detail)
  const changedCatalog = {
    ...sold,
    inventario: {
      ...sold.inventario,
      productos: sold.inventario.productos.map((product) => ({
        ...product,
        nombre: "Otro nombre",
        precio_unitario: 1,
        precio_paquete: 2,
      })),
      paquetes: sold.inventario.paquetes.map((pack) => ({
        ...pack,
        cantidad_unitaria: 99,
      })),
    },
  }
  assert.deepEqual(changedCatalog.detallesVenta[0], detail)
  const usedLot = sold.inventario.lotes.find(
    (lot) => lot.id === detail.consumos[0].loteId,
  )
  const remainingInPurchase = sold.inventario.lotes
    .filter((lot) => lot.compraId === usedLot.compraId)
    .reduce((sum, lot) => sum + lot.stock_actual, 0)
  const annulled = annulPurchase(sold.inventario, usedLot.compraId)
  assert.equal(
    annulled.existencias[0].stock,
    sold.inventario.existencias[0].stock - remainingInPurchase,
  )
  assert.ok(
    annulled.existencias[0].stock <= sold.inventario.existencias[0].stock,
  )
  assert.deepEqual(annulled, annulPurchase(annulled, usedLot.compraId))
})

test("unsafe prices and totals never enter the ledger", () => {
  const state = emptyState()
  for (const price of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const inventory = {
      ...state.inventario,
      productos: state.inventario.productos.map((product) =>
        product.id === 1 ? { ...product, precio_unitario: price } : product,
      ),
    }
    assert.equal(prepareSale(inventory, [row(1)], now).valid, false)
  }
  const inventory = {
    ...state.inventario,
    productos: state.inventario.productos.map((product) => ({
      ...product,
      precio_unitario: Number.MAX_SAFE_INTEGER,
    })),
  }
  assert.equal(prepareSale(inventory, [row(1), row(2)], now).valid, false)
  assert.equal(prepareSale(inventory, [row(1, "2")], now).valid, false)
})

test("reducer revalidates at commit, keeps failures open and ignores duplicate or canceled submits", () => {
  const initial = createPOSAppState()
  assert.strictEqual(
    posReducer(initial, { type: "sale/register", draft: [row(1)], fecha: now }),
    initial,
  )
  const opened = posReducer(initial, { type: "sale/open" })
  const invalid = posReducer(opened, {
    type: "sale/register",
    draft: [row(1, "999")],
    fecha: now,
  })
  assert.equal(invalid.saleOpen, true)
  assert.ok(invalid.saleError)
  assert.strictEqual(invalid.inventario, opened.inventario)
  assert.strictEqual(invalid.ventas, opened.ventas)
  const sold = posReducer(invalid, {
    type: "sale/register",
    draft: [row(1)],
    fecha: now,
  })
  assert.equal(sold.saleOpen, false)
  assert.equal(sold.saleError, "")
  assert.equal(sold.ventas.length, 25)
  assert.equal(sold.saleSequence, 1)
  assert.match(sold.saleNotice, /V-25/)
  assert.strictEqual(
    posReducer(sold, { type: "sale/register", draft: [row(1)], fecha: now }),
    sold,
  )
  const cleared = posReducer(sold, { type: "sale/clearNotice" })
  assert.equal(cleared.saleNotice, "")
  assert.strictEqual(cleared.inventario, sold.inventario)
  const closed = posReducer(opened, { type: "sale/close" })
  assert.strictEqual(closed.ventas, initial.ventas)
  assert.strictEqual(closed.inventario, initial.inventario)
})
