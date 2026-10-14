import assert from "node:assert/strict"
import { test } from "node:test"
import {
  applyProductEdits,
  annulPurchase,
  appendProduct,
  availableProductLots,
  changedProductEditIds,
  createPurchaseState,
  inventoryProducts,
  validateProductEdits,
} from "../src/data/purchases.ts"
import {
  createProductEditDraft,
  filterProductRows,
  productRows,
  productRowsForMode,
  updateProductEditDraft,
} from "../src/features/purchases/productDetails.ts"
import { paginateRows } from "../src/features/purchases/purchaseDetails.ts"

test("names and categories show unique products before search and pagination; other views retain lots", () => {
  const rows = productRows(createPurchaseState())
  const before = structuredClone(rows)
  for (const mode of ["names", "categories"]) {
    const products = productRowsForMode(rows, mode)
    assert.equal(products.length, 6)
    assert.equal(new Set(products.map((row) => row.productoId)).size, 6)
    assert.deepEqual(
      products.map((row) => row.codigo),
      [...new Set(rows.map((row) => row.codigo))],
    )
    assert.equal(filterProductRows(products, "demo-000003").length, 1)
    assert.equal(paginateRows(products, 3).page, 1)
    assert.equal(paginateRows(products, 3).total, 6)
    assert.equal(paginateRows(products, 3).pages, 1)
    const sameNames = rows.map((row) => ({ ...row, nombre: "Mismo nombre" }))
    assert.equal(productRowsForMode(sameNames, mode).length, 6)
  }
  for (const mode of [undefined, "prices", "expiration"]) {
    assert.equal(productRowsForMode(rows, mode).length, 24)
    assert.equal(
      filterProductRows(productRowsForMode(rows, mode), "000003").length,
      4,
    )
  }
  assert.deepEqual(rows, before)
})

test("one row per available lot with master attributes, stable ordering and compound warehouse relation", () => {
  const state = createPurchaseState()
  const rows = productRows(state)
  assert.equal(rows.length, 24)
  assert.equal(new Set(rows.map((r) => r.loteId)).size, 24)
  assert.equal(rows[0].codigo, "DEMO-000001")
  assert.equal(rows[0].loteId, 19)
  for (const product of state.productos) {
    const group = rows.filter((r) => r.productoId === product.id)
    assert.equal(group.length, 4)
    assert.equal(new Set(group.map((r) => r.precioUnitario)).size, 1)
    assert.equal(group[0].precioUnitario, product.precio_unitario)
    assert.equal(
      group[0].categoria,
      state.categorias.find((c) => c.id === product.categoriaId).nombre,
    )
  }
  const noStock = {
    ...state,
    lotes: state.lotes.map((l) => (l.id === 1 ? { ...l, stock_actual: 0 } : l)),
  }
  assert.equal(productRows(noStock).length, 23)
  assert.equal(productRows(annulPurchase(state, 1001)).length, 23)
  assert.equal(productRows({ ...state, existencias: [] }).length, 0)
})

test("code search is immediate, partial and insensitive to case, with 10/10/4 pagination", () => {
  const rows = productRows(createPurchaseState())
  assert.equal(filterProductRows(rows, " DeMo-000003 ").length, 4)
  assert.equal(filterProductRows(rows, "00000").length, 24)
  assert.equal(filterProductRows(rows, "leche").length, 0)
  assert.equal(filterProductRows(rows, "missing").length, 0)
  assert.equal(paginateRows(rows, 1).rows.length, 10)
  assert.equal(paginateRows(rows, 2).rows.length, 10)
  assert.equal(paginateRows(rows, 3).rows.length, 4)
  assert.equal(paginateRows(filterProductRows(rows, "000003"), 3).page, 1)
})

