import { products as initialProducts } from "./mockData.ts"
import { addCivilDays, bolivianDay } from "./dates.ts"
import type { AjusteInventario } from "./inventoryAdjustments.ts"
import type { TraspasoInventario } from "./inventoryTransfers.ts"
export interface Categoria {
  id: number
  nombre: string
}
export interface Proveedor {
  id: number
  nombre: string
  telefono: string
}
export type ProveedorDraft = Pick<Proveedor, "nombre" | "telefono">
export interface Paquete {
  id: number
  codigo_barra: string | null
  cantidad_unitaria: number | null
}
export interface Producto {
  id: number
  nombre: string
  codigo_barra: string
  codigo_paquete: string | null
  /** Importes de venta en centavos. */
  precio_unitario: number
  precio_paquete: number | null
  categoriaId: number
  paqueteId: number | null
}
export interface ProductoAlmacen {
  productoId: number
  almacenId: number
  stock: number
  stock_minimo: number
}
export interface Compra {
  id: number
  fecha: string
  /** Importe en centavos. */
  monto: number
  estado: "registrada" | "anulada"
  proveedorId: number | null
  cuentaId: number
}
export interface DetalleCompra {
  compraId: number
  /** Clave compuesta de ProductoAlmacen. */
  productoId: number
  almacenId: number
  cantidad: number
  presentacion: "unidad" | "paquete"
  /** Costo por paquete en centavos; independiente del precio de venta. */
  precio: number
  unidadesPorPaquete: number
}
export interface Lote {
  id: number
  nombre: string
  fecha_vencimiento: string | null
  cantidad_inicial: number
  stock_actual: number
  compraId: number | null
  ajusteId?: number
  traspasoId?: number
  productoId: number
  almacenId: number
}
export interface PurchaseState {
  traspasos: TraspasoInventario[]
  nextTransferId?: number
  ajustes: AjusteInventario[]
  nextAdjustmentId?: number
  nextPurchaseId?: number
  nextLotId?: number
  categorias: Categoria[]
  proveedores: Proveedor[]
  productos: Producto[]
  paquetes: Paquete[]
  existencias: ProductoAlmacen[]
  compras: Compra[]
  detalles: DetalleCompra[]
  lotes: Lote[]
}
export interface PurchaseItemDraft {
  categoriaId: string
  productoId: string
  cantidadPaquetes: string
  costoPaquete: string
  fechaVencimiento: string
}
export interface PurchaseDraft {
  almacenId: string
  proveedorId: string
  items: PurchaseItemDraft[]
}
/** Single-row fixtures and existing callers remain supported. */
export interface SinglePurchaseDraft extends PurchaseItemDraft {
  almacenId: string
  proveedorId: string
}
export type PurchaseInput = PurchaseDraft | SinglePurchaseDraft
export interface PreparedPurchase {
  detalles: Omit<DetalleCompra, "compraId">[]
  total: number
}
export interface ProductDraft {
  codigoBarra: string
  codigoPaquete?: string
  codigoPaqueteActivo?: boolean
  precioPaqueteActivo?: boolean
  categoriaId: string
  nombre: string
  cantidadUnitaria: string
  precioUnitario: string
  precioPaquete: string
}
export type NamedCatalog = "categorias"
export type ProductEditMode = "prices" | "names" | "categories" | "expiration"
export interface EditableProduct {
  nombre: string
  categoriaId: string
  precioUnitario: string
  precioPaquete: string
}
export interface ProductEditDraft {
  mode: ProductEditMode
  products: Record<number, EditableProduct>
  lots: Record<number, string>
  /** Fechas incompletas del control nativo; se conservan al cambiar de página. */
  invalidDates: number[]
}
export interface ProductEditIssue {
  id: number
  target: "product" | "lot"
  field: keyof EditableProduct | "expiration"
  message: string
}
export const cuenta = {
  id: 1,
  nombre: "Laura Méndez",
  correo: "laura@miabarrote.demo",
  fechaCreacion: "2026-01-15",
}
export interface Almacen {
  id: number
  nombre: string
}
export const almacenes: Almacen[] = [
  { id: 1, nombre: "Depósito Tienda" },
  { id: 2, nombre: "Almacén 1" },
  { id: 3, nombre: "Almacén 2" },
]
export interface PurchaseFeedback {
  intento: number
  compraId: number | null
  error: string
}
export function resolveProductCode(
  state: PurchaseState,
  value: string,
): Producto | undefined {
  const code = value.trim()
  if (!code) return undefined
  const direct = state.productos.find((item) => item.codigo_barra === code)
  if (direct) return direct
  const pack = state.paquetes.find((item) => item.codigo_barra === code)
  return pack
    ? state.productos.find((item) => item.paqueteId === pack.id)
    : undefined
}
function availableCode(state: PurchaseState, code: string): boolean {
  return (
    !state.productos.some((item) => item.codigo_barra === code) &&
    !state.paquetes.some((item) => item.codigo_barra === code)
  )
}
function nextId(records: readonly { id: number }[]): number {
  return (
    records.reduce((maximum, record) => Math.max(maximum, record.id), 0) + 1
  )
}
export function formatMoney(centavos: number): string {
  return `Bs ${new Intl.NumberFormat("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(centavos / 100)}`
}
export function parseCost(value: string): number | null {
  const normalized = value.trim().replace(",", ".")
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null
  const [whole, fraction = ""] = normalized.split(".")
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null
}
function positiveInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}
/** Validación de fecha civil, sin conversión de zona horaria. */
export function validExpiration(value: string): boolean {
  if (value === "") return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split("-").map(Number)
  if (year < 1 || month < 1 || month > 12) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day >= 1 && day <= days[month - 1]
}
export function prepareProduct(state: PurchaseState, draft: ProductDraft) {
  const categoriaId = positiveInteger(draft.categoriaId)
  const cantidadUnitaria = draft.cantidadUnitaria.trim()
    ? positiveInteger(draft.cantidadUnitaria.trim())
    : null
  const precio_unitario = parseCost(draft.precioUnitario)
  const precio_paquete = draft.precioPaqueteActivo
    ? parseCost(draft.precioPaquete)
    : null
  const codigo_barra = draft.codigoBarra?.trim() ?? ""
  const codigo_paquete = draft.codigoPaqueteActivo
    ? (draft.codigoPaquete?.trim() ?? "")
    : null
  const nombre = draft.nombre.trim()
  if (
    !nombre ||
    !codigo_barra ||
    !availableCode(state, codigo_barra) ||
    codigo_barra.length > 128 ||
    (codigo_paquete !== null &&
      (!codigo_paquete ||
        codigo_paquete.length > 128 ||
        !availableCode(state, codigo_paquete) ||
        codigo_paquete === codigo_barra)) ||
    nombre.length > 120 ||
    !state.categorias.some((item) => item.id === categoriaId) ||
    (draft.cantidadUnitaria.trim() !== "" && cantidadUnitaria === null) ||
    precio_unitario === null ||
    (draft.precioPaqueteActivo && precio_paquete === null)
  )
    return null
  return {
    categoriaId: categoriaId!,
    cantidadUnitaria,
    nombre,
    precio_unitario,
    precio_paquete,
    codigo_barra,
    codigo_paquete,
  }
}
export function appendProduct(
  state: PurchaseState,
  draft: ProductDraft,
): PurchaseState {
  const product = prepareProduct(state, draft)
  if (!product) throw new Error("Revisa los datos del producto.")
  const { cantidadUnitaria, ...attributes } = product
  const hasPackage =
    cantidadUnitaria !== null ||
    attributes.codigo_paquete !== null ||
    attributes.precio_paquete !== null
  const paquete = {
    id: nextId(state.paquetes),
    codigo_barra: attributes.codigo_paquete,
    cantidad_unitaria: cantidadUnitaria,
  }
  const record: Producto = {
    id: nextId(state.productos),
    ...attributes,
    paqueteId: hasPackage ? paquete.id : null,
  }
  return {
    ...state,
    productos: [...state.productos, record],
    paquetes: hasPackage ? [...state.paquetes, paquete] : state.paquetes,
    existencias: [
      ...state.existencias,
      ...almacenes.map((almacen) => ({
        productoId: record.id,
        almacenId: almacen.id,
        stock: 0,
        stock_minimo: 10,
      })),
    ],
  }
}
export function appendCatalogName(
  state: PurchaseState,
  catalog: NamedCatalog,
  value: string,
): PurchaseState {
  const nombre = value.trim()
  if (!nombre || nombre.length > 120)
    throw new Error("Ingresa un nombre de hasta 120 caracteres.")
  return {
    ...state,
    [catalog]: [...state[catalog], { id: nextId(state[catalog]), nombre }],
  }
}
export function prepareSupplier(draft: ProveedorDraft): ProveedorDraft | null {
  const nombre = draft.nombre.trim()
  const telefono = draft.telefono.trim()
  return nombre && nombre.length <= 120 && telefono
    ? { nombre, telefono }
    : null
}
export function appendSupplier(
  state: PurchaseState,
  draft: ProveedorDraft,
): PurchaseState {
  const data = prepareSupplier(draft)
  if (!data) throw new Error("Ingresa el nombre y teléfono del proveedor.")
  return {
    ...state,
    proveedores: [
      ...state.proveedores,
      { id: nextId(state.proveedores), ...data },
    ],
  }
}
export function actualizarProveedor(
  state: PurchaseState,
  id: number,
  draft: ProveedorDraft,
): PurchaseState {
  const data = prepareSupplier(draft)
  if (!data) throw new Error("Ingresa el nombre y teléfono del proveedor.")
  if (!state.proveedores.some((item) => item.id === id))
    throw new Error("El proveedor no existe.")
  return {
    ...state,
    proveedores: state.proveedores.map((item) =>
      item.id === id ? { ...item, ...data } : item,
    ),
  }
}
export function preparePurchase(
  state: PurchaseState,
  draft: SinglePurchaseDraft,
): Omit<DetalleCompra, "compraId"> | null {
  const product = state.productos.find(
    (item) =>
      item.id === positiveInteger(draft.productoId) &&
      (!draft.categoriaId ||
        item.categoriaId === positiveInteger(draft.categoriaId)),
  )
  const pack = state.paquetes.find((item) => item.id === product?.paqueteId)
  const packageSize =
    product?.paqueteId === null
      ? 1
      : pack
        ? (pack.cantidad_unitaria ?? 1)
        : undefined
  const almacenId = positiveInteger(draft.almacenId)
  const stock = state.existencias.find(
    (item) => item.productoId === product?.id && item.almacenId === almacenId,
  )
  const price = parseCost(draft.costoPaquete)
  const quantity = positiveInteger(draft.cantidadPaquetes)
  if (
    !state.proveedores.some(
      (item) => item.id === positiveInteger(draft.proveedorId),
    ) ||
    !product ||
    !Number.isSafeInteger(packageSize) ||
    !packageSize ||
    packageSize < 1 ||
    !almacenes.some((item) => item.id === almacenId) ||
    price === null ||
    quantity === null ||
    !Number.isSafeInteger(quantity * price) ||
    !Number.isSafeInteger(quantity * packageSize) ||
    !Number.isSafeInteger((stock?.stock ?? 0) + quantity * packageSize) ||
    !validExpiration(draft.fechaVencimiento)
  )
    return null
  return {
    productoId: product.id,
    almacenId: almacenId!,
    cantidad: quantity,
    presentacion: pack?.cantidad_unitaria != null ? "paquete" : "unidad",
    precio: price,
    unidadesPorPaquete: packageSize,
  }
}
/** Validate the complete transaction before generating any ledger or stock changes. */
export function preparePurchaseBatch(
  state: PurchaseState,
  draft: PurchaseDraft,
): PreparedPurchase | null {
  if (!draft.items.length) return null
  const products = new Set<number>()
  const detalles: PreparedPurchase["detalles"] = []
  let total = 0
  for (const item of draft.items) {
    const detail = preparePurchase(state, {
      ...item,
      almacenId: draft.almacenId,
      proveedorId: draft.proveedorId,
    })
    if (!detail || products.has(detail.productoId)) return null
    products.add(detail.productoId)
    total += detail.cantidad * detail.precio
    if (!Number.isSafeInteger(total)) return null
    detalles.push(detail)
  }
  return { detalles, total }
}
export function purchaseItemSubtotal(item: PurchaseItemDraft): number | null {
  const quantity = positiveInteger(item.cantidadPaquetes)
  const cost = parseCost(item.costoPaquete)
  if (
    quantity === null ||
    cost === null ||
    !Number.isSafeInteger(quantity * cost)
  )
    return null
  return quantity * cost
}
export function appendPurchase(
  state: PurchaseState,
  input: PurchaseInput,
  fecha = new Date().toISOString(),
): PurchaseState {
  const draft: PurchaseDraft =
    "items" in input
      ? input
      : {
          almacenId: input.almacenId,
          proveedorId: input.proveedorId,
          items: [input],
        }
  const prepared = preparePurchaseBatch(state, draft)
  if (!prepared)
    throw new Error(
      "Revisa el destino, proveedor y los datos de todos los productos.",
    )
  const id = Math.max(
    state.nextPurchaseId ?? 1001,
    state.compras.reduce((maximum, item) => Math.max(maximum, item.id), 1000) +
      1,
  )
  const purchase: Compra = {
    id,
    fecha,
    proveedorId: positiveInteger(draft.proveedorId),
    cuentaId: cuenta.id,
    monto: prepared.total,
    estado: "registrada",
  }
  const firstLotId = Math.max(state.nextLotId ?? 1, nextId(state.lotes))
  const detailsByProduct = new Map(
    prepared.detalles.map((detail) => [detail.productoId, detail]),
  )
  const existencias = [...state.existencias]
  for (const detail of prepared.detalles) {
    if (
      !existencias.some(
        (item) =>
          item.productoId === detail.productoId &&
          item.almacenId === detail.almacenId,
      )
    )
      existencias.push({
        productoId: detail.productoId,
        almacenId: detail.almacenId,
        stock: 0,
        stock_minimo: 10,
      })
  }
  return {
    ...state,
    compras: [purchase, ...state.compras],
    nextPurchaseId: id + 1,
    nextLotId: firstLotId + prepared.detalles.length,
    detalles: [
      ...prepared.detalles.map((detail) => ({ compraId: id, ...detail })),
      ...state.detalles,
    ],
    lotes: [
      ...prepared.detalles.map((detail, index) => ({
        id: firstLotId + index,
        nombre: "LOTE-" + id + "-" + detail.productoId,
        fecha_vencimiento: draft.items[index].fechaVencimiento || null,
        cantidad_inicial: detail.cantidad * detail.unidadesPorPaquete,
        stock_actual: detail.cantidad * detail.unidadesPorPaquete,
        compraId: id,
        productoId: detail.productoId,
        almacenId: detail.almacenId,
      })),
      ...state.lotes,
    ],
    existencias: existencias.map((item) => {
      const detail = detailsByProduct.get(item.productoId)
      return detail && item.almacenId === detail.almacenId
        ? {
            ...item,
            stock: item.stock + detail.cantidad * detail.unidadesPorPaquete,
          }
        : item
    }),
  }
}
export function createPurchaseState(
  referenceDay = bolivianDay(),
): PurchaseState {
  if (!referenceDay || !validExpiration(referenceDay))
    throw new Error("Fecha de referencia inválida.")
  const categorias: Categoria[] = [
    "Abarrotes",
    "Granos",
    "Lácteos",
    "Enlatados",
  ].map((nombre, index) => ({ id: index + 1, nombre }))
  const paquetes: Paquete[] = [12, 24, 12, 24, 6, 24].map(
    (cantidad_unitaria, index) => ({
      id: index + 1,
      codigo_barra: `PACK-${String(index + 1).padStart(6, "0")}`,
      cantidad_unitaria,
    }),
  )
  const packageIds = [1, 2, 3, 4, 5, 6]
  const productos: Producto[] = initialProducts.map((product, index) => {
    const packageSize = paquetes.find((item) => item.id === packageIds[index])!
      .cantidad_unitaria!
    const unitPrice = Math.round(product.price * 100)
    return {
      id: index + 1,
      nombre: product.name,
      categoriaId: categorias.find((item) => item.nombre === product.category)!
        .id,
      paqueteId: packageIds[index],
      codigo_barra: demoCode(index + 1),
      codigo_paquete: paquetes.find((item) => item.id === packageIds[index])!
        .codigo_barra,
      precio_unitario: unitPrice,
      precio_paquete: unitPrice * packageSize,
    }
  })
  const state: PurchaseState = {
    traspasos: [],
    nextTransferId: 1,
    ajustes: [],
    nextAdjustmentId: 1,
    categorias,
    paquetes,
    productos,
    proveedores: [
      ["Distribuidora Valle Verde", "+591 7012 3401"],
      ["Granos del Altiplano", "(2) 245-8102"],
      ["Lácteos La Pradera", "+591 7123 4503"],
      ["Comercial El Canasto", "7654-3204"],
      ["Abarrotes Illimani", "+591 7301 2405"],
      ["Bebidas del Valle", "(3) 342-1606"],
      ["Molinos San Miguel", "7205 6707"],
      ["Alimentos Andinos", "+591 7406 7808"],
      ["Distribuidora El Trigal", "(4) 425-1909"],
      ["Conservas La Huerta", "7507-8910"],
      ["Limpieza Buen Hogar", "+591 7608 9011"],
      ["Aceites Los Olivos", "(2) 248-2312"],
      ["Café Yungas Dorado", "7709 1213"],
      ["Panificadora Aurora", "+591 7810 2314"],
      ["Embutidos La Cumbre", "(3) 345-6715"],
      ["Dulces Copacabana", "7911-3416"],
      ["Comercial Río Grande", "+591 7013 4517"],
      ["Distribuidora Santa Rosa", "(4) 428-9018"],
      ["Productos Tierra Fértil", "7114 5619"],
      ["Mayorista Los Andes", "+591 7215 6720"],
    ].map(([nombre, telefono], index) => ({ id: index + 1, nombre, telefono })),
    existencias: almacenes.flatMap((almacen) =>
      initialProducts.map((product, index) => ({
        productoId: productos[index].id,
        almacenId: almacen.id,
        stock: 0,
        stock_minimo: almacen.id === 1 ? [40, 48, 24, 24, 40, 48][index] : 10,
      })),
    ),
    compras: [],
    detalles: [],
    lotes: [],
  }
  return Array.from({ length: 24 }, (_, index) => index).reduce(
    (previous, index) => {
      const product = productos[index % productos.length]
      return appendPurchase(
        previous,
        {
          almacenId: "1",
          proveedorId: String((index % 4) + 1),
          categoriaId: String(product.categoriaId),
          productoId: String(product.id),
          cantidadPaquetes: String((index % 3) + 1),
          costoPaquete: String(180 + index * 7) + (index % 2 ? ",50" : ""),
          fechaVencimiento:
            index % 5 === 0
              ? ""
              : addCivilDays(
                  referenceDay,
                  [3, 14, 45, 90][Math.floor(index / 6)] + (index % 6),
                ),
        },
        `2026-${
          index < 16 ? "09" : "10"
        }-${String(index < 16 ? index + 15 : index - 15).padStart(2, "0")}T14:30:00.000Z`,
      )
    },
    state,
  )
}
export function inventoryProducts(
  state: PurchaseState,
  almacenId = almacenes[0].id,
) {
  return state.productos.map((product) => {
    const existence = state.existencias.find(
      (item) => item.productoId === product.id && item.almacenId === almacenId,
    )
    const stock = existence?.stock ?? 0
    const minimum = existence?.stock_minimo ?? 10
    const packageSize =
      state.paquetes.find((item) => item.id === product.paqueteId)
        ?.cantidad_unitaria ?? 1
    const lowStock = stock <= minimum
    const expiration =
      state.lotes
        .filter(
          (lote) =>
            lote.productoId === product.id &&
            lote.almacenId === almacenId &&
            lote.stock_actual > 0 &&
            lotReceivedAt(state, lote) !== null,
        )
        .map((lote) => lote.fecha_vencimiento)
        .filter((date): date is string => date !== null)
        .sort()[0] ?? null
    const status =
      stock === 0 ? "Sin existencias" : lowStock ? "Stock bajo" : "Disponible"
    return {
      id: product.id,
      almacenId,
      code: product.codigo_barra,
      categoryId: product.categoriaId,
      name: product.nombre,
      category:
        state.categorias.find((item) => item.id === product.categoriaId)
          ?.nombre ?? "",
      stock,
      minimum,
      lowStock,
      units: packageSize > 1 ? stock % packageSize : stock,
      packages: packageSize > 1 ? Math.floor(stock / packageSize) : 0,
      packageSize,
      price: product.precio_unitario / 100,
      status,
      expiration,
    }
  })
}
/** Remove a purchase and its remaining stock; previously sold units stay sold. */
export function deletePurchase(
  state: PurchaseState,
  id: number,
): PurchaseState {
  if (!state.compras.some((compra) => compra.id === id)) return state
  const lotes = state.lotes.filter((lot) => lot.compraId !== id)
  return {
    ...state,
    compras: state.compras.filter((compra) => compra.id !== id),
    detalles: state.detalles.filter((detail) => detail.compraId !== id),
    lotes,
    existencias: state.existencias.map((stock) => ({
      ...stock,
      stock: lotes
        .filter(
          (lot) =>
            lot.productoId === stock.productoId &&
            lot.almacenId === stock.almacenId,
        )
        .reduce((sum, lot) => sum + lot.stock_actual, 0),
    })),
  }
}
/** Extra multi-product receipts for the application's history; base fixtures stay reproducible. */
export function createPurchaseHistory(
  state: PurchaseState,
  referenceDay = bolivianDay(),
): PurchaseState {
  return [2, 3, 4].reduce(
    (previous, count, index) =>
      appendPurchase(
        previous,
        {
          almacenId: "1",
          proveedorId: String(index + 5),
          items: Array.from({ length: count }, (_, offset) => {
            const product =
              state.productos[(index + offset) % state.productos.length]
            return {
              productoId: String(product.id),
              categoriaId: String(product.categoriaId),
              cantidadPaquetes: String(offset + 1),
              costoPaquete: String(65 + index * 12 + offset * 9) + ".50",
              fechaVencimiento:
                offset === 0
                  ? ""
                  : addCivilDays(referenceDay, 30 + offset * 12),
            }
          }),
        },
        "2026-10-" + String(9 + index).padStart(2, "0") + "T14:30:00.000Z",
      ),
    state,
  )
}
export function setStockMinimum(
  state: PurchaseState,
  productoId: number,
  almacenId: number,
  minimum: number,
): PurchaseState {
  if (!Number.isSafeInteger(minimum) || minimum < 0)
    throw new Error("Ingresa un número entero mayor o igual a cero.")
  const existence = state.existencias.find(
    (item) => item.productoId === productoId && item.almacenId === almacenId,
  )
  if (
    !existence ||
    !state.productos.some((item) => item.id === productoId) ||
    !almacenes.some((item) => item.id === almacenId)
  )
    throw new Error("El producto ya no está disponible en este almacén.")
  if (existence.stock_minimo === minimum) return state
  return {
    ...state,
    existencias: state.existencias.map((item) =>
      item === existence ? { ...item, stock_minimo: minimum } : item,
    ),
  }
}
function demoCode(id: number): string {
  return `DEMO-${String(id).padStart(6, "0")}`
}
/** Retiene el historial y retira solo las unidades disponibles de esta compra. */
export function annulPurchase(state: PurchaseState, id: number): PurchaseState {
  const compra = state.compras.find((item) => item.id === id)
  if (!compra || compra.estado === "anulada") return state
  const lotes = state.lotes.map((item) =>
    item.compraId === id ? { ...item, stock_actual: 0 } : item,
  )
  return {
    ...state,
    compras: state.compras.map((item) =>
      item.id === id ? { ...item, estado: "anulada" } : item,
    ),
    lotes,
    existencias: state.existencias.map((item) => ({
      ...item,
      stock: lotes
        .filter(
          (lote) =>
            lote.productoId === item.productoId &&
            lote.almacenId === item.almacenId,
        )
        .reduce((sum, lote) => sum + lote.stock_actual, 0),
    })),
  }
}

