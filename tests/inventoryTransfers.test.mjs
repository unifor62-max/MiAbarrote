import assert from "node:assert/strict"
import { test } from "node:test"
import {
  applyInventoryTransfer,
  prepareInventoryTransfer,
} from "../src/data/inventoryTransfers.ts"
import { applyInventoryAdjustment } from "../src/data/inventoryAdjustments.ts"
import {
  appendProduct,
  appendPurchase,
  annulPurchase,
  availableProductLots,
  createPurchaseState,
  deletePurchase,
  inventoryProducts,
  lotReceivedAt,
} from "../src/data/purchases.ts"
import {
  createPOSAppState,
  posReducer,
  registerSale,
  saleCatalog,
} from "../src/data/sales.ts"
import { reportLots } from "../src/data/reports.ts"

const fecha = "2026-10-13T16:00:00.000Z"
const later = "2026-10-13T17:00:00.000Z"
const row = (productoId = 1, cantidad = "1", presentacion = "unidad") => ({
  productoId,
  cantidad,
  presentacion,
})
const draft = (items = [row()], origenId = 1, destinoId = 2) => ({
  items,
  origenId,
  destinoId,
})
const stock = (state, product, warehouse) =>
  state.existencias.find(
    (item) => item.productoId === product && item.almacenId === warehouse,
  )
function empty() {
  const state = createPurchaseState("2026-10-13")
  return {
    ...state,
    compras: [],
    detalles: [],
    lotes: [],
    existencias: state.existencias.map((item) => ({ ...item, stock: 0 })),
  }
}
function entry(
  state = empty(),
  items = [row(1, "30"), row(2, "12")],
  almacenId = 1,
  expiration = "2026-10-20",
) {
  return applyInventoryAdjustment(
    state,
    {
      almacenId,
      tipo: "entrada",
      items: items.map((item) => ({ ...item, fechaVencimiento: expiration })),
    },
    "2026-10-12T16:00:00.000Z",
  )
}
function reconciled(state) {
  for (const relation of state.existencias) {
    const sum = state.lotes
      .filter(
        (lot) =>
          lot.productoId === relation.productoId &&
          lot.almacenId === relation.almacenId,
      )
      .reduce((total, lot) => total + lot.stock_actual, 0)
    assert.equal(relation.stock, sum)
    assert.ok(relation.stock >= 0)
  }
  assert.equal(
    new Set(state.lotes.map((lot) => lot.id)).size,
    state.lotes.length,
  )
}

test("mixed transfer conserves totals, lot lineage, source snapshots and warehouse minima", () => {
  const base = entry()
  const before = structuredClone(base)
  const result = applyInventoryTransfer(
    base,
    draft([row(1, "2", "paquete"), row(2, "3")]),
    fecha,
  )
  assert.equal(stock(result, 1, 1).stock, 6)
  assert.equal(stock(result, 1, 2).stock, 24)
  assert.equal(stock(result, 2, 1).stock, 9)
  assert.equal(stock(result, 2, 2).stock, 3)
  for (const product of [1, 2])
    assert.equal(
      result.existencias
        .filter((item) => item.productoId === product)
        .reduce((sum, item) => sum + item.stock, 0),
      base.existencias
        .filter((item) => item.productoId === product)
        .reduce((sum, item) => sum + item.stock, 0),
    )
  assert.deepEqual(
    result.lotes.slice(0, 2).map((lot) => lot.cantidad_inicial),
    [30, 12],
  )
  assert.deepEqual(
    result.lotes.slice(2).map((lot) => lot.ajusteId),
    base.lotes.map((lot) => lot.ajusteId),
  )
  assert.ok(
    result.lotes
      .slice(2)
      .every(
        (lot) =>
          lot.fecha_vencimiento === "2026-10-20" &&
          lotReceivedAt(result, lot) === fecha,
      ),
  )
  assert.deepEqual(
    result.existencias.map((item) => item.stock_minimo),
    base.existencias.map((item) => item.stock_minimo),
  )
  assert.deepEqual(base, before)
  reconciled(result)
})

test("successive transfers and exact depletion work for adjustment lots with no package sale price", () => {
  const base = entry()
  base.productos[0].precio_paquete = null
  const moved = applyInventoryTransfer(
    base,
    draft([row(1, "2", "paquete")]),
    fecha,
  )
  const final = applyInventoryTransfer(
    moved,
    draft([row(1, "24")], 2, 3),
    later,
  )
  assert.equal(stock(final, 1, 2).stock, 0)
  assert.equal(stock(final, 1, 3).stock, 24)
  assert.equal(
    availableProductLots(final).filter((lot) => lot.almacenId === 3).length,
    1,
  )
  assert.equal(lotReceivedAt(final, final.lotes.at(-1)), later)
  const returned = applyInventoryTransfer(
    final,
    draft([row(1, "24")], 3, 1),
    "2026-10-13T18:00:00.000Z",
  )
  assert.equal(stock(returned, 1, 1).stock, 30)
  reconciled(returned)
})