test("price drafts synchronize product lots, retain edits on hidden pages and store exact independent prices", () => {
  const state = createPurchaseState()
  const before = structuredClone(state)
  let draft = createProductEditDraft(state, "prices")
  assert.equal(changedProductEditIds(state, draft).count, 0)
  draft = updateProductEditDraft(draft, 1, "precioUnitario", "12.34")
  draft = updateProductEditDraft(draft, 1, "precioPaquete", "150.17")
  draft = updateProductEditDraft(draft, 6, "precioUnitario", "0.01")
  const originalDraft = structuredClone(draft)
  const hiddenRows = filterProductRows(productRows(state), "000003")
  assert.ok(hiddenRows.every((r) => r.productoId !== 1 && r.productoId !== 6))
  const result = applyProductEdits(state, draft)
  assert.equal(changedProductEditIds(state, draft).count, 2)
  assert.equal(result.productos[0].precio_unitario, 1234)
  assert.equal(result.productos[0].precio_paquete, 15017)
  assert.equal(result.productos[5].precio_unitario, 1)
  assert.ok(
    productRows(result)
      .filter((r) => r.productoId === 1)
      .every((r) => r.precioUnitario === 1234),
  )
  assert.equal(inventoryProducts(result)[0].price, 12.34)
  assert.deepEqual(result.compras, state.compras)
  assert.deepEqual(result.detalles, state.detalles)
  assert.deepEqual(result.existencias, state.existencias)
  assert.deepEqual(result.lotes, state.lotes)
  assert.deepEqual(state, before)
  assert.deepEqual(draft, originalDraft)
})

test("names and category assignments propagate through the master while category names stay unchanged", () => {
  const state = createPurchaseState()
  const names = updateProductEditDraft(
    createProductEditDraft(state, "names"),
    3,
    "nombre",
    " Leche nueva ",
  )
  const renamed = applyProductEdits(state, names)
  assert.equal(renamed.productos[2].nombre, "Leche nueva")
  assert.ok(
    productRows(renamed)
      .filter((r) => r.productoId === 3)
      .every((r) => r.nombre === "Leche nueva"),
  )
  assert.equal(inventoryProducts(renamed)[2].name, "Leche nueva")
  const categories = updateProductEditDraft(
    createProductEditDraft(renamed, "categories"),
    3,
    "categoriaId",
    "1",
  )
  const result = applyProductEdits(renamed, categories)
  assert.equal(result.productos[2].categoriaId, 1)
  assert.equal(inventoryProducts(result)[2].category, "Abarrotes")
  assert.deepEqual(result.categorias, state.categorias)
  assert.ok(
    productRows(result)
      .filter((r) => r.productoId === 3)
      .every((r) => r.categoria === "Abarrotes"),
  )
})

test("expiration edits target one lot, allow past dates and null, and update the nearest Inventory expiry", () => {
  const state = createPurchaseState()
  const group = availableProductLots(state).filter((l) => l.productoId === 3)
  let draft = createProductEditDraft(state, "expiration")
  draft = updateProductEditDraft(draft, group[0].id, "expiration", "2020-02-29")
  const changed = applyProductEdits(state, draft)
  assert.equal(inventoryProducts(changed)[2].expiration, "2020-02-29")
  assert.equal(
    changed.lotes.find((l) => l.id === group[0].id).fecha_vencimiento,
    "2020-02-29",
  )
  assert.deepEqual(changed.productos, state.productos)
  assert.deepEqual(
    changed.lotes.filter((l) => l.id !== group[0].id),
    state.lotes.filter((l) => l.id !== group[0].id),
  )
  const cleared = applyProductEdits(
    changed,
    updateProductEditDraft(
      createProductEditDraft(changed, "expiration"),
      group[0].id,
      "expiration",
      "",
    ),
  )
  assert.equal(
    cleared.lotes.find((l) => l.id === group[0].id).fecha_vencimiento,
    null,
  )
  assert.notEqual(inventoryProducts(cleared)[2].expiration, "2020-02-29")
  assert.deepEqual(changed.existencias, state.existencias)
})