/** Lotes consultables: compra vigente, stock disponible y nexo de almacén válido. */
export function lotReceivedAt(state: PurchaseState, lot: Lote): string | null {
  if (lot.traspasoId !== undefined) {
    if (
      lot.compraId !== null &&
      !state.compras.some(
        (purchase) =>
          purchase.id === lot.compraId && purchase.estado === "registrada",
      )
    )
      return null
    const transfer = (state.traspasos ?? []).find(
      (item) =>
        item.id === lot.traspasoId &&
        item.destinoId === lot.almacenId &&
        item.detalles.some(
          (detail) =>
            detail.productoId === lot.productoId &&
            detail.lotes.some((change) => change.loteDestinoId === lot.id),
        ),
    )
    return transfer && Number.isFinite(Date.parse(transfer.fecha))
      ? transfer.fecha
      : null
  }
  if (lot.compraId !== null)
    return (
      state.compras.find(
        (item) => item.id === lot.compraId && item.estado === "registrada",
      )?.fecha ?? null
    )
  return (
    (state.ajustes ?? []).find(
      (item) =>
        item.id === lot.ajusteId &&
        item.tipo === "entrada" &&
        item.almacenId === lot.almacenId &&
        item.detalles.some(
          (detail) =>
            detail.productoId === lot.productoId &&
            detail.lotes.some((change) => change.loteId === lot.id),
        ),
    )?.fecha ?? null
  )
}
export function availableProductLots(state: PurchaseState): Lote[] {
  const registered = new Set(
    state.compras
      .filter((item) => item.estado === "registrada")
      .map((item) => item.id),
  )
  const products = new Set(state.productos.map((item) => item.id))
  const stocks = new Set(
    state.existencias.map((item) => `${item.productoId}:${item.almacenId}`),
  )
  return state.lotes.filter(
    (item) =>
      item.stock_actual > 0 &&
      (item.traspasoId === undefined || lotReceivedAt(state, item) !== null) &&
      (item.compraId === null
        ? lotReceivedAt(state, item) !== null
        : registered.has(item.compraId)) &&
      products.has(item.productoId) &&
      stocks.has(`${item.productoId}:${item.almacenId}`),
  )
}

