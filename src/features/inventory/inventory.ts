import { inventoryProducts, type PurchaseState } from "../../data/purchases.ts"

export type InventoryProduct = ReturnType<typeof inventoryProducts>[number]

function normalize(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

export function filterInventory(
  products: InventoryProduct[],
  categoryId: number | null,
  query: string,
  lowStockOnly: boolean,
): InventoryProduct[] {
  const search = normalize(query)
  return products.filter(
    (product) =>
      (categoryId === null || product.categoryId === categoryId) &&
      (!lowStockOnly || product.lowStock) &&
      (normalize(product.name).includes(search) ||
        normalize(product.code).includes(search)),
  )
}

export function inventoryCategories(state: PurchaseState) {
  return state.categorias.map((category) => ({
    ...category,
    count: state.productos.filter(
      (product) => product.categoriaId === category.id,
    ).length,
  }))
}

export function parseStockMinimum(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const minimum = Number(trimmed)
  return Number.isSafeInteger(minimum) ? minimum : null
}
