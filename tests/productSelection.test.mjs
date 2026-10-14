import assert from "node:assert/strict"
import { test } from "node:test"
import {
  prioritizedProducts,
  matchesProductCode,
} from "../src/features/purchases/productSelection.ts"
import { createPurchaseState } from "../src/data/purchases.ts"

test("selections stay first in arrival order regardless of category or code filters", () => {
  const catalog = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
  const original = structuredClone(catalog)
  assert.deepEqual(
    prioritizedProducts(catalog, [3, 1], () => true).map((p) => p.id),
    [3, 1, 2, 4],
  )
  assert.deepEqual(
    prioritizedProducts(catalog, [3, 1], () => false).map((p) => p.id),
    [3, 1],
  )
  assert.deepEqual(
    prioritizedProducts(catalog, [3, 1], (p) => p.id === 4).map((p) => p.id),
    [3, 1, 4],
  )
  assert.deepEqual(catalog, original)
})
test("deselection restores catalog order; reselection joins the end; repeated IDs never duplicate", () => {
  const catalog = [{ id: 1 }, { id: 2 }, { id: 3 }]
  assert.deepEqual(
    prioritizedProducts(catalog, [3], () => true).map((p) => p.id),
    [3, 1, 2],
  )
  assert.deepEqual(
    prioritizedProducts(catalog, [3, 1], () => true).map((p) => p.id),
    [3, 1, 2],
  )
  assert.deepEqual(
    prioritizedProducts(catalog, [3, 3, 99], () => true).map((p) => p.id),
    [3, 1, 2],
  )
  assert.deepEqual(
    prioritizedProducts(catalog, [], () => true),
    catalog,
  )
})
test("unselected code filters search individual and owned package codes without losing leading zeros", () => {
  const state = createPurchaseState()
  const product = { ...state.productos[0], codigo_barra: "001234" }
  const packages = [{ id: product.paqueteId, codigo_barra: "009ABC" }]
  assert.equal(matchesProductCode(product, packages, "001"), true)
  assert.equal(matchesProductCode(product, packages, " 009abc "), true)
  assert.equal(matchesProductCode(product, packages, "unknown"), false)
  assert.equal(
    matchesProductCode({ ...product, paqueteId: null }, packages, "009"),
    false,
  )
  assert.equal(
    matchesProductCode(
      product,
      [{ id: product.paqueteId, codigo_barra: null }],
      "009",
    ),
    false,
  )
})
