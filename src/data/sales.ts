import {
  actualizarProveedor,
  almacenes,
  annulPurchase,
  appendCatalogName,
  appendProduct,
  appendPurchase,
  appendSupplier,
  applyProductEdits,
  availableProductLots,
  lotReceivedAt,
  createPurchaseState,
  createPurchaseHistory,
  deletePurchase,
  cuenta,
  validExpiration,
  setStockMinimum,
  type Lote,
  type NamedCatalog,
  type ProductDraft,
  type ProductEditDraft,
  type ProveedorDraft,
  type PurchaseInput,
  type PurchaseFeedback,
  type PurchaseState,
} from "./purchases.ts"

import { bolivianDay } from "./dates.ts"
import {
  cashPayment,
  paymentError,
  type PaymentMode,
  type DetallePago,
  type PaymentNotification,
  type SalePaymentDraft,
} from "./payments.ts"
import {
  applyInventoryTransfer,
  type InventoryTransferDraft,
  type TransferFeedback,
} from "./inventoryTransfers.ts"
import {
  applyInventoryAdjustment,
  type InventoryAdjustmentDraft,
  type AdjustmentFeedback,
} from "./inventoryAdjustments.ts"

export type SalePresentation = "unidad" | "paquete"

export interface SaleDraftRow {
  productoId: number

  presentacion: SalePresentation

  cantidad: string
}

export interface Venta {
  tipoPagoId: PaymentMode
  detallePago: DetallePago
  origenPago: "efectivo" | "notificacion" | "manual" | "historico"
  notificacionPago?: PaymentNotification
  id: number

  fecha: string

  monto: number

  estado: "registrada"

  cuentaId: number

  cajeroNombre: string
}

export interface ConsumoVenta {
  loteId: number

  unidades: number
}

export interface DetalleVenta {
  ventaId: number

  productoId: number

  almacenId: number

  nombreProducto: string

  codigoBarra: string

  presentacion: SalePresentation

  cantidad: number

  precio: number

  subtotal: number

  unidadesPorPaquete: number

  consumos: ConsumoVenta[]
}

export interface POSState {
  inventario: PurchaseState

  ventas: Venta[]

  detallesVenta: DetalleVenta[]
}

const dateFormatter = new Intl.DateTimeFormat("es-BO", {
  timeZone: "America/La_Paz",

  day: "2-digit",

  month: "2-digit",

  year: "numeric",

  hour: "2-digit",

  minute: "2-digit",

  hourCycle: "h23",
})

export function saleDay(fecha: string): string {
  return bolivianDay(fecha)
}

export function formatSaleDate(fecha: string): string {
  return dateFormatter.format(new Date(fecha))
}

export function saleableLots(inventario: PurchaseState, fecha: string): Lote[] {
  const day = saleDay(fecha)

  return availableProductLots(inventario)

    .filter(
      (lote) =>
        lote.almacenId === almacenes[0].id &&
        Number.isSafeInteger(lote.stock_actual) &&
        Date.parse(lotReceivedAt(inventario, lote)!) <= Date.parse(fecha) &&
        (lote.fecha_vencimiento === null ||
          (validExpiration(lote.fecha_vencimiento) &&
            lote.fecha_vencimiento >= day)),
    )

    .sort(
      (a, b) =>
        Number(a.fecha_vencimiento === null) -
          Number(b.fecha_vencimiento === null) ||
        (a.fecha_vencimiento ?? "").localeCompare(b.fecha_vencimiento ?? "") ||
        lotReceivedAt(inventario, a)!.localeCompare(
          lotReceivedAt(inventario, b)!,
        ) ||
        a.id - b.id,
    )
}

export function saleCatalog(inventario: PurchaseState, fecha: string) {
  const stocks = new Map<number, number>()

  for (const lote of saleableLots(inventario, fecha))
    stocks.set(
      lote.productoId,

      (stocks.get(lote.productoId) ?? 0) + lote.stock_actual,
    )

  return inventario.productos.map((product) => ({
    ...product,

    categoria:
      inventario.categorias.find((item) => item.id === product.categoriaId)
        ?.nombre ?? "Sin categoría",

    unidadesPorPaquete:
      inventario.paquetes.find((item) => item.id === product.paqueteId)
        ?.cantidad_unitaria ?? null,

    stockVendible: stocks.get(product.id) ?? 0,
  }))
}

