import assert from "node:assert/strict"
import { test } from "node:test"
import {
  almacenes,
  appendProduct,
  appendPurchase,
  annulPurchase,
  createPurchaseState,
  inventoryProducts,
  prepareProduct,
  preparePurchase,
  resolveProductCode,
  setStockMinimum,
  applyProductEdits,
} from "../src/data/purchases.ts"
import {
  createPOSAppState,
  posReducer,
  saleCatalog,
} from "../src/data/sales.ts"
import {
  createProductEditDraft,
  productRows,
} from "../src/features/purchases/productDetails.ts"
import { purchaseRows } from "../src/features/purchases/purchaseDetails.ts"
import { createBarcodeScanner } from "../src/features/purchases/barcodeScanner.ts"

const draft = {
  almacenId: "2",
  proveedorId: "1",
  categoriaId: "1",
  productoId: "1",
  cantidadPaquetes: "3",
  costoPaquete: "12,50",
  fechaVencimiento: "2028-02-29",
}
const productDraft = {
  nombre: "Producto con código",
  categoriaId: "1",
  cantidadUnitaria: "12",
  precioUnitario: "1,25",
  precioPaquete: "15",
  codigoBarra: "001234567890",
  codigoPaquete: "009876543210",
  codigoPaqueteActivo: true,
  precioPaqueteActivo: true,
}
const stock = (state, product, warehouse) =>
  state.existencias.find(
    (item) => item.productoId === product && item.almacenId === warehouse,
  )

test("independent package codes resolve their parent; direct codes have precedence", () => {
  const base = createPurchaseState()
  assert.equal(
    new Set(base.productos.map((item) => item.paqueteId)).size,
    base.productos.length,
  )
  for (const product of base.productos) {
    const pack = base.paquetes.find((item) => item.id === product.paqueteId)
    assert.equal(resolveProductCode(base, product.codigo_barra), product)
    assert.equal(resolveProductCode(base, pack.codigo_barra), product)
  }
  const state = appendProduct(base, productDraft)
  assert.equal(resolveProductCode(state, " 001234567890 ").id, 7)
  assert.equal(resolveProductCode(state, "009876543210").id, 7)
  for (const code of ["", "1234567890", "demo-000001", "unknown"])
    assert.equal(resolveProductCode(state, code), undefined)
  const collision = {
    ...base,
    paquetes: base.paquetes.map((item, i) =>
      i === 1
        ? { ...item, codigo_barra: base.productos[0].codigo_barra }
        : item,
    ),
  }
  assert.equal(
    resolveProductCode(collision, base.productos[0].codigo_barra).id,
    1,
  )
  assert.equal(
    resolveProductCode(
      { ...base, productos: [] },
      base.paquetes[0].codigo_barra,
    ),
    undefined,
  )
})

test("new codes require explicit values and reject duplicates across both namespaces", () => {
  const state = createPurchaseState()
  const before = structuredClone(state)
  for (const override of [
    { codigoBarra: "DEMO-000001" },
    { codigoBarra: "PACK-000001" },
    { codigoPaquete: "DEMO-000001" },
    { codigoPaquete: "PACK-000001" },
    { codigoPaquete: productDraft.codigoBarra },
    { codigoBarra: "X".repeat(129) },
  ]) {
    assert.equal(prepareProduct(state, { ...productDraft, ...override }), null)
    assert.throws(() => appendProduct(state, { ...productDraft, ...override }))
  }
  assert.deepEqual(state, before)
  const occupied = appendProduct(state, {
    ...productDraft,
    codigoBarra: "DEMO-000008",
    codigoPaquete: "PACK-000008",
  })
  const result = appendProduct(occupied, {
    ...productDraft,
    codigoBarra: "DEMO-000008-D",
    codigoPaquete: "PACK-000008-D",
  })
  const codes = [...result.productos, ...result.paquetes].map(
    (item) => item.codigo_barra,
  )
  assert.equal(new Set(codes).size, codes.length)
})