test("expired then dated then undated lots move by expiration, receipt time and lot ID", () => {
  let state = entry(empty(), [row(1, "5")], 1, "2026-10-01")
  state = entry(state, [row(1, "3")], 1, "2026-10-20")
  state = entry(state, [row(1, "4")], 1, "")
  const moved = applyInventoryTransfer(state, draft([row(1, "7")]), fecha)
  assert.deepEqual(
    moved.lotes.slice(0, 3).map((lot) => lot.stock_actual),
    [0, 1, 4],
  )
  assert.deepEqual(
    moved.lotes
      .slice(3)
      .map((lot) => [lot.fecha_vencimiento, lot.stock_actual]),
    [
      ["2026-10-01", 5],
      ["2026-10-20", 2],
    ],
  )
  assert.deepEqual(
    moved.traspasos[0].detalles[0].lotes.map((change) => change.loteOrigenId),
    state.lotes.slice(0, 2).map((lot) => lot.id),
  )
  reconciled(moved)
})

test("missing destination relations are created with minimum 10", () => {
  const base = entry()
  const missing = {
    ...base,
    existencias: base.existencias.filter((item) => item.almacenId !== 3),
  }
  const moved = applyInventoryTransfer(missing, draft([row()], 1, 3), fecha)
  assert.deepEqual(stock(moved, 1, 3), {
    productoId: 1,
    almacenId: 3,
    stock: 1,
    stock_minimo: 10,
  })
  reconciled(moved)
})

test("expiration ties use reception time before ID and preserve the chosen fragments", () => {
  let state = entry(empty(), [row(1, "2")])
  state = applyInventoryAdjustment(
    state,
    {
      almacenId: 1,
      tipo: "entrada",
      items: [{ ...row(1, "3"), fechaVencimiento: "2026-10-20" }],
    },
    "2026-10-11T16:00:00.000Z",
  )
  state = applyInventoryAdjustment(
    state,
    {
      almacenId: 1,
      tipo: "entrada",
      items: [{ ...row(1, "4"), fechaVencimiento: "2026-10-20" }],
    },
    "2026-10-11T16:00:00.000Z",
  )
  const moved = applyInventoryTransfer(state, draft([row(1, "6")]), fecha)
  assert.deepEqual(
    moved.traspasos[0].detalles[0].lotes.map((lot) => [
      lot.loteOrigenId,
      lot.unidades,
    ]),
    [
      [state.lotes[1].id, 3],
      [state.lotes[2].id, 3],
    ],
  )
  reconciled(moved)
})

test("safe integer destination overflow rejects without changing either warehouse", () => {
  const state = entry(
    entry(empty(), [row()]),
    [row(1, String(Number.MAX_SAFE_INTEGER))],
    2,
  )
  const before = structuredClone(state)
  assert.throws(
    () => applyInventoryTransfer(state, draft(), fecha),
    /límite permitido/,
  )
  assert.deepEqual(state, before)
})

test("commit revalidates fresh stock after an earlier valid preview", () => {
  const base = { ...createPOSAppState("2026-10-13"), inventario: entry() }
  const value = draft([row(1, "30"), row(2, "2")])
  assert.equal(
    prepareInventoryTransfer(base.inventario, value, fecha).valid,
    true,
  )
  const changed = posReducer(base, {
    type: "inventory/adjust",
    draft: {
      almacenId: 1,
      tipo: "salida",
      items: [{ ...row(1, "1"), fechaVencimiento: "" }],
    },
    fecha,
  })
  const failed = posReducer(changed, {
    type: "inventory/transfer",
    draft: value,
    fecha,
  })
  assert.strictEqual(failed.inventario, changed.inventario)
  assert.match(failed.transferFeedback.error, /Stock insuficiente/)
})

test("all invalid drafts and inconsistent source/destination stock reject atomically", () => {
  const state = entry()
  const before = structuredClone(state)
  const invalid = [
    draft([], 1, 2),
    draft([row(), row()]),
    draft([row(999)]),
    draft([row()], null, 2),
    draft([row()], 99, 2),
    draft([row()], 1, null),
    draft([row()], 1, 1),
    draft([row()], 1, 99),
    draft([row(1, "31")]),
    draft([row(1, "1", "other")]),
    ...["", "0", "-1", "1.5", "1e2", "Infinity", "9007199254740992"].map(
      (amount) => draft([row(2), row(1, amount)]),
    ),
    draft([row(1, "9007199254740991", "paquete")]),
  ]
  for (const value of invalid) {
    assert.equal(prepareInventoryTransfer(state, value, fecha).valid, false)
    assert.throws(() => applyInventoryTransfer(state, value, fecha))
  }
  for (const warehouse of [1, 2]) {
    const corrupted = {
      ...state,
      existencias: state.existencias.map((item) =>
        item.productoId === 1 && item.almacenId === warehouse
          ? { ...item, stock: item.stock + 1 }
          : item,
      ),
    }
    assert.throws(
      () => applyInventoryTransfer(corrupted, draft(), fecha),
      /conciliados/,
    )
  }
  assert.throws(
    () =>
      applyInventoryTransfer(
        { ...state, lotes: [...state.lotes, state.lotes[0]] },
        draft(),
        fecha,
      ),
    /repetidos/,
  )
  assert.throws(
    () =>
      applyInventoryTransfer(
        { ...state, nextLotId: Number.MAX_SAFE_INTEGER },
        draft(),
        fecha,
      ),
    /identificadores/,
  )
  assert.throws(
    () =>
      applyInventoryTransfer(
        { ...state, nextTransferId: Number.MAX_SAFE_INTEGER },
        draft(),
        fecha,
      ),
    /identificadores/,
  )
  assert.throws(() => applyInventoryTransfer(state, draft(), "invalid"))
  assert.deepEqual(state, before)
})