export function prepareSale(
  inventario: PurchaseState,

  draft: SaleDraftRow[],

  fecha: string,
) {
  if (!Number.isFinite(Date.parse(fecha)))
    throw new Error("Fecha de venta inválida.")

  const catalog = new Map(
    saleCatalog(inventario, fecha).map((item) => [item.id, item]),
  )

  const lots = saleableLots(inventario, fecha)

  const issues: Record<number, string> = {}

  let error = draft.length ? "" : "Selecciona al menos un producto para vender."

  if (new Set(draft.map((item) => item.productoId)).size !== draft.length)
    error = "Cada producto debe aparecer una sola vez."

  let total = 0

  const rows = draft.map((row) => {
    const product = catalog.get(row.productoId)

    const cantidad = /^\d+$/.test(row.cantidad) ? Number(row.cantidad) : NaN

    const packageSize = product?.unidadesPorPaquete ?? 1

    const precio =
      row.presentacion === "paquete"
        ? (product?.precio_paquete ?? 0)
        : (product?.precio_unitario ?? 0)

    const unidades =
      cantidad * (row.presentacion === "paquete" ? packageSize : 1)

    const subtotal = cantidad * precio

    let issue = ""

    if (!product) issue = "El producto ya no está disponible."
    else if (row.presentacion !== "unidad" && row.presentacion !== "paquete")
      issue = "Selecciona una presentación válida."
    else if (!Number.isSafeInteger(cantidad) || cantidad <= 0)
      issue = "Ingresa una cantidad entera mayor que cero."
    else if (
      row.presentacion === "paquete" &&
      (!product.unidadesPorPaquete ||
        !Number.isSafeInteger(packageSize) ||
        packageSize <= 0)
    )
      issue = "Este producto no tiene presentación por paquete."
    else if (
      !Number.isSafeInteger(precio) ||
      precio <= 0 ||
      !Number.isSafeInteger(subtotal) ||
      !Number.isSafeInteger(unidades)
    )
      issue = "La cantidad o el precio exceden los valores admitidos."
    else if (unidades > product.stockVendible)
      issue = `Stock insuficiente: ${product.stockVendible} unidades vendibles.`

    if (issue) issues[row.productoId] = issue

    const consumos: ConsumoVenta[] = []

    if (!issue) {
      let remaining = unidades

      for (const lote of lots.filter(
        (item) => item.productoId === row.productoId,
      )) {
        const used = Math.min(remaining, lote.stock_actual)

        if (used > 0) consumos.push({ loteId: lote.id, unidades: used })

        remaining -= used

        if (!remaining) break
      }

      total += subtotal
    }

    return {
      productoId: row.productoId,

      almacenId: almacenes[0].id,

      nombreProducto: product?.nombre ?? "Producto no disponible",

      codigoBarra: product?.codigo_barra ?? "",

      presentacion: row.presentacion,

      cantidad,

      precio,

      subtotal: issue ? 0 : subtotal,

      unidadesPorPaquete: packageSize,

      consumos,

      stockVendible: product?.stockVendible ?? 0,
    }
  })

  if (!Number.isSafeInteger(total))
    error = "El total excede el importe admitido."

  const valid = !error && Object.keys(issues).length === 0

  return { rows, issues, error, total: valid ? total : 0, valid }
}

export function registerSale(
  state: POSState,

  draft: SaleDraftRow[],

  fecha = new Date().toISOString(),

  cashier: Pick<typeof cuenta, "id" | "nombre"> = cuenta,
  payment?: SalePaymentDraft,
): POSState {
  const prepared = prepareSale(state.inventario, draft, fecha)

  if (!prepared.valid)
    throw new Error(
      prepared.error || "Revisa las cantidades y el stock vendible.",
    )

  const appliedPayment = payment ?? cashPayment(prepared.total)
  const issue = paymentError(appliedPayment, prepared.total)
  if (issue) throw new Error(issue)
  if (
    appliedPayment.notificacion &&
    state.ventas.some(
      (sale) => sale.notificacionPago?.id === appliedPayment.notificacion?.id,
    )
  )
    throw new Error("Esta notificación ya fue utilizada en una venta.")

  const id =
    state.ventas.reduce((maximum, item) => Math.max(maximum, item.id), 0) + 1

  const consumption = new Map<number, number>()

  const detalles = prepared.rows.map(({ stockVendible: _stock, ...row }) => {
    for (const item of row.consumos)
      consumption.set(
        item.loteId,

        (consumption.get(item.loteId) ?? 0) + item.unidades,
      )

    return { ventaId: id, ...row }
  })

  const lotes = state.inventario.lotes.map((lote) =>
    consumption.has(lote.id)
      ? { ...lote, stock_actual: lote.stock_actual - consumption.get(lote.id)! }
      : lote,
  )

  const inventario = {
    ...state.inventario,

    lotes,

    existencias: state.inventario.existencias.map((stock) => ({
      ...stock,

      stock: lotes

        .filter(
          (lote) =>
            lote.productoId === stock.productoId &&
            lote.almacenId === stock.almacenId,
        )

        .reduce((sum, lote) => sum + lote.stock_actual, 0),
    })),
  }

  const venta: Venta = {
    tipoPagoId: appliedPayment.tipoPagoId,
    detallePago: { ...appliedPayment.detallePago },
    origenPago: appliedPayment.notificacion
      ? "notificacion"
      : appliedPayment.manual
        ? "manual"
        : "efectivo",
    ...(appliedPayment.notificacion
      ? { notificacionPago: { ...appliedPayment.notificacion } }
      : {}),
    id,

    fecha,

    monto: prepared.total,

    estado: "registrada",

    cuentaId: cashier.id,

    cajeroNombre: cashier.nombre,
  }

  return {
    inventario,

    ventas: [venta, ...state.ventas],

    detallesVenta: [...detalles, ...state.detallesVenta],
  }
}