export function changedProductEditIds(
  state: PurchaseState,
  draft: ProductEditDraft,
) {
  const products = Object.entries(draft.products).flatMap(([key, value]) => {
    const id = Number(key)
    const original = state.productos.find((item) => item.id === id)
    if (!original) return [id]
    const changed =
      draft.mode === "prices"
        ? parseCost(value.precioUnitario) !== original.precio_unitario ||
          (original.precio_paquete !== null &&
            parseCost(value.precioPaquete) !== original.precio_paquete)
        : draft.mode === "names"
          ? value.nombre.trim() !== original.nombre
          : draft.mode === "categories"
            ? Number(value.categoriaId) !== original.categoriaId
            : false
    return changed ? [id] : []
  })
  const lots =
    draft.mode !== "expiration"
      ? []
      : Object.entries(draft.lots).flatMap(([key, value]) => {
          const id = Number(key)
          const original = state.lotes.find((item) => item.id === id)
          return !original ||
            draft.invalidDates.includes(id) ||
            (value || null) !== original.fecha_vencimiento
            ? [id]
            : []
        })
  return { products, lots, count: products.length + lots.length }
}

export function validateProductEdits(
  state: PurchaseState,
  draft: ProductEditDraft,
): ProductEditIssue[] {
  const changed = changedProductEditIds(state, draft)
  const available = availableProductLots(state)
  const products = new Set(available.map((item) => item.productoId))
  const lots = new Set(available.map((item) => item.id))
  const issues: ProductEditIssue[] = []
  for (const id of changed.products) {
    const value = draft.products[id]
    const product = state.productos.find((item) => item.id === id)
    const prefix = product?.codigo_barra ?? `Producto ${id}`
    const add = (field: keyof EditableProduct, message: string) =>
      issues.push({
        id,
        target: "product",
        field,
        message: `${prefix}: ${message}`,
      })
    if (!products.has(id)) {
      add("nombre", "el producto ya no tiene lotes disponibles.")
      continue
    }
    if (draft.mode === "prices") {
      if (parseCost(value.precioUnitario) === null)
        add(
          "precioUnitario",
          "el precio unitario debe ser positivo, con hasta dos decimales.",
        )
      if (
        product?.precio_paquete !== null &&
        parseCost(value.precioPaquete) === null
      )
        add(
          "precioPaquete",
          "el precio por paquete debe ser positivo, con hasta dos decimales.",
        )
    } else if (draft.mode === "names") {
      if (!value.nombre.trim() || value.nombre.trim().length > 120)
        add("nombre", "ingresa un nombre de hasta 120 caracteres.")
    } else if (draft.mode === "categories") {
      if (
        !state.categorias.some((item) => item.id === Number(value.categoriaId))
      )
        add("categoriaId", "selecciona una categoría existente.")
    }
  }
  for (const id of changed.lots) {
    const lot = state.lotes.find((item) => item.id === id)
    if (
      !lots.has(id) ||
      draft.invalidDates.includes(id) ||
      !validExpiration(draft.lots[id])
    )
      issues.push({
        id,
        target: "lot",
        field: "expiration",
        message: `${lot?.nombre ?? `Lote ${id}`}: ${
          lots.has(id)
            ? "ingresa una fecha válida o déjala vacía."
            : "el lote ya no está disponible."
        }`,
      })
  }
  return issues
}

