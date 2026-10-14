import assert from "node:assert/strict"
import { test } from "node:test"
import {
  appendPurchase,
  annulPurchase,
  createPurchaseState,
  preparePurchase,
  parseCost,
  cuenta,
  almacenes,
  appendProduct,
  appendCatalogName,
  appendSupplier,
  prepareProduct,
  validExpiration,
  inventoryProducts,
} from "../src/data/purchases.ts"
const validDraft = {
  almacenId: "1",
  proveedorId: "3",
  categoriaId: "3",
  productoId: "3",
  cantidadPaquetes: "3",
  costoPaquete: "12,50",
  fechaVencimiento: "",
}
test("fixtures have valid relationships and exact historical totals", () => {
  const state = createPurchaseState()
  const { productos, categorias, proveedores, paquetes, existencias } = state
  assert.deepEqual(state, createPurchaseState())
  assert.equal(state.compras.length, 24)
  assert.equal(state.detalles.length, 24)
  assert.equal(state.lotes.length, 24)
  for (const product of productos) {
    assert.ok(
      new Set(
        state.lotes
          .filter((l) => l.productoId === product.id && l.fecha_vencimiento)
          .map((l) => l.fecha_vencimiento),
      ).size > 1,
    )
    assert.equal("fecha_vencimiento" in product, false)
  }
  assert.equal(productos.length, 6)
  assert.equal(categorias.length, 4)
  assert.equal(proveedores.length, 20)
  assert.equal(new Set(state.compras.map((item) => item.id)).size, 24)
  for (const product of productos) {
    assert.ok(categorias.some((item) => item.id === product.categoriaId))
    assert.ok(paquetes.some((item) => item.id === product.paqueteId))
  }
  for (const purchase of state.compras) {
    const detail = state.detalles.find((item) => item.compraId === purchase.id)
    assert.ok(detail)
    assert.ok(productos.some((item) => item.id === detail.productoId))
    assert.ok(proveedores.some((item) => item.id === purchase.proveedorId))
    assert.equal(purchase.cuentaId, cuenta.id)
    assert.ok(
      existencias.some(
        (item) =>
          item.productoId === detail.productoId &&
          item.almacenId === detail.almacenId,
      ),
    )
    assert.equal(purchase.monto, detail.cantidad * detail.precio)
  }
  for (const stock of existencias) {
    assert.ok(productos.some((item) => item.id === stock.productoId))
    assert.ok(almacenes.some((item) => item.id === stock.almacenId))
  }
})
test("decimal parsing accepts comma or dot without rounding invalid inputs", () => {
  for (const value of ["12,50", "12.50"]) assert.equal(parseCost(value), 1250)
  assert.equal(parseCost("0,01"), 1)
  assert.equal(parseCost("3"), 300)
  for (const value of [
    "",
    "0",
    "-3",
    "1.234",
    "1,234",
    "NaN",
    "Infinity",
    "1e3",
    "1,2.3",
    "9007199254740992",
  ]) {
    assert.equal(parseCost(value), null, value)
  }
})
test("purchase validation rejects missing references, mismatched categories and unsafe quantities", () => {
  const state = createPurchaseState()
  const invalid = [
    { almacenId: "" },
    { almacenId: "99" },
    { proveedorId: "" },
    { proveedorId: "missing" },
    { categoriaId: "1" },
    { productoId: "" },
    { productoId: "missing" },
    { cantidadPaquetes: "0" },
    { cantidadPaquetes: "-1" },
    { cantidadPaquetes: "1.5" },
    { cantidadPaquetes: "1e3" },
    { cantidadPaquetes: "9007199254740992" },
    { costoPaquete: "0" },
    { cantidadPaquetes: "10000000000000", costoPaquete: "10000" },
  ]
  for (const override of invalid)
    assert.equal(preparePurchase(state, { ...validDraft, ...override }), null)
  assert.deepEqual(preparePurchase(state, validDraft), {
    productoId: 3,
    almacenId: 1,
    cantidad: 3,
    presentacion: "paquete",
    precio: 1250,
    unidadesPorPaquete: 12,
  })
})
test("saving creates a linked detail and lot atomically, updates stock and preserves original state", () => {
  const state = createPurchaseState()
  const before = structuredClone(state)
  const stockBefore = structuredClone(state.existencias)
  const result = appendPurchase(state, validDraft, "2026-10-08T18:00:00.000Z")
  assert.deepEqual(state, before)
  assert.equal(result.existencias[2].stock, stockBefore[2].stock + 36)
  assert.equal(result.lotes[0].cantidad_inicial, 36)
  assert.equal(result.lotes[0].fecha_vencimiento, null)
  assert.equal(result.compras.length, 25)
  assert.equal(result.detalles.length, 25)
  assert.equal(result.compras[0].id, 1025)
  assert.equal(result.compras[0].monto, 3750)
  assert.equal(result.detalles[0].compraId, result.compras[0].id)
  assert.equal(result.compras[0].fecha, "2026-10-08T18:00:00.000Z")
  assert.throws(() =>
    appendPurchase(state, { ...validDraft, costoPaquete: "0" }),
  )
  assert.deepEqual(state, before)
})
const productDraft = {
  codigoBarra: "DEMO-000007",
  codigoPaquete: "PACK-000007",
  codigoPaqueteActivo: true,
  precioPaqueteActivo: true,
  categoriaId: "1",
  nombre: " Producto de prueba ",
  cantidadUnitaria: "12",
  precioUnitario: "2,50",
  precioPaquete: "32.17",
}
test("catalog IDs are numeric, suppliers match the diagram and each initial state is independent", () => {
  const first = createPurchaseState()
  const second = createPurchaseState()
  for (const key of [
    "categorias",
    "proveedores",
    "paquetes",
    "productos",
    "compras",
  ]) {
    for (const record of first[key]) assert.equal(typeof record.id, "number")
  }
  assert.deepEqual(Object.keys(first.proveedores[0]).sort(), [
    "id",
    "nombre",
    "telefono",
  ])
  first.productos[0].nombre = "changed"
  first.proveedores.push({ id: 999, nombre: "temporary", telefono: "70123456" })
  assert.deepEqual(second, createPurchaseState())
})
test("product creation owns its package, stores independent sale prices and starts with zero stock", () => {
  const state = createPurchaseState()
  const before = structuredClone(state)
  const result = appendProduct(state, productDraft)
  assert.deepEqual(state, before)
  const product = result.productos.at(-1)
  assert.equal(product.id, 7)
  assert.equal(product.nombre, "Producto de prueba")
  assert.equal(product.precio_unitario, 250)
  assert.equal(product.precio_paquete, 3217)
  assert.equal("fecha_vencimiento" in product, false)
  assert.equal(product.codigo_barra, "DEMO-000007")
  assert.equal(result.paquetes.length, state.paquetes.length + 1)
  assert.equal(
    result.paquetes.find((item) => item.id === product.paqueteId)
      .cantidad_unitaria,
    12,
  )
  assert.deepEqual(
    result.existencias.find(
      (item) => item.productoId === 7 && item.almacenId === 1,
    ),
    {
      productoId: 7,
      almacenId: 1,
      stock: 0,
      stock_minimo: 10,
    },
  )
  const inventory = inventoryProducts(result).at(-1)
  assert.equal(inventory.name, product.nombre)
  assert.equal(inventory.category, "Abarrotes")
  assert.equal(inventory.status, "Sin existencias")
  assert.equal(inventory.stock, 0)
  assert.equal(inventory.price, 2.5)
})
test("a new presentation gets one package and product codes stay unique", () => {
  const state = createPurchaseState()
  const result = appendProduct(state, {
    ...productDraft,
    cantidadUnitaria: "10",
  })
  const product = result.productos.at(-1)
  assert.equal(result.paquetes.length, state.paquetes.length + 1)
  assert.equal(result.paquetes.at(-1).cantidad_unitaria, 10)
  assert.equal("fecha_vencimiento" in product, false)
  assert.equal(inventoryProducts(result).at(-1).expiration, null)
  const another = appendProduct(result, {
    ...productDraft,
    codigoBarra: "DEMO-000008",
    codigoPaquete: "PACK-000008",
    cantidadUnitaria: "10",
  })
  assert.equal(another.paquetes.length, result.paquetes.length + 1)
  assert.notEqual(another.productos.at(-1).paqueteId, product.paqueteId)
  assert.equal(new Set(another.productos.map((item) => item.id)).size, 8)
})
test("optional expiration accepts actual Gregorian dates and rejects normalized or impossible dates", () => {
  for (const value of [
    "",
    "2028-02-29",
    "2000-02-29",
    "2026-10-08",
    "9999-12-31",
  ])
    assert.equal(validExpiration(value), true, value)
  for (const value of [
    "2026-02-29",
    "1900-02-29",
    "2026-04-31",
    "0000-01-01",
    "2026-13-01",
    "2026-01-00",
    "08/10/2026",
    "2026-1-1",
    "2026-10-08T00:00:00Z",
  ])
    assert.equal(validExpiration(value), false, value)
})
test("invalid products and blank catalog names cannot create partial records", () => {
  const state = createPurchaseState()
  const before = structuredClone(state)
  for (const override of [
    { nombre: "   " },
    { categoriaId: "99" },
    { cantidadUnitaria: "0" },
    { cantidadUnitaria: "1.5" },
    { precioUnitario: "0" },
    { precioPaquete: "12,345" },
    { precioUnitario: "9007199254740992" },
  ]) {
    assert.equal(prepareProduct(state, { ...productDraft, ...override }), null)
    assert.throws(() => appendProduct(state, { ...productDraft, ...override }))
  }
  assert.throws(() => appendCatalogName(state, "categorias", "   "))
  assert.throws(() =>
    appendSupplier(state, { nombre: "", telefono: "70123456" }),
  )
  assert.deepEqual(state, before)
})
test("new categories, products and suppliers are immediately usable in purchases through their stock relation", () => {
  const initial = createPurchaseState()
  const withCategory = appendCatalogName(initial, "categorias", " Limpieza ")
  assert.deepEqual(withCategory.categorias.at(-1), {
    id: 5,
    nombre: "Limpieza",
  })
  assert.equal(initial.categorias.length, 4)
  const withProduct = appendProduct(withCategory, {
    ...productDraft,
    categoriaId: "5",
    cantidadUnitaria: "10",
  })
  const withSupplier = appendSupplier(withProduct, {
    nombre: " Proveedor nuevo ",
    telefono: " +591 7012 3456 ",
  })
  const supplierId = withSupplier.proveedores.at(-1).id
  assert.deepEqual(withSupplier.proveedores.at(-1), {
    id: 21,
    nombre: "Proveedor nuevo",
    telefono: "+591 7012 3456",
  })
  const draft = {
    almacenId: "1",
    proveedorId: String(supplierId),
    categoriaId: "5",
    productoId: "7",
    cantidadPaquetes: "2",
    costoPaquete: "17",
    fechaVencimiento: "",
  }
  const final = appendPurchase(withSupplier, draft)
  assert.equal(final.compras[0].monto, 3400)
  assert.equal(final.compras[0].proveedorId, supplierId)
  assert.deepEqual(final.detalles[0], {
    compraId: 1025,
    productoId: 7,
    almacenId: 1,
    cantidad: 2,
    presentacion: "paquete",
    precio: 1700,
    unidadesPorPaquete: 10,
  })
  assert.equal(
    final.existencias.find(
      (item) => item.productoId === 7 && item.almacenId === 1,
    ).stock,
    20,
  )
  assert.equal(
    withSupplier.existencias.find(
      (item) => item.productoId === 7 && item.almacenId === 1,
    ).stock,
    0,
  )
  assert.notEqual(
    preparePurchase({ ...withSupplier, existencias: [] }, draft),
    null,
  )
})
test("lot dates belong to each purchase, available stock reconciles and annulment is idempotent", () => {
  // This fixture puts demo expirations after the incoming purchase's date.
  const state = createPurchaseState("2027-01-01")
  const before = structuredClone(state)
  const result = appendPurchase(state, {
    ...validDraft,
    fechaVencimiento: "2026-11-01",
  })
  const next = appendPurchase(result, {
    ...validDraft,
    fechaVencimiento: "2028-02-29",
  })
  assert.equal(result.lotes[0].fecha_vencimiento, "2026-11-01")
  assert.equal(next.lotes[0].fecha_vencimiento, "2028-02-29")
  assert.equal(inventoryProducts(next)[2].expiration, "2026-11-01")
  assert.equal("fecha_vencimiento" in next.productos[2], false)
  for (const record of next.existencias) {
    assert.equal(
      record.stock,
      next.lotes
        .filter(
          (l) =>
            l.productoId === record.productoId &&
            l.almacenId === record.almacenId,
        )
        .reduce((s, l) => s + l.stock_actual, 0),
    )
  }
  const cancelled = annulPurchase(next, 1025)
  assert.equal(cancelled.compras.find((c) => c.id === 1025).estado, "anulada")
  assert.equal(cancelled.lotes.find((l) => l.compraId === 1025).stock_actual, 0)
  assert.equal(cancelled.existencias[2].stock, next.existencias[2].stock - 36)
  assert.deepEqual(cancelled.detalles, next.detalles)
  assert.equal(
    cancelled.lotes.find((l) => l.compraId === 1025).cantidad_inicial,
    36,
  )
  assert.equal(cancelled.compras.find((c) => c.id === 1025).monto, 3750)
  assert.equal(annulPurchase(cancelled, 1025), cancelled)
  assert.deepEqual(state, before)
  assert.throws(() =>
    appendPurchase(state, { ...validDraft, fechaVencimiento: "2026-02-29" }),
  )
  assert.equal(new Set(next.lotes.map((l) => l.id)).size, next.lotes.length)
  assert.equal(
    new Set(next.productos.map((p) => p.codigo_barra)).size,
    next.productos.length,
  )
})
test("annulling partially consumed lots only removes remaining units, and no-date lots stay null", () => {
  const state = appendPurchase(createPurchaseState(), validDraft)
  const consumed = {
    ...state,
    lotes: state.lotes.map((l) =>
      l.compraId === 1025 ? { ...l, stock_actual: 7 } : l,
    ),
    existencias: state.existencias.map((e) =>
      e.productoId === 3 ? { ...e, stock: e.stock - 29 } : e,
    ),
  }
  const result = annulPurchase(consumed, 1025)
  assert.equal(result.existencias[2].stock, consumed.existencias[2].stock - 7)
  assert.equal(state.lotes[0].fecha_vencimiento, null)
})