export function createPOSState(referenceDay = bolivianDay()): POSState {
  const inventario = createPurchaseState(referenceDay)

  let state: POSState = { inventario, ventas: [], detallesVenta: [] }

  const lastPurchase = Math.max(
    ...inventario.compras.map((item) => Date.parse(item.fecha)),
  )

  for (let index = 0; index < 24; index++) {
    const draft: SaleDraftRow[] = Array.from(
      { length: (index % 3) + 1 },

      (_, offset) => ({
        productoId: ((index + offset) % inventario.productos.length) + 1,

        presentacion: index === 23 && offset === 0 ? "paquete" : "unidad",

        cantidad:
          index === 23 && offset === 0
            ? "1"
            : String(offset === 0 ? (index % 3) + 1 : 1),
      }),
    )

    state = registerSale(
      state,

      draft,

      new Date(lastPurchase + (index + 1) * 60000).toISOString(),
    )
    const latest = state.ventas[0]
    const tipoPagoId = ((index % 3) + 1) as PaymentMode
    const qr =
      tipoPagoId === 1
        ? latest.monto
        : tipoPagoId === 2
          ? Math.floor(latest.monto / 2)
          : 0
    state = {
      ...state,
      ventas: [
        {
          ...latest,
          tipoPagoId,
          origenPago: "historico",
          detallePago: { monto_qr: qr, monto_efectivo: latest.monto - qr },
        },
        ...state.ventas.slice(1),
      ],
    }
  }

  return state
}

export interface POSAppState extends POSState {
  saleConfirming: boolean
  transferFeedback: TransferFeedback
  adjustmentFeedback: AdjustmentFeedback
  purchaseFeedback: PurchaseFeedback
  saleOpen: boolean

  saleError: string

  saleNotice: string

  saleSequence: number
}

export type POSAction = {
  type: "sale/beginConfirm"
} | {
  type: "sale/confirmError"
  error: string
} | {
  type: "sale/commitPrepared"
  base: POSState
  next: POSState
} | {
  type: "inventory/transfer"
  draft: InventoryTransferDraft
  fecha: string
} | {
  type: "inventory/adjust"
  draft: InventoryAdjustmentDraft
  fecha: string
} | {
  type: "inventory/setMinimum"
  productoId: number
  almacenId: number
  minimum: number
} | { type: "sale/open" } | { type: "sale/close" } | {
  type: "sale/clearNotice"
} | {
  type: "sale/register"

  draft: SaleDraftRow[]
  payment?: SalePaymentDraft

  fecha: string
} | {
  type: "purchase/append"

  draft: PurchaseInput
} | {
  type: "purchase/annul"

  id: number
} | {
  type: "purchase/delete"
  id: number
} | {
  type: "product/append"

  draft: ProductDraft
} | {
  type: "product/edit"

  draft: ProductEditDraft
} | {
  type: "catalog/append"

  catalog: NamedCatalog

  nombre: string
} | {
  type: "supplier/append"

  draft: ProveedorDraft
} | {
  type: "supplier/edit"

  id: number

  draft: ProveedorDraft
}

export function createPOSAppState(referenceDay = bolivianDay()): POSAppState {
  const initial = createPOSState(referenceDay)
  return {
    ...initial,
    inventario: createPurchaseHistory(initial.inventario, referenceDay),
    purchaseFeedback: { intento: 0, compraId: null, error: "" },
    transferFeedback: { intento: 0, traspasoId: null, error: "" },
    adjustmentFeedback: { intento: 0, ajusteId: null, error: "" },

    saleOpen: false,
    saleConfirming: false,

    saleError: "",

    saleNotice: "",

    saleSequence: 0,
  }
}