test("unit-only products cannot transfer packages but can transfer units", () => {
  const product = appendProduct(empty(), {
    codigoBarra: "000987",
    nombre: "Suelto",
    categoriaId: "1",
    cantidadUnitaria: "",
    precioUnitario: "2",
    precioPaquete: "",
    codigoPaqueteActivo: false,
    precioPaqueteActivo: false,
  })
  const id = product.productos.at(-1).id
  const state = entry(product, [row(id, "3")])
  assert.throws(
    () =>
      applyInventoryTransfer(state, draft([row(id, "1", "paquete")]), fecha),
    /paquete/,
  )
  const moved = applyInventoryTransfer(state, draft([row(id, "3")]), fecha)
  assert.equal(stock(moved, id, 1).stock, 0)
  assert.equal(stock(moved, id, 2).stock, 3)
  reconciled(moved)
})

test("moved purchase stock remains linked through sales, annulment and deletion", () => {
  let inventory = appendPurchase(
    empty(),
    {
      almacenId: "2",
      proveedorId: "1",
      items: [
        {
          productoId: "1",
          categoriaId: "1",
          cantidadPaquetes: "2",
          costoPaquete: "2",
          fechaVencimiento: "2026-10-20",
        },
      ],
    },
    "2026-10-12T16:00:00.000Z",
  )
  const purchaseId = inventory.compras[0].id
  inventory = applyInventoryTransfer(
    inventory,
    draft([row(1, "12")], 2, 1),
    fecha,
  )
  assert.equal(
    saleCatalog(inventory, "2026-10-13T15:00:00.000Z")[0].stockVendible,
    0,
  )
  assert.equal(saleCatalog(inventory, fecha)[0].stockVendible, 12)
  assert.equal(
    reportLots(
      { inventario: inventory, ventas: [], detallesVenta: [] },
      "2026-10-13",
    )[0].stock,
    12,
  )
  const sold = registerSale(
    { inventario: inventory, ventas: [], detallesVenta: [] },
    [row(1, "2")],
    later,
  )
  assert.equal(stock(sold.inventario, 1, 1).stock, 10)
  for (const action of [annulPurchase, deletePurchase]) {
    const removed = action(sold.inventario, purchaseId)
    assert.equal(stock(removed, 1, 1).stock, 0)
    assert.equal(stock(removed, 1, 2).stock, 0)
    reconciled(removed)
  }
  assert.equal(sold.detallesVenta[0].cantidad, 2)
  assert.equal(inventoryProducts(inventory, 1)[0].expiration, "2026-10-20")
})

test("expired transfer is physical stock but is excluded from sales", () => {
  const state = entry(empty(), [row(1, "4")], 2, "2026-10-01")
  const moved = applyInventoryTransfer(state, draft([row(1, "4")], 2, 1), fecha)
  assert.equal(stock(moved, 1, 1).stock, 4)
  assert.equal(saleCatalog(moved, fecha)[0].stockVendible, 0)
  reconciled(moved)
})

test("reducer preserves inventory on failure and reports success with monotonic IDs", () => {
  const base = createPOSAppState("2026-10-13")
  const failed = posReducer(base, {
    type: "inventory/transfer",
    draft: draft([row(1, "0")]),
    fecha,
  })
  assert.strictEqual(failed.inventario, base.inventario)
  assert.equal(failed.transferFeedback.intento, 1)
  assert.equal(failed.transferFeedback.traspasoId, null)
  const moved = posReducer(failed, {
    type: "inventory/transfer",
    draft: draft(),
    fecha,
  })
  assert.deepEqual(moved.transferFeedback, {
    intento: 2,
    traspasoId: 1,
    error: "",
  })
  assert.strictEqual(moved.detallesVenta, base.detallesVenta)
  const second = posReducer(moved, {
    type: "inventory/transfer",
    draft: draft([row()], 2, 3),
    fecha: later,
  })
  assert.equal(second.transferFeedback.traspasoId, 2)
  assert.ok(
    second.inventario.lotes.at(-1).id > moved.inventario.lotes.at(-1).id,
  )
  reconciled(second.inventario)
})