/** Aplica un modo completo: valida antes de modificar cualquier entidad. */
export function applyProductEdits(
  state: PurchaseState,
  draft: ProductEditDraft,
): PurchaseState {
  const issues = validateProductEdits(state, draft)
  if (issues.length)
    throw new Error(issues.map((item) => item.message).join("\n"))
  const changed = changedProductEditIds(state, draft)
  if (!changed.count) return state
  const products = new Set(changed.products)
  const lots = new Set(changed.lots)
  return {
    ...state,
    productos: changed.products.length
      ? state.productos.map((item) => {
          if (!products.has(item.id)) return item
          const value = draft.products[item.id]
          if (draft.mode === "prices")
            return {
              ...item,
              precio_unitario: parseCost(value.precioUnitario)!,
              precio_paquete:
                item.precio_paquete === null
                  ? null
                  : parseCost(value.precioPaquete)!,
            }
          if (draft.mode === "names")
            return { ...item, nombre: value.nombre.trim() }
          return { ...item, categoriaId: Number(value.categoriaId) }
        })
      : state.productos,
    lotes: changed.lots.length
      ? state.lotes.map((item) =>
          lots.has(item.id)
            ? { ...item, fecha_vencimiento: draft.lots[item.id] || null }
            : item,
        )
      : state.lotes,
  }
}
