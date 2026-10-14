import assert from "node:assert/strict"
import { test } from "node:test"
import {
  actualizarProveedor,
  appendSupplier,
  createPurchaseState,
  prepareSupplier,
} from "../src/data/purchases.ts"
import { purchaseRows } from "../src/features/purchases/purchaseDetails.ts"
import {
  filterSuppliers,
  supplierBatchSize,
  visibleSuppliers,
} from "../src/features/purchases/supplierDetails.ts"

test("20 independent suppliers retain the original IDs and purchase relationships", () => {
  const state = createPurchaseState()
  assert.equal(state.proveedores.length, 20)
  assert.equal(new Set(state.proveedores.map((item) => item.id)).size, 20)
  assert.deepEqual(
    state.proveedores.slice(0, 4).map(({ id, nombre }) => ({ id, nombre })),
    [
      { id: 1, nombre: "Distribuidora Valle Verde" },
      { id: 2, nombre: "Granos del Altiplano" },
      { id: 3, nombre: "Lácteos La Pradera" },
      { id: 4, nombre: "Comercial El Canasto" },
    ],
  )
  for (const supplier of state.proveedores) {
    assert.deepEqual(Object.keys(supplier).sort(), ["id", "nombre", "telefono"])
    assert.equal(typeof supplier.id, "number")
    assert.equal(typeof supplier.nombre, "string")
    assert.equal(typeof supplier.telefono, "string")
    assert.ok(supplier.nombre.trim() && supplier.telefono.trim())
  }
  state.proveedores[0].telefono = "changed"
  assert.notEqual(createPurchaseState().proveedores[0].telefono, "changed")
})

test("create and edit trim fields while preserving phone formatting and previous state", () => {
  const initial = createPurchaseState()
  const before = structuredClone(initial)
  const created = appendSupplier(initial, {
    nombre: " Nueva empresa ",
    telefono: " 001 (2) 123-4567 ",
  })
  const supplier = created.proveedores.at(-1)
  assert.deepEqual(supplier, {
    id: 21,
    nombre: "Nueva empresa",
    telefono: "001 (2) 123-4567",
  })
  const edited = actualizarProveedor(created, supplier.id, {
    nombre: " Empresa editada ",
    telefono: " +591 7654 3210 ",
  })
  assert.deepEqual(edited.proveedores.at(-1), {
    id: 21,
    nombre: "Empresa editada",
    telefono: "+591 7654 3210",
  })
  assert.deepEqual(created.proveedores.at(-1), supplier)
  assert.deepEqual(initial, before)
  assert.strictEqual(edited.compras, initial.compras)
  assert.strictEqual(edited.productos, initial.productos)
  assert.strictEqual(edited.proveedores[0], initial.proveedores[0])
})

test("invalid fields and unknown IDs reject edits atomically", () => {
  const state = createPurchaseState()
  const before = structuredClone(state)
  for (const draft of [
    { nombre: "", telefono: "70123456" },
    { nombre: "   ", telefono: "70123456" },
    { nombre: "a".repeat(121), telefono: "70123456" },
    { nombre: "Empresa", telefono: "" },
    { nombre: "Empresa", telefono: "  " },
  ]) {
    assert.equal(prepareSupplier(draft), null)
    assert.throws(() => appendSupplier(state, draft))
    assert.throws(() => actualizarProveedor(state, 1, draft))
  }
  assert.throws(() =>
    actualizarProveedor(state, 999, {
      nombre: "Empresa",
      telefono: "70123456",
    }),
  )
  assert.deepEqual(state, before)
  assert.ok(
    prepareSupplier({ nombre: "a".repeat(120), telefono: "(2) 245-8102" }),
  )
})

test("renaming a supplier propagates to purchase projections without changing references or totals", () => {
  const initial = createPurchaseState()
  const edited = actualizarProveedor(initial, 3, {
    nombre: "Nueva Pradera",
    telefono: "70123456",
  })
  const rows = purchaseRows(edited).filter((row) => row.proveedorId === 3)
  assert.ok(rows.length)
  assert.ok(rows.every((row) => row.proveedor === "Nueva Pradera"))
  assert.deepEqual(edited.compras, initial.compras)
  assert.equal(initial.proveedores[2].nombre, "Lácteos La Pradera")
})

test("search is partial, case and accent insensitive and includes suppliers beyond the first batch", () => {
  const { proveedores } = createPurchaseState()
  assert.equal(filterSuppliers(proveedores, "").length, 20)
  assert.equal(filterSuppliers(proveedores, "  LACTEOS ")[0].id, 3)
  assert.equal(filterSuppliers(proveedores, "féRTil")[0].id, 19)
  assert.equal(filterSuppliers(proveedores, "rio")[0].id, 17)
  assert.equal(filterSuppliers(proveedores, "inexistente").length, 0)
  assert.equal(
    visibleSuppliers(proveedores, "Andes", supplierBatchSize).rows[0].id,
    20,
  )
})

test("progressive slices load 8/16/20 without duplicates and search resets to one batch", () => {
  const { proveedores } = createPurchaseState()
  for (const [limit, count, hasMore] of [
    [8, 8, true],
    [16, 16, true],
    [24, 20, false],
  ]) {
    const result = visibleSuppliers(proveedores, "", limit)
    assert.equal(result.rows.length, count)
    assert.equal(result.total, 20)
    assert.equal(result.hasMore, hasMore)
    assert.equal(new Set(result.rows.map((item) => item.id)).size, count)
  }
  assert.equal(
    visibleSuppliers(proveedores, "", supplierBatchSize).rows.length,
    8,
  )
  assert.deepEqual(visibleSuppliers(proveedores, "inexistente", 8), {
    rows: [],
    total: 0,
    hasMore: false,
  })
})

test("a saved rename can remove the edited supplier from current search results", () => {
  const initial = createPurchaseState()
  assert.equal(filterSuppliers(initial.proveedores, "Pradera").length, 1)
  const edited = actualizarProveedor(initial, 3, {
    nombre: "Alimentos del Sur",
    telefono: "70123456",
  })
  assert.equal(filterSuppliers(edited.proveedores, "Pradera").length, 0)
  assert.equal(filterSuppliers(edited.proveedores, "del sur")[0].id, 3)
})
