import assert from "node:assert/strict"
import { test } from "node:test"
import {
  appendProduct,
  appendPurchase,
  createPurchaseState,
  prepareProduct,
  resolveProductCode,
  inventoryProducts,
  applyProductEdits,
} from "../src/data/purchases.ts"
import { createProductEditDraft } from "../src/features/purchases/productDetails.ts"
import { prepareSale } from "../src/data/sales.ts"

const baseDraft = {
  categoriaId: "1",
  codigoBarra: "001234567890",
  nombre: "Producto de prueba",
  precioUnitario: "2,50",
  cantidadUnitaria: "",
  codigoPaquete: "",
  precioPaquete: "",
  codigoPaqueteActivo: false,
  precioPaqueteActivo: false,
}
test("unchecked package fields store strict null even if stale values are supplied", () => {
  const state = createPurchaseState()
  const before = structuredClone(state)
  const result = appendProduct(state, {
    ...baseDraft,
    codigoPaquete: "DEMO-000001",
    precioPaquete: "invalid",
  })
  const product = result.productos.at(-1)
  assert.equal(product.codigo_barra, "001234567890")
  assert.equal(product.codigo_paquete, null)
  assert.equal(product.precio_paquete, null)
  assert.equal(product.paqueteId, null)
  assert.equal(result.paquetes.length, state.paquetes.length)
  assert.deepEqual(state, before)
})
test("the two checkboxes are independent and package quantity stays optional", () => {
  for (const codeActive of [false, true])
    for (const priceActive of [false, true]) {
      const result = appendProduct(createPurchaseState(), {
        ...baseDraft,
        codigoPaqueteActivo: codeActive,
        precioPaqueteActivo: priceActive,
        codigoPaquete: "009876543210",
        precioPaquete: "25.00",
      })
      const product = result.productos.at(-1)
      assert.equal(product.codigo_paquete, codeActive ? "009876543210" : null)
      assert.equal(product.precio_paquete, priceActive ? 2500 : null)
      const pack = result.paquetes.find((item) => item.id === product.paqueteId)
      if (codeActive || priceActive) {
        assert.equal(pack.codigo_barra, codeActive ? "009876543210" : null)
        assert.equal(pack.cantidad_unitaria, null)
      } else assert.equal(pack, undefined)
      assert.equal(
        resolveProductCode(result, "009876543210")?.id,
        codeActive ? product.id : undefined,
      )
    }
})
test("required base fields and enabled package attributes reject invalid values atomically", () => {
  const state = createPurchaseState()
  const before = structuredClone(state)
  for (const change of [
    { codigoBarra: "" },
    { codigoBarra: "   " },
    { categoriaId: "" },
    { nombre: "" },
    { precioUnitario: "" },
    { codigoBarra: "DEMO-000001" },
    { codigoBarra: "PACK-000001" },
    { codigoPaqueteActivo: true, codigoPaquete: "" },
    { codigoPaqueteActivo: true, codigoPaquete: "DEMO-000001" },
    { codigoPaqueteActivo: true, codigoPaquete: baseDraft.codigoBarra },
    { precioPaqueteActivo: true, precioPaquete: "" },
    { precioPaqueteActivo: true, precioPaquete: "0" },
    { cantidadUnitaria: "0" },
    { cantidadUnitaria: "1.5" },
    { cantidadUnitaria: "NaN" },
  ]) {
    assert.equal(prepareProduct(state, { ...baseDraft, ...change }), null)
    assert.throws(() => appendProduct(state, { ...baseDraft, ...change }))
    assert.deepEqual(state, before)
  }
})
test("configured quantity without package code or selling price remains purchasable and editable", () => {
  const created = appendProduct(createPurchaseState(), {
    ...baseDraft,
    cantidadUnitaria: "12",
  })
  const product = created.productos.at(-1)
  const pack = created.paquetes.find((item) => item.id === product.paqueteId)
  assert.equal(pack.cantidad_unitaria, 12)
  assert.equal(pack.codigo_barra, null)
  const purchased = appendPurchase(created, {
    almacenId: "1",
    proveedorId: "1",
    items: [
      {
        productoId: String(product.id),
        categoriaId: "1",
        cantidadPaquetes: "2",
        costoPaquete: "10",
        fechaVencimiento: "",
      },
    ],
  })
  assert.equal(purchased.lotes[0].cantidad_inicial, 24)
  assert.equal(inventoryProducts(purchased).at(-1).packages, 2)
  const edit = createProductEditDraft(purchased, "prices")
  edit.products[product.id].precioUnitario = "3"
  edit.products[product.id].precioPaquete = "ignored"
  const result = applyProductEdits(purchased, edit)
  assert.equal(result.productos.at(-1).precio_unitario, 300)
  assert.equal(result.productos.at(-1).precio_paquete, null)
  assert.equal(
    prepareSale(
      result,
      [{ productoId: product.id, presentacion: "paquete", cantidad: "1" }],
      "2027-01-01T12:00:00Z",
    ).valid,
    false,
  )
  assert.equal(
    prepareSale(
      result,
      [{ productoId: product.id, presentacion: "unidad", cantidad: "1" }],
      "2027-01-01T12:00:00Z",
    ).valid,
    true,
  )
})
test("a code-only package without quantity never invents units on purchase", () => {
  const created = appendProduct(createPurchaseState(), {
    ...baseDraft,
    codigoPaqueteActivo: true,
    codigoPaquete: "009876543210",
  })
  const result = appendPurchase(created, {
    almacenId: "2",
    proveedorId: "1",
    items: [
      {
        productoId: "7",
        categoriaId: "1",
        cantidadPaquetes: "3",
        costoPaquete: "2",
        fechaVencimiento: "",
      },
    ],
  })
  assert.equal(result.lotes[0].cantidad_inicial, 3)
  assert.equal(result.detalles[0].presentacion, "unidad")
  assert.equal(result.productos.at(-1).precio_paquete, null)
})
