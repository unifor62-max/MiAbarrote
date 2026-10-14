import assert from "node:assert/strict"
import { test } from "node:test"
import { createPurchaseState, annulPurchase } from "../src/data/purchases.ts"
import {
  purchaseDay,
  purchaseRows,
  emptyFilters,
  filterError,
  filterRows,
  paginateRows,
} from "../src/features/purchases/purchaseDetails.ts"
test("projection joins the required columns, preserves costs and sorts latest first", () => {
  const state = createPurchaseState()
  const before = structuredClone(state)
  const rows = purchaseRows(state)
  assert.equal(rows.length, 24)
  assert.equal(rows[0].compraId, 1024)
  assert.equal(rows[0].codigo, "DEMO-000006")
  assert.equal(rows[0].total, rows[0].cantidad * rows[0].precio)
  assert.equal(new Set(rows.map((r) => r.key)).size, 24)
  assert.deepEqual(state, before)
  const noProvider = {
    ...state,
    compras: state.compras.map((c) => ({ ...c, proveedorId: null })),
  }
  assert.equal(purchaseRows(noProvider)[0].proveedor, "Sin proveedor")
})
test("date limits are inclusive and use the Bolivian day at UTC midnight", () => {
  assert.equal(purchaseDay("2026-10-08T02:00:00.000Z"), "2026-10-07")
  assert.equal(purchaseDay("2026-10-08T04:00:00.000Z"), "2026-10-08")
  const rows = purchaseRows(createPurchaseState())
  const filtered = filterRows(rows, {
    ...emptyFilters,
    inicio: "2026-10-01",
    final: "2026-10-08",
  })
  assert.equal(filtered.length, 8)
  assert.ok(filtered.some((r) => r.dia === "2026-10-01"))
  assert.ok(filtered.some((r) => r.dia === "2026-10-08"))
})
test("provider, code fragments and dates combine; invalid ranges suspend results", () => {
  const rows = purchaseRows(createPurchaseState())
  assert.equal(
    filterRows(rows, { ...emptyFilters, codigo: "demo-000003" }).length,
    4,
  )
  assert.equal(
    filterRows(rows, { ...emptyFilters, proveedorId: "3" }).length,
    6,
  )
  const filters = {
    ...emptyFilters,
    inicio: "2026-09-01",
    final: "2026-10-08",
    proveedorId: "3",
    codigo: "DeMo-000003",
  }
  assert.equal(filterRows(rows, filters).length, 2)
  assert.equal(filterRows(rows, { ...filters, codigo: "unknown" }).length, 0)
  const invalid = { ...emptyFilters, inicio: "2026-10-08", final: "2026-10-01" }
  assert.ok(filterError(invalid))
  assert.deepEqual(filterRows(rows, invalid), [])
})
test("pagination shows 10/10/4 rows, clamps after annulments and handles empty results", () => {
  let state = createPurchaseState()
  const rows = purchaseRows(state)
  assert.equal(paginateRows(rows, 1).rows.length, 10)
  assert.equal(paginateRows(rows, 2).rows.length, 10)
  assert.equal(paginateRows(rows, 3).rows.length, 4)
  assert.equal(paginateRows(rows, 99).page, 3)
  for (const row of paginateRows(rows, 3).rows)
    state = annulPurchase(state, row.compraId)
  const result = paginateRows(purchaseRows(state), 3)
  assert.equal(result.total, 20)
  assert.equal(result.page, 2)
  assert.equal(state.compras.length, 24)
  assert.equal(paginateRows([], 3).page, 1)
  assert.deepEqual(paginateRows([], 3).rows, [])
})
