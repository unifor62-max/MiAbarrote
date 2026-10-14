import {
  validExpiration,
  almacenes,
  type PurchaseState,
  type DetalleCompra,
  type Compra,
  type Lote,
} from "../../data/purchases.ts"
export interface PurchaseFilters {
  inicio: string
  final: string
  proveedorId: string
  codigo: string
}
export const emptyFilters: PurchaseFilters = {
  inicio: "",
  final: "",
  proveedorId: "",
  codigo: "",
}
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/La_Paz",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})
export function purchaseDay(fecha: string): string {
  const parts = dayFormatter.formatToParts(new Date(fecha))
  const part = (type: string) => parts.find((item) => item.type === type)!.value
  return `${part("year")}-${part("month")}-${part("day")}`
}
export function displayDay(day: string): string {
  return day.split("-").reverse().join("/")
}
export function filterError(
  filters: Pick<PurchaseFilters, "inicio" | "final">,
): string {
  if (!validExpiration(filters.inicio) || !validExpiration(filters.final))
    return "Introduce fechas válidas."
  return filters.inicio && filters.final && filters.inicio > filters.final
    ? "Fecha Inicio debe ser anterior o igual a Fecha Final."
    : ""
}
export type PurchaseSummaryFilters = Omit<PurchaseFilters, "codigo">
export const emptySummaryFilters: PurchaseSummaryFilters = {
  inicio: "",
  final: "",
  proveedorId: "",
}
export interface PurchaseInspectionItem extends DetalleCompra {
  nombre: string
  subtotal: number
  lotes: Lote[]
}
export interface PurchaseSummary extends Compra {
  compraId: number
  dia: string
  proveedor: string
  total: number
  detalles: PurchaseInspectionItem[]
}
/** A purchase remains one transaction regardless of its number of products or lots. */
export function purchaseSummaries(state: PurchaseState): PurchaseSummary[] {
  const providers = new Map(
    state.proveedores.map((item) => [item.id, item.nombre]),
  )
  const products = new Map(
    state.productos.map((item) => [item.id, item.nombre]),
  )
  return state.compras
    .filter((compra) => compra.estado === "registrada")
    .map((compra) => ({
      ...compra,
      compraId: compra.id,
      dia: purchaseDay(compra.fecha),
      total: compra.monto,
      proveedor: providers.get(compra.proveedorId ?? -1) ?? "Sin proveedor",
      detalles: state.detalles
        .filter((detail) => detail.compraId === compra.id)
        .map((detail) => ({
          ...detail,
          nombre: products.get(detail.productoId) ?? "Producto no disponible",
          subtotal: detail.cantidad * detail.precio,
          lotes: state.lotes.filter(
            (lot) =>
              lot.compraId === compra.id &&
              lot.productoId === detail.productoId &&
              lot.almacenId === detail.almacenId,
          ),
        })),
    }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id)
}
export function filterPurchaseSummaries(
  rows: PurchaseSummary[],
  filters: PurchaseSummaryFilters,
): PurchaseSummary[] {
  if (filterError(filters)) return []
  return rows.filter(
    (row) =>
      (!filters.inicio || row.dia >= filters.inicio) &&
      (!filters.final || row.dia <= filters.final) &&
      (!filters.proveedorId || row.proveedorId === Number(filters.proveedorId)),
  )
}
export function purchaseMetrics(rows: PurchaseSummary[]) {
  return {
    cantidad: rows.length,
    monto: rows.reduce((sum, row) => sum + row.total, 0),
    proveedores: new Set(
      rows.map((row) => row.proveedorId).filter((id) => id !== null),
    ).size,
  }
}
export function formatPurchaseMoney(centavos: number): string {
  return (
    "Bs " +
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(centavos / 100)
  )
}
export interface PurchaseRow extends DetalleCompra {
  destino: string
  key: string
  codigo: string
  producto: string
  fecha: string
  dia: string
  proveedor: string
  proveedorId: number | null
  total: number
}
export function purchaseRows(state: PurchaseState): PurchaseRow[] {
  const compras = new Map(state.compras.map((item) => [item.id, item]))
  const productos = new Map(state.productos.map((item) => [item.id, item]))
  const proveedores = new Map(
    state.proveedores.map((item) => [item.id, item.nombre]),
  )
  return state.detalles
    .flatMap((detail, index) => {
      const compra = compras.get(detail.compraId)
      const producto = productos.get(detail.productoId)
      if (!compra || compra.estado !== "registrada" || !producto) return []
      return [
        {
          ...detail,
          destino:
            almacenes.find((item) => item.id === detail.almacenId)?.nombre ??
            "Destino desconocido",
          key: `${compra.id}-${detail.productoId}-${detail.almacenId}-${index}`,
          codigo: producto.codigo_barra,
          producto: producto.nombre,
          fecha: compra.fecha,
          dia: purchaseDay(compra.fecha),
          proveedorId: compra.proveedorId,
          proveedor:
            proveedores.get(compra.proveedorId ?? -1) ?? "Sin proveedor",
          total: detail.cantidad * detail.precio,
        },
      ]
    })
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.compraId - a.compraId)
}
export function filterRows(
  rows: PurchaseRow[],
  filters: PurchaseFilters,
): PurchaseRow[] {
  if (filterError(filters)) return []
  const codigo = filters.codigo.trim().toLowerCase()
  return rows.filter(
    (row) =>
      (!filters.inicio || row.dia >= filters.inicio) &&
      (!filters.final || row.dia <= filters.final) &&
      (!filters.proveedorId ||
        row.proveedorId === Number(filters.proveedorId)) &&
      row.codigo.toLowerCase().includes(codigo),
  )
}
export function paginateRows<T>(rows: T[], requestedPage: number, size = 10) {
  const pages = Math.max(1, Math.ceil(rows.length / size))
  const page = Math.max(1, Math.min(pages, requestedPage))
  return {
    page,
    pages,
    total: rows.length,
    rows: rows.slice((page - 1) * size, page * size),
  }
}
