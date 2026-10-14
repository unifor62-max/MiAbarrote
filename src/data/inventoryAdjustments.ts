import {
  almacenes,
  availableProductLots,
  lotReceivedAt,
  validExpiration,
  type PurchaseState,
} from "./purchases.ts"

export interface InventoryAdjustmentItemDraft {
  productoId: number
  presentacion: "unidad" | "paquete"
  cantidad: string
  fechaVencimiento: string
}
export interface InventoryAdjustmentDraft {
  almacenId: number
  tipo: "entrada" | "salida"
  items: InventoryAdjustmentItemDraft[]
}
export interface AdjustmentLotChange {
  loteId: number
  unidades: number
}
export interface AdjustmentDetail {
  productoId: number
  nombreProducto: string
  presentacion: "unidad" | "paquete"
  cantidad: number
  unidadesPorPaquete: number
  unidades: number
  fechaVencimiento: string | null
  lotes: AdjustmentLotChange[]
}
export interface AjusteInventario {
  id: number
  fecha: string
  almacenId: number
  tipo: "entrada" | "salida"
  detalles: AdjustmentDetail[]
}
export interface AdjustmentFeedback {
  intento: number
  ajusteId: number | null
  error: string
}

export function prepareInventoryAdjustment(
  state: PurchaseState,
  draft: InventoryAdjustmentDraft,
  fecha = new Date().toISOString(),
) {
  let error = ""
  const issues: Record<number, string> = {}
  if (!Number.isFinite(Date.parse(fecha)))
    error = "La fecha del ajuste no es válida."
  else if (!almacenes.some((item) => item.id === draft.almacenId))
    error = "Selecciona un origen válido."
  else if (draft.tipo !== "entrada" && draft.tipo !== "salida")
    error = "Selecciona Entrada o Salida."
  else if (!draft.items.length) error = "Selecciona al menos un producto."
  else if (new Set(state.lotes.map((lot) => lot.id)).size !== state.lotes.length)
    error = "El inventario contiene identificadores de lote repetidos."
  else if (
    new Set(draft.items.map((item) => item.productoId)).size !==
    draft.items.length
  )
    error = "Hay productos repetidos en el ajuste."
  const lots = availableProductLots(state)
  const rows = draft.items.map((item) => {
    const product = state.productos.find(
      (product) => product.id === item.productoId,
    )
    const pack = state.paquetes.find((pack) => pack.id === product?.paqueteId)
    const size = pack?.cantidad_unitaria ?? 1
    const quantity = /^\d+$/.test(item.cantidad.trim())
      ? Number(item.cantidad)
      : NaN
    const units = quantity * (item.presentacion === "paquete" ? size : 1)
    const stock =
      state.existencias.find(
        (stock) =>
          stock.productoId === item.productoId &&
          stock.almacenId === draft.almacenId,
      )?.stock ?? 0
    const productLots = lots.filter(
      (lot) =>
        lot.productoId === item.productoId && lot.almacenId === draft.almacenId,
    )
    const physical = productLots.reduce((sum, lot) => sum + lot.stock_actual, 0)
    let issue = ""
    if (!product) issue = "El producto no está disponible."
    else if (item.presentacion !== "unidad" && item.presentacion !== "paquete")
      issue = "Selecciona Unidad o Paquete."
    else if (
      item.presentacion === "paquete" &&
      (!pack?.cantidad_unitaria || !Number.isSafeInteger(size) || size <= 0)
    )
      issue = "El producto no tiene un tamaño de paquete válido."
    else if (
      !Number.isSafeInteger(quantity) ||
      quantity <= 0 ||
      !Number.isSafeInteger(units)
    )
      issue =
        "Ingresa una cantidad entera positiva dentro del límite permitido."
    else if (
      !Number.isSafeInteger(stock) ||
      stock < 0 ||
      !Number.isSafeInteger(physical) ||
      stock !== physical ||
      state.existencias.filter(
        (relation) =>
          relation.productoId === item.productoId &&
          relation.almacenId === draft.almacenId,
      ).length > 1 ||
      state.lotes.some(
        (lot) =>
          lot.productoId === item.productoId &&
          lot.almacenId === draft.almacenId &&
          (!Number.isSafeInteger(lot.stock_actual) ||
            lot.stock_actual < 0 ||
            (lot.stock_actual > 0 &&
              (!validExpiration(lot.fecha_vencimiento ?? "") ||
                !Number.isFinite(
                  Date.parse(lotReceivedAt(state, lot) ?? ""),
                )))),
      )
    )
      issue = "Las existencias y los lotes no están conciliados."
    else if (
      draft.tipo === "entrada" &&
      !validExpiration(item.fechaVencimiento)
    )
      issue = "Introduce un vencimiento válido o deja la fecha vacía."
    else if (draft.tipo === "entrada" && !Number.isSafeInteger(stock + units))
      issue = "El stock resultante supera el límite permitido."
    else if (draft.tipo === "salida" && units > stock)
      issue = "Stock insuficiente: " + stock + " unidades físicas."
    if (issue) issues[item.productoId] = issue
    const changes: AdjustmentLotChange[] = []
    if (!issue && draft.tipo === "salida") {
      let remaining = units
      productLots.sort(
        (a, b) =>
          Number(a.fecha_vencimiento === null) -
            Number(b.fecha_vencimiento === null) ||
          (a.fecha_vencimiento ?? "").localeCompare(
            b.fecha_vencimiento ?? "",
          ) ||
          (lotReceivedAt(state, a) ?? "").localeCompare(
            lotReceivedAt(state, b) ?? "",
          ) ||
          a.id - b.id,
      )
      for (const lot of productLots) {
        const used = Math.min(remaining, lot.stock_actual)
        if (used) changes.push({ loteId: lot.id, unidades: used })
        remaining -= used
        if (!remaining) break
      }
    }
    return {
      productoId: item.productoId,
      nombreProducto: product?.nombre ?? "Producto no disponible",
      presentacion: item.presentacion,
      cantidad: quantity,
      unidadesPorPaquete: size,
      unidades: units,
      fechaVencimiento:
        draft.tipo === "entrada" ? item.fechaVencimiento || null : null,
      lotes: changes,
      stock,
      stockResultante: draft.tipo === "entrada" ? stock + units : stock - units,
    }
  })
  return { rows, issues, error, valid: !error && !Object.keys(issues).length }
}