test("each destination receives only its own stock, lot, expiration and minimum", () => {
  assert.deepEqual(almacenes, [
    { id: 1, nombre: "Depósito Tienda" },
    { id: 2, nombre: "Almacén 1" },
    { id: 3, nombre: "Almacén 2" },
  ])
  const original = createPurchaseState("2029-01-01")
  const before = structuredClone(original)
  for (const warehouse of almacenes) {
    const result = appendPurchase(original, {
      ...draft,
      almacenId: String(warehouse.id),
    })
    assert.equal(
      stock(result, 1, warehouse.id).stock,
      stock(original, 1, warehouse.id).stock + 36,
    )
    for (const other of almacenes.filter((item) => item.id !== warehouse.id))
      assert.deepEqual(stock(result, 1, other.id), stock(original, 1, other.id))
    assert.equal(result.lotes[0].almacenId, warehouse.id)
    assert.equal(result.lotes[0].cantidad_inicial, 36)
    assert.equal(result.compras[0].monto, 3750)
    assert.equal(
      inventoryProducts(result, warehouse.id)[0].expiration,
      "2028-02-29",
    )
    assert.equal(purchaseRows(result)[0].destino, warehouse.nombre)
    const minimum = setStockMinimum(result, 1, warehouse.id, 77)
    assert.equal(inventoryProducts(minimum, warehouse.id)[0].minimum, 77)
    const annulled = annulPurchase(minimum, result.compras[0].id)
    assert.equal(
      stock(annulled, 1, warehouse.id).stock,
      stock(original, 1, warehouse.id).stock,
    )
    assert.equal(stock(annulled, 1, warehouse.id).stock_minimo, 77)
    for (const record of annulled.existencias)
      assert.equal(
        record.stock,
        annulled.lotes
          .filter(
            (lot) =>
              lot.productoId === record.productoId &&
              lot.almacenId === record.almacenId,
          )
          .reduce((sum, lot) => sum + lot.stock_actual, 0),
      )
  }
  assert.deepEqual(original, before)
})

test("saving creates missing product-warehouse relations, while invalid destinations fail atomically", () => {
  const original = createPurchaseState()
  const state = {
    ...original,
    existencias: original.existencias.filter(
      (item) => !(item.productoId === 1 && item.almacenId === 2),
    ),
  }
  const result = appendPurchase(state, draft)
  assert.deepEqual(stock(result, 1, 2), {
    productoId: 1,
    almacenId: 2,
    stock: 36,
    stock_minimo: 10,
  })
  for (const almacenId of ["", "99", "1.5", "NaN"]) {
    assert.equal(preparePurchase(state, { ...draft, almacenId }), null)
    assert.throws(() => appendPurchase(state, { ...draft, almacenId }))
  }
  assert.equal(stock(state, 1, 2), undefined)
})

test("unit-only products can be purchased, edited and sold without an artificial package", () => {
  const original = createPurchaseState()
  const created = appendProduct(original, {
    ...productDraft,
    codigoPaqueteActivo: false,
    precioPaqueteActivo: false,
    cantidadUnitaria: "",
    precioPaquete: "",
    codigoPaquete: "",
  })
  assert.equal(created.productos.at(-1).paqueteId, null)
  assert.equal(created.productos.at(-1).precio_paquete, null)
  assert.equal(created.paquetes.length, original.paquetes.length)
  const result = appendPurchase(created, {
    ...draft,
    almacenId: "1",
    productoId: "7",
  })
  assert.equal(stock(result, 7, 1).stock, 3)
  assert.equal(result.detalles[0].presentacion, "unidad")
  assert.equal(result.detalles[0].unidadesPorPaquete, 1)
  assert.equal(result.lotes[0].cantidad_inicial, 3)
  assert.equal(
    productRows(result).find((item) => item.productoId === 7).tienePaquete,
    false,
  )
  const prices = createProductEditDraft(result, "prices")
  prices.products[7].precioUnitario = "2,50"
  prices.products[7].precioPaquete = "invalid and ignored"
  const edited = applyProductEdits(result, prices)
  assert.equal(edited.productos.at(-1).precio_unitario, 250)
  assert.equal(edited.productos.at(-1).precio_paquete, null)
  assert.equal(
    saleCatalog(edited, "2027-01-01T12:00:00Z").find((item) => item.id === 7)
      .stockVendible,
    3,
  )
  assert.equal(purchaseRows(edited)[0].presentacion, "unidad")
})