test("invalid edits reject the whole batch, including changed entities hidden by search or pagination", () => {
  const state = createPurchaseState()
  const before = structuredClone(state)
  for (const [mode, id, field, value] of [
    ["prices", 6, "precioUnitario", ""],
    ["prices", 6, "precioUnitario", "0"],
    ["prices", 6, "precioPaquete", "2.001"],
    ["prices", 6, "precioPaquete", "1e3"],
    ["names", 6, "nombre", "   "],
    ["names", 6, "nombre", "x".repeat(121)],
    ["categories", 6, "categoriaId", "999"],
    ["expiration", 24, "expiration", "2026-02-29"],
  ]) {
    let draft = createProductEditDraft(state, mode)
    const validField =
      mode === "prices"
        ? "precioUnitario"
        : mode === "names"
          ? "nombre"
          : mode === "categories"
            ? "categoriaId"
            : "expiration"
    draft = updateProductEditDraft(
      draft,
      1,
      validField,
      mode === "prices"
        ? "1.17"
        : mode === "names"
          ? "Nuevo"
          : mode === "categories"
            ? "3"
            : "2028-02-29",
    )
    draft = updateProductEditDraft(draft, id, field, value)
    assert.ok(
      validateProductEdits(state, draft).some((issue) => issue.id === id),
    )
    assert.throws(() => applyProductEdits(state, draft))
    assert.deepEqual(state, before)
  }
})

test("discarding a draft makes no mutations and semantic no-ops do not require confirmation", () => {
  const state = createPurchaseState()
  const before = structuredClone(state)
  const draft = updateProductEditDraft(
    createProductEditDraft(state, "names"),
    1,
    "nombre",
    "Temporal",
  )
  assert.equal(changedProductEditIds(state, draft).count, 1)
  assert.equal(
    changedProductEditIds(state, createProductEditDraft(state, "names")).count,
    0,
  )
  const noOp = updateProductEditDraft(
    createProductEditDraft(state, "names"),
    1,
    "nombre",
    ` ${state.productos[0].nombre} `,
  )
  assert.equal(applyProductEdits(state, noOp), state)
  assert.equal(
    applyProductEdits(state, createProductEditDraft(state, "prices")),
    state,
  )
  assert.deepEqual(state, before)
})

test("no-stock product has no row and edits against unavailable products or lots are rejected", () => {
  const state = createPurchaseState()
  const withProduct = appendProduct(state, {
    codigoBarra: "DEMO-000007",
    nombre: "Nuevo",
    categoriaId: "1",
    cantidadUnitaria: "12",
    precioUnitario: "1",
    precioPaquete: "12",
  })
  assert.equal(productRows(withProduct).length, 24)
  const draft = updateProductEditDraft(
    createProductEditDraft(state, "expiration"),
    1,
    "expiration",
    "2028-02-29",
  )
  assert.throws(() => applyProductEdits(annulPurchase(state, 1001), draft))
  const unknown = updateProductEditDraft(
    createProductEditDraft(state, "names"),
    999,
    "nombre",
    "Missing",
  )
  assert.throws(() => applyProductEdits(state, unknown))
})

test("initial price drafts preserve every cent up to the supported safe integer limit", () => {
  const initial = createPurchaseState()
  const state = {
    ...initial,
    productos: initial.productos.map((p) =>
      p.id === 1 ? { ...p, precio_unitario: Number.MAX_SAFE_INTEGER } : p,
    ),
  }
  const draft = createProductEditDraft(state, "prices")
  assert.equal(draft.products[1].precioUnitario, "90071992547409.91")
  assert.equal(changedProductEditIds(state, draft).count, 0)
})

test("incomplete native dates remain invalid even when hidden, while explicitly cleared dates are null", () => {
  const state = createPurchaseState()
  const draft = updateProductEditDraft(
    createProductEditDraft(state, "expiration"),
    1,
    "expiration",
    "",
    true,
  )
  assert.equal(changedProductEditIds(state, draft).count, 1)
  assert.ok(validateProductEdits(state, draft).some((item) => item.id === 1))
  assert.throws(() => applyProductEdits(state, draft))
  const cleared = updateProductEditDraft(draft, 1, "expiration", "")
  assert.equal(changedProductEditIds(state, cleared).count, 0)
  assert.equal(applyProductEdits(state, cleared), state)
})