/** Prepare every row before modifying lots, ledger or physical stock. */
export function applyInventoryAdjustment(
  state: PurchaseState,
  draft: InventoryAdjustmentDraft,
  fecha = new Date().toISOString(),
): PurchaseState {
  const prepared = prepareInventoryAdjustment(state, draft, fecha)
  if (!prepared.valid)
    throw new Error(prepared.error || Object.values(prepared.issues).join("\n"))
  const id = Math.max(
    state.nextAdjustmentId ?? 1,
    ...(state.ajustes ?? []).map((item) => item.id + 1),
  )
  const firstLot = Math.max(
    state.nextLotId ?? 1,
    ...state.lotes.map((lot) => lot.id + 1),
  )
  if (!Number.isSafeInteger(id) || !Number.isSafeInteger(id + 1) || (draft.tipo === "entrada" && (!Number.isSafeInteger(firstLot) || !Number.isSafeInteger(firstLot + prepared.rows.length))))
    throw new Error("Se alcanzó el límite de identificadores del inventario.")
  const details: AdjustmentDetail[] = prepared.rows.map(
    ({ stock: _stock, stockResultante: _next, ...row }, index) => ({
      ...row,
      lotes:
        draft.tipo === "entrada"
          ? [{ loteId: firstLot + index, unidades: row.unidades }]
          : row.lotes,
    }),
  )
  const consumption = new Map(
    details.flatMap((item) =>
      item.lotes.map((lot) => [lot.loteId, lot.unidades] as const),
    ),
  )
  const lotes =
    draft.tipo === "entrada"
      ? [
          ...state.lotes,
          ...details.map((item, index) => ({
            id: firstLot + index,
            nombre: "AJUSTE-" + id + "-" + item.productoId,
            fecha_vencimiento: item.fechaVencimiento,
            cantidad_inicial: item.unidades,
            stock_actual: item.unidades,
            compraId: null,
            ajusteId: id,
            productoId: item.productoId,
            almacenId: draft.almacenId,
          })),
        ]
      : state.lotes.map((lot) =>
          consumption.has(lot.id)
            ? {
                ...lot,
                stock_actual: lot.stock_actual - consumption.get(lot.id)!,
              }
            : lot,
        )
  const existencias = [...state.existencias]
  for (const item of details) {
    if (
      !existencias.some(
        (stock) =>
          stock.productoId === item.productoId &&
          stock.almacenId === draft.almacenId,
      )
    )
      existencias.push({
        productoId: item.productoId,
        almacenId: draft.almacenId,
        stock: 0,
        stock_minimo: 10,
      })
  }
  const affected = new Set(details.map((item) => item.productoId))
  return {
    ...state,
    lotes,
    existencias: existencias.map((stock) =>
      stock.almacenId === draft.almacenId && affected.has(stock.productoId)
        ? {
            ...stock,
            stock: lotes
              .filter(
                (lot) =>
                  lot.productoId === stock.productoId &&
                  lot.almacenId === stock.almacenId,
              )
              .reduce((sum, lot) => sum + lot.stock_actual, 0),
          }
        : stock,
    ),
    ajustes: [
      ...(state.ajustes ?? []),
      {
        id,
        fecha,
        almacenId: draft.almacenId,
        tipo: draft.tipo,
        detalles: details,
      },
    ],
    nextAdjustmentId: id + 1,
    nextLotId:
      draft.tipo === "entrada" ? firstLot + details.length : state.nextLotId,
  }
}