test("reducer returns commit results and rejected attempts preserve inventory for a retry", () => {
  const base = createPOSAppState()
  const rejected = posReducer(base, {
    type: "purchase/append",
    draft: { ...draft, proveedorId: "" },
  })
  assert.equal(rejected.purchaseFeedback.intento, 1)
  assert.equal(rejected.purchaseFeedback.compraId, null)
  assert.ok(rejected.purchaseFeedback.error)
  assert.strictEqual(rejected.inventario, base.inventario)
  const saved = posReducer(rejected, { type: "purchase/append", draft })
  assert.equal(saved.purchaseFeedback.intento, 2)
  assert.equal(saved.purchaseFeedback.compraId, Math.max(...base.inventario.compras.map((item) => item.id)) + 1)
  assert.equal(saved.purchaseFeedback.error, "")
  assert.equal(
    saved.inventario.compras.length,
    base.inventario.compras.length + 1,
  )
  assert.deepEqual(saleCatalog(saved.inventario), saleCatalog(base.inventario))
})

function burst(
  reader,
  code,
  start = 100,
  gap = 10,
  enterGap = 10,
  snapshot = () => ({ cost: "12,50" }),
) {
  for (let i = 0; i < code.length; i++)
    assert.equal(
      reader.feed({ key: code[i], timeStamp: start + i * gap }, snapshot),
      null,
    )
  return reader.feed(
    { key: "Enter", timeStamp: start + (code.length - 1) * gap + enterGap },
    snapshot,
  )
}

test("scanner retains original field snapshot and processes Enter only once", () => {
  const reader = createBarcodeScanner()
  let field = "12,50"
  const result = burst(reader, "PACK-000001", 100, 10, 10, () => {
    const snapshot = { field }
    field += "X"
    return snapshot
  })
  assert.equal(result.code, "PACK-000001")
  assert.equal(result.snapshot.field, "12,50")
  assert.equal(
    reader.feed({ key: "Enter", timeStamp: 220 }, () => ({})),
    null,
  )
})

test("scanner timing thresholds reject ordinary typing, short codes and stale Enter", () => {
  for (const [code, gap, enterGap, accepted] of [
    ["001", 50, 100, true],
    ["001", 51, 10, false],
    ["001", 10, 101, false],
    ["12", 10, 10, false],
  ])
    assert.equal(
      !!burst(createBarcodeScanner(), code, 100, gap, enterGap),
      accepted,
    )
})

test("scanner ignores shortcuts, composition and repeat; navigation and cleanup discard partial scans", () => {
  for (const interrupt of [
    { key: "Tab" },
    { key: "Escape" },
    { key: "x", ctrlKey: true },
    { key: "x", altKey: true },
    { key: "x", metaKey: true },
    { key: "x", isComposing: true },
    { key: "x", repeat: true },
  ]) {
    const reader = createBarcodeScanner()
    reader.feed({ key: "1", timeStamp: 100 }, () => ({}))
    reader.feed({ key: "2", timeStamp: 110 }, () => ({}))
    reader.feed({ ...interrupt, timeStamp: 115 }, () => ({}))
    reader.feed({ key: "3", timeStamp: 120 }, () => ({}))
    assert.equal(
      reader.feed({ key: "Enter", timeStamp: 130 }, () => ({})),
      null,
    )
  }
  const reader = createBarcodeScanner()
  reader.feed({ key: "1", timeStamp: 100 }, () => ({}))
  reader.feed({ key: "Shift", timeStamp: 105 }, () => ({}))
  reader.feed({ key: "A", timeStamp: 110 }, () => ({}))
  reader.feed({ key: "2", timeStamp: 120 }, () => ({}))
  assert.equal(
    reader.feed({ key: "Enter", timeStamp: 130 }, () => ({})).code,
    "1A2",
  )
  reader.feed({ key: "x", timeStamp: 200 }, () => ({}))
  reader.clear()
  assert.equal(
    reader.feed({ key: "Enter", timeStamp: 210 }, () => ({})),
    null,
  )
})
