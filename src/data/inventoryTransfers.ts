import {
  almacenes,
  availableProductLots,
  lotReceivedAt,
  validExpiration,
  type Lote,
  type PurchaseState,
} from "./purchases.ts"

export interface InventoryTransferItemDraft {
  productoId: number
  presentacion: "unidad" | "paquete"
  cantidad: string
}
export interface InventoryTransferDraft {
  origenId: number | null
  destinoId: number | null
  items: InventoryTransferItemDraft[]
}
export interface TransferLotChange {
  loteOrigenId: number
  loteDestinoId: number
  unidades: number
}
export interface TransferDetail
  extends Omit<InventoryTransferItemDraft, "cantidad"> {
  nombreProducto: string
  cantidad: number
  unidadesPorPaquete: number
  unidades: number
  lotes: TransferLotChange[]
}
export interface TraspasoInventario {
  id: number
  fecha: string
  origenId: number
  destinoId: number
  detalles: TransferDetail[]
}
export interface TransferFeedback {
  intento: number
  traspasoId: number | null
  error: string
}

export function prepareInventoryTransfer(
  state: PurchaseState,
  draft: InventoryTransferDraft,
  fecha = new Date().toISOString(),
) {
  let error = ""
  const issues: Record<number, string> = {}
  if (!Number.isFinite(Date.parse(fecha)))
    error = "La fecha del traspaso no es válida."
  else if (!almacenes.some((item) => item.id === draft.origenId))
    error = "Selecciona un origen válido."
  else if (!almacenes.some((item) => item.id === draft.destinoId))
    error = "Selecciona un destino válido."
  else if (draft.origenId === draft.destinoId)
    error = "Origen y destino deben ser diferentes."
  else if (!draft.items.length) error = "Selecciona al menos un producto."
  else if (
    new Set(draft.items.map((item) => item.productoId)).size !==
    draft.items.length
  )
    error = "Hay productos repetidos en el traspaso."
  else if (
    new Set(state.lotes.map((lot) => lot.id)).size !== state.lotes.length
  )
    error = "El inventario contiene identificadores de lote repetidos."
  const available = availableProductLots(state)
  const rows = draft.items.map((item) => {
    const product = state.productos.find(
      (product) => product.id === item.productoId,
    )
    const size = state.paquetes.find((pack) => pack.id === product?.paqueteId)
      ?.cantidad_unitaria
    const quantity = /^\d+$/.test(item.cantidad.trim())
      ? Number(item.cantidad)
      : NaN
    const units = quantity * (item.presentacion === "paquete" ? (size ?? 1) : 1)
    const relations = (warehouse: number | null) =>
      state.existencias.filter(
        (stock) =>
          stock.productoId === item.productoId && stock.almacenId === warehouse,
      )
    const origin = relations(draft.origenId)
    const destination = relations(draft.destinoId)
    const stock = origin[0]?.stock ?? 0
    const destinationStock = destination[0]?.stock ?? 0
    const reconciled = (warehouse: number | null, records: typeof origin) => {
      const lots = state.lotes.filter(
        (lot) =>
          lot.productoId === item.productoId && lot.almacenId === warehouse,
      )
      const physical = lots.reduce((sum, lot) => sum + lot.stock_actual, 0)
      const usable = available
        .filter(
          (lot) =>
            lot.productoId === item.productoId && lot.almacenId === warehouse,
        )
        .reduce((sum, lot) => sum + lot.stock_actual, 0)
      return (
        records.length <= 1 &&
        Number.isSafeInteger(records[0]?.stock ?? 0) &&
        (records[0]?.stock ?? 0) >= 0 &&
        Number.isSafeInteger(physical) &&
        physical === (records[0]?.stock ?? 0) &&
        physical === usable &&
        lots.every(
          (lot) =>
            Number.isSafeInteger(lot.stock_actual) &&
            lot.stock_actual >= 0 &&
            (lot.stock_actual === 0 ||
              (validExpiration(lot.fecha_vencimiento ?? "") &&
                Number.isFinite(Date.parse(lotReceivedAt(state, lot) ?? "")))),
        )
      )
    }
    let issue = ""
    if (!product) issue = "El producto no está disponible."
    else if (item.presentacion !== "unidad" && item.presentacion !== "paquete")
      issue = "Selecciona Unidad o Paquete."
    else if (
      item.presentacion === "paquete" &&
      (!size || !Number.isSafeInteger(size) || size <= 0)
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
      !reconciled(draft.origenId, origin) ||
      !reconciled(draft.destinoId, destination)
    )
      issue = "Las existencias y los lotes no están conciliados."
    else if (units > stock)
      issue = "Stock insuficiente: " + stock + " unidades físicas en el origen."
    else if (!Number.isSafeInteger(destinationStock + units))
      issue = "El stock del destino supera el límite permitido."
    if (issue) issues[item.productoId] = issue
    const lots: Pick<TransferLotChange, "loteOrigenId" | "unidades">[] = []
    if (!issue) {
      const candidates = available.filter(
        (lot) =>
          lot.productoId === item.productoId &&
          lot.almacenId === draft.origenId,
      )
      candidates.sort(
        (a, b) =>
          Number(a.fecha_vencimiento === null) -
            Number(b.fecha_vencimiento === null) ||
          (a.fecha_vencimiento ?? "").localeCompare(
            b.fecha_vencimiento ?? "",
          ) ||
          lotReceivedAt(state, a)!.localeCompare(lotReceivedAt(state, b)!) ||
          a.id - b.id,
      )
      let remaining = units
      for (const lot of candidates) {
        const moved = Math.min(remaining, lot.stock_actual)
        if (moved) lots.push({ loteOrigenId: lot.id, unidades: moved })
        remaining -= moved
        if (!remaining) break
      }
    }
    return {
      productoId: item.productoId,
      nombreProducto: product?.nombre ?? "Producto no disponible",
      presentacion: item.presentacion,
      cantidad: quantity,
      unidadesPorPaquete: size ?? 1,
      unidades: units,
      lotes: lots,
      stock,
      destinationStock,
    }
  })
  return { rows, issues, error, valid: !error && !Object.keys(issues).length }
}

