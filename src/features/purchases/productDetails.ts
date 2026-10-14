import {
  availableProductLots,
  type PurchaseState,
  type ProductEditDraft,
  type ProductEditMode,
  type EditableProduct,
} from "../../data/purchases.ts"

export interface ProductRow {
  tienePaquete: boolean
  loteId: number
  productoId: number
  codigo: string
  nombre: string
  precioUnitario: number
  precioPaquete: number | null
  categoriaId: number
  categoria: string
  lote: string
  vencimiento: string | null
}

export function productRows(state: PurchaseState): ProductRow[] {
  const products = new Map(state.productos.map((item) => [item.id, item]))
  const categories = new Map(
    state.categorias.map((item) => [item.id, item.nombre]),
  )
  return availableProductLots(state)
    .map((lot) => {
      const product = products.get(lot.productoId)!
      return {
        tienePaquete: product.paqueteId !== null,
        loteId: lot.id,
        productoId: product.id,
        codigo: product.codigo_barra,
        nombre: product.nombre,
        precioUnitario: product.precio_unitario,
        precioPaquete: product.precio_paquete,
        categoriaId: product.categoriaId,
        categoria: categories.get(product.categoriaId) ?? "Sin categoría",
        lote: lot.nombre,
        vencimiento: lot.fecha_vencimiento,
      }
    })
    .sort((a, b) => a.codigo.localeCompare(b.codigo) || b.loteId - a.loteId)
}

export function filterProductRows(
  rows: ProductRow[],
  query: string,
): ProductRow[] {
  const text = query.trim().toLowerCase()
  return rows.filter((item) => item.codigo.toLowerCase().includes(text))
}

export function productRowsForMode(
  rows: ProductRow[],
  mode?: ProductEditMode,
): ProductRow[] {
  if (mode !== "names" && mode !== "categories") return rows
  const products = new Set<number>()
  return rows.filter((row) => {
    if (products.has(row.productoId)) return false
    products.add(row.productoId)
    return true
  })
}

export function createProductEditDraft(
  state: PurchaseState,
  mode: ProductEditMode,
): ProductEditDraft {
  const rows = productRows(state)
  return {
    mode,
    invalidDates: [],
    products: Object.fromEntries(
      rows.map((item) => [
        item.productoId,
        {
          nombre: item.nombre,
          categoriaId: String(item.categoriaId),
          precioUnitario: decimalInput(item.precioUnitario),
          precioPaquete:
            item.precioPaquete === null ? "" : decimalInput(item.precioPaquete),
        },
      ]),
    ),
    lots: Object.fromEntries(
      rows.map((item) => [item.loteId, item.vencimiento ?? ""]),
    ),
  }
}

export function updateProductEditDraft(
  draft: ProductEditDraft,
  id: number,
  field: keyof EditableProduct | "expiration",
  value: string,
  invalidDate = false,
): ProductEditDraft {
  if (field === "expiration")
    return {
      ...draft,
      lots: { ...draft.lots, [id]: value },
      invalidDates: [
        ...draft.invalidDates.filter((item) => item !== id),
        ...(invalidDate ? [id] : []),
      ],
    }
  return {
    ...draft,
    products: {
      ...draft.products,
      [id]: { ...draft.products[id], [field]: value },
    },
  }
}

function decimalInput(cents: number): string {
  const digits = String(cents).padStart(3, "0")
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`
}