export function posReducer(state: POSAppState, action: POSAction): POSAppState {
  if (
    state.saleConfirming &&
    action.type !== "sale/commitPrepared" &&
    action.type !== "sale/confirmError"
  )
    return state
  switch (action.type) {
    case "sale/beginConfirm":
      return state.saleOpen
        ? { ...state, saleConfirming: true, saleError: "" }
        : state
    case "sale/confirmError":
      return { ...state, saleConfirming: false, saleError: action.error }
    case "sale/commitPrepared":
      if (!state.saleOpen || !state.saleConfirming) return state
      if (
        state.inventario !== action.base.inventario ||
        state.ventas !== action.base.ventas ||
        state.detallesVenta !== action.base.detallesVenta
      )
        return {
          ...state,
          saleConfirming: false,
          saleError:
            "El inventario cambió. Revisa la venta antes de confirmar.",
        }
      return {
        ...state,
        ...action.next,
        saleOpen: false,
        saleConfirming: false,
        saleError: "",
        saleSequence: state.saleSequence + 1,
        saleNotice: `Venta V-${action.next.ventas[0].id} registrada correctamente.`,
      }
    case "inventory/transfer": {
      const intento = state.transferFeedback.intento + 1
      try {
        const inventario = applyInventoryTransfer(
          state.inventario,
          action.draft,
          action.fecha,
        )
        return {
          ...state,
          inventario,
          transferFeedback: {
            intento,
            traspasoId: inventario.traspasos.at(-1)!.id,
            error: "",
          },
        }
      } catch (cause) {
        return {
          ...state,
          transferFeedback: {
            intento,
            traspasoId: null,
            error:
              cause instanceof Error
                ? cause.message
                : "No se pudo registrar el traspaso.",
          },
        }
      }
    }
    case "inventory/adjust": {
      const intento = state.adjustmentFeedback.intento + 1
      try {
        const inventario = applyInventoryAdjustment(
          state.inventario,
          action.draft,
          action.fecha,
        )
        return {
          ...state,
          inventario,
          adjustmentFeedback: {
            intento,
            ajusteId: inventario.ajustes[inventario.ajustes.length - 1].id,
            error: "",
          },
        }
      } catch (cause) {
        return {
          ...state,
          adjustmentFeedback: {
            intento,
            ajusteId: null,
            error:
              cause instanceof Error
                ? cause.message
                : "No se pudo registrar el ajuste.",
          },
        }
      }
    }
    case "inventory/setMinimum":
      return {
        ...state,

        inventario: setStockMinimum(
          state.inventario,
          action.productoId,
          action.almacenId,
          action.minimum,
        ),
      }

    case "sale/open":
      return { ...state, saleOpen: true, saleError: "", saleNotice: "" }

    case "sale/close":
      return { ...state, saleOpen: false, saleError: "" }

    case "sale/clearNotice":
      return { ...state, saleNotice: "" }

    case "sale/register": {
      if (!state.saleOpen) return state

      try {
        const next = registerSale(
          state,
          action.draft,
          action.fecha,
          undefined,
          action.payment,
        )

        return {
          ...state,

          ...next,

          saleOpen: false,

          saleError: "",

          saleSequence: state.saleSequence + 1,

          saleNotice: `Venta V-${next.ventas[0].id} registrada correctamente.`,
        }
      } catch (error) {
        return {
          ...state,

          saleError:
            error instanceof Error
              ? error.message
              : "No se pudo registrar la venta.",
        }
      }
    }

    case "purchase/append": {
      const intento = state.purchaseFeedback.intento + 1
      try {
        const inventario = appendPurchase(state.inventario, action.draft)
        return {
          ...state,
          inventario,
          purchaseFeedback: {
            intento,
            compraId: inventario.compras[0].id,
            error: "",
          },
        }
      } catch (error) {
        return {
          ...state,
          purchaseFeedback: {
            intento,
            compraId: null,
            error:
              error instanceof Error
                ? error.message
                : "No se pudo registrar la compra.",
          },
        }
      }
    }

    case "purchase/annul":
      return {
        ...state,

        inventario: annulPurchase(state.inventario, action.id),
      }
    case "purchase/delete":
      return {
        ...state,
        inventario: deletePurchase(state.inventario, action.id),
      }

    case "product/append":
      return {
        ...state,

        inventario: appendProduct(state.inventario, action.draft),
      }

    case "product/edit":
      return {
        ...state,

        inventario: applyProductEdits(state.inventario, action.draft),
      }

    case "catalog/append":
      return {
        ...state,

        inventario: appendCatalogName(
          state.inventario,

          action.catalog,

          action.nombre,
        ),
      }

    case "supplier/append":
      return {
        ...state,

        inventario: appendSupplier(state.inventario, action.draft),
      }

    case "supplier/edit":
      return {
        ...state,

        inventario: actualizarProveedor(
          state.inventario,

          action.id,

          action.draft,
        ),
      }
  }
}
