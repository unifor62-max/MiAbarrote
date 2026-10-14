import type { Proveedor } from "../../data/purchases.ts"

export const supplierBatchSize = 8

function normalize(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

export function filterSuppliers(
  proveedores: Proveedor[],
  search: string,
): Proveedor[] {
  const query = normalize(search)
  return proveedores.filter((item) => normalize(item.nombre).includes(query))
}

export function visibleSuppliers(
  proveedores: Proveedor[],
  search: string,
  limit: number,
) {
  const matches = filterSuppliers(proveedores, search)
  return {
    rows: matches.slice(0, limit),
    total: matches.length,
    hasMore: limit < matches.length,
  }
}