/** Validate every row before updating either warehouse or its lot lineage. */
export function applyInventoryTransfer(
  state: PurchaseState,
  draft: InventoryTransferDraft,
  fecha = new Date().toISOString(),
): PurchaseState {
  const prepared = prepareInventoryTransfer(state, draft, fecha)
  if (!prepared.valid)
    throw new Error(prepared.error || Object.values(prepared.issues).join("\n"))
  const id = Math.max(
    state.nextTransferId ?? 1,
    ...(state.traspasos ?? []).map((item) => item.id + 1),
  )
  let lotId = Math.max(
    state.nextLotId ?? 1,
    ...state.lotes.map((lot) => lot.id + 1),
  )
  const count = prepared.rows.reduce((sum, row) => sum + row.lotes.length, 0)
  if (
    !Number.isSafeInteger(id) ||
    !Number.isSafeInteger(id + 1) ||
    !Number.isSafeInteger(lotId) ||
    !Number.isSafeInteger(lotId + count)
  )
    throw new Error("Se alcanzó el límite de identificadores del inventario.")
  const consumed = new Map<number, number>()
  const received: Lote[] = []
  const details: TransferDetail[] = prepared.rows.map(
    ({ stock: _stock, destinationStock: _destination, lotes, ...row }) => ({
      ...row,
      lotes: lotes.map((change) => {
        const source = state.lotes.find(
          (lot) => lot.id === change.loteOrigenId,
        )!
        const destinationId = lotId++
        consumed.set(source.id, change.unidades)
        received.push({
          ...source,
          id: destinationId,
          almacenId: draft.destinoId!,
          traspasoId: id,
          cantidad_inicial: change.unidades,
          stock_actual: change.unidades,
        })
        return { ...change, loteDestinoId: destinationId }
      }),
    }),
  )
  const quantities = new Map(
    details.map((row) => [row.productoId, row.unidades]),
  )
  const relations = [...state.existencias]
  for (const detail of details) {
    if (
      !relations.some(
        (stock) =>
          stock.productoId === detail.productoId &&
          stock.almacenId === draft.destinoId,
      )
    )
      relations.push({
        productoId: detail.productoId,
        almacenId: draft.destinoId!,
        stock: 0,
        stock_minimo: 10,
      })
  }
  return {
    ...state,
    lotes: [
      ...state.lotes.map((lot) =>
        consumed.has(lot.id)
          ? { ...lot, stock_actual: lot.stock_actual - consumed.get(lot.id)! }
          : lot,
      ),
      ...received,
    ],
    existencias: relations.map((stock) =>
      quantities.has(stock.productoId) &&
      (stock.almacenId === draft.origenId ||
        stock.almacenId === draft.destinoId)
        ? {
            ...stock,
            stock:
              stock.stock +
              quantities.get(stock.productoId)! *
                (stock.almacenId === draft.origenId ? -1 : 1),
          }
        : stock,
    ),
    traspasos: [
      ...(state.traspasos ?? []),
      {
        id,
        fecha,
        origenId: draft.origenId!,
        destinoId: draft.destinoId!,
        detalles: details,
      },
    ],
    nextTransferId: id + 1,
    nextLotId: lotId,
  }
}
