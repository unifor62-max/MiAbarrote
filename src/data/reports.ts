import { bolivianDay, civilDaysBetween } from "./dates.ts"
import {
  almacenes,
  availableProductLots,
  inventoryProducts,
  validExpiration,
} from "./purchases.ts"
import type { POSState } from "./sales.ts"

export interface ReportFilters {
  inicio: string
  final: string
}
export interface ReportLot {
  id: number
  nombre: string
  producto: string
  codigo: string
  vencimiento: string
  days: number
  stock: number
  urgency: "critical" | "soon" | "healthy"
}
export interface TopProduct {
  id: number
  nombre: string
  codigo: string
  unidades: number
  ingresos: number
}

export function reportFilterError(filters: ReportFilters): string {
  if (!validExpiration(filters.inicio) || !validExpiration(filters.final))
    return "Introduce fechas válidas."
  return filters.inicio && filters.final && filters.inicio > filters.final
    ? "La fecha Desde debe ser anterior o igual a Hasta."
    : ""
}

export function reportLots(
  state: POSState,
  today = bolivianDay(),
): ReportLot[] {
  const products = new Map(
    state.inventario.productos.map((item) => [item.id, item]),
  )
  return availableProductLots(state.inventario)
    .flatMap((lot): ReportLot[] => {
      if (
        lot.almacenId !== almacenes[0].id ||
        !lot.fecha_vencimiento ||
        !validExpiration(lot.fecha_vencimiento)
      )
        return []
      const days = civilDaysBetween(today, lot.fecha_vencimiento)
      if (days < 0) return []
      const product = products.get(lot.productoId)!
      return [
        {
          id: lot.id,
          nombre: lot.nombre,
          producto: product.nombre,
          codigo: product.codigo_barra,
          vencimiento: lot.fecha_vencimiento,
          days,
          stock: lot.stock_actual,
          urgency: days <= 7 ? "critical" : days < 30 ? "soon" : "healthy",
        },
      ]
    })
    .sort((a, b) => a.vencimiento.localeCompare(b.vencimiento) || a.id - b.id)
}

export function buildReports(
  state: POSState,
  filters: ReportFilters,
  today = bolivianDay(),
) {
  const error = reportFilterError(filters)
  const lots = reportLots(state, today)
  const stockAlerts = inventoryProducts(state.inventario).filter(
    (item) => item.lowStock,
  ).length
  const expiryAlerts = lots.filter((lot) => lot.days < 30).length
  const inRange = (fecha: string) => {
    const day = bolivianDay(fecha)
    return (
      (!filters.inicio || day >= filters.inicio) &&
      (!filters.final || day <= filters.final)
    )
  }
  const sales = error
    ? []
    : state.ventas.filter(
        (sale) => sale.estado === "registrada" && inRange(sale.fecha),
      )
  const purchases = error
    ? []
    : state.inventario.compras.filter(
        (purchase) =>
          purchase.estado === "registrada" && inRange(purchase.fecha),
      )
  const ingresos = sales.reduce((sum, sale) => sum + sale.monto, 0)
  const egresos = purchases.reduce((sum, purchase) => sum + purchase.monto, 0)
  const selectedSales = new Set(sales.map((sale) => sale.id))
  const products = new Map(
    state.inventario.productos.map((item) => [item.id, item]),
  )
  const ranking = new Map<number, TopProduct>()
  for (const detail of state.detallesVenta) {
    if (!selectedSales.has(detail.ventaId)) continue
    const product = products.get(detail.productoId)
    const item = ranking.get(detail.productoId) ?? {
      id: detail.productoId,
      nombre: product?.nombre ?? detail.nombreProducto,
      codigo: product?.codigo_barra ?? detail.codigoBarra,
      unidades: 0,
      ingresos: 0,
    }
    item.unidades +=
      detail.cantidad *
      (detail.presentacion === "paquete" ? detail.unidadesPorPaquete : 1)
    item.ingresos += detail.subtotal
    ranking.set(item.id, item)
  }
  return {
    error,
    ingresos: error ? null : ingresos,
    egresos: error ? null : egresos,
    margen: error ? null : ingresos - egresos,
    stockAlerts,
    expiryAlerts,
    criticalAlerts: stockAlerts + expiryAlerts,
    lots,
    topProducts: [...ranking.values()]
      .sort(
        (a, b) =>
          b.unidades - a.unidades || b.ingresos - a.ingresos || a.id - b.id,
      )
      .slice(0, 5),
  }
}
