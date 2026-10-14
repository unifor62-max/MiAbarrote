import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Icon from "../components/Icon"
import {
  almacenes,
  inventoryProducts,
  type PurchaseState,
} from "../data/purchases"
import {
  filterInventory,
  inventoryCategories,
} from "../features/inventory/inventory"
import MinimumModal from "../features/inventory/MinimumModal"
import AdjustmentModal from "../features/inventory/AdjustmentModal"
import TransferModal from "../features/inventory/TransferModal"
import type {
  InventoryTransferDraft,
  TransferFeedback,
} from "../data/inventoryTransfers"
import SupplierToast from "../features/purchases/SupplierToast"
import type {
  AdjustmentFeedback,
  InventoryAdjustmentDraft,
} from "../data/inventoryAdjustments"

export default function Inventory({
  state,
  onMinimumChange,
  feedback,
  onAdjustment,
  transferFeedback,
  onTransfer,
}: {
  state: PurchaseState
  feedback: AdjustmentFeedback
  onAdjustment: (draft: InventoryAdjustmentDraft) => void
  transferFeedback: TransferFeedback
  onTransfer: (draft: InventoryTransferDraft) => void
  onMinimumChange: (
    productoId: number,
    almacenId: number,
    minimum: number,
  ) => void
}) {
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [locations, setLocations] = useState(true)
  const [adjusting, setAdjusting] = useState(false)
  const [transferring, setTransferring] = useState(false)
  const [adjustmentNotice, setAdjustmentNotice] = useState("")
  const clearAdjustmentNotice = useCallback(() => setAdjustmentNotice(""), [])
  const [almacenId, setAlmacenId] = useState(1)
  const [query, setQuery] = useState("")
  const [lowStockOnly, setLowStockOnly] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [notice, setNotice] = useState("")
  const heading = useRef<HTMLHeadingElement>(null)
  const products = useMemo(
    () => inventoryProducts(state, almacenId),
    [state, almacenId],
  )
  const categories = useMemo(() => inventoryCategories(state), [state])
  const locationName =
    almacenId === 1
      ? "Tienda"
      : almacenes.find((item) => item.id === almacenId)?.nombre
  const filtered = filterInventory(products, categoryId, query, lowStockOnly)
  const editingProduct = products.find((item) => item.id === editingId)
  useEffect(() => {
    if (!locations) heading.current?.focus()
  }, [locations])

  function back() {
    setLocations(true)
    setCategoryId(null)
    setQuery("")
    setLowStockOnly(false)
    setNotice("")
    setEditingId(null)
    requestAnimationFrame(() =>
      document.getElementById(`inventory-location-${almacenId}`)?.focus(),
    )
  }

  return (
    <div className="inventory-page">
      {locations && (
        <>
          <header className="inventory-heading">
            <div>
              <span className="purchase-eyebrow">MiAbarrote · Villa Verde</span>
              <h2 ref={heading} tabIndex={-1}>
                Inventario
              </h2>
              <p className="purchase-description">
                Elige una ubicación, traspasa productos o ajusta existencias.
              </p>
            </div>
            <span className="inventory-total">
              <Icon name="box" className="size-4" />
              {products.length} productos · {categories.length} categorías
            </span>
          </header>
          <div className="inventory-actions">
            <button
              type="button"
              id="inventory-transfer-trigger"
              className="purchase-button inventory-transfer-trigger"
              onClick={() => {
                setAdjustmentNotice("")
                setTransferring(true)
              }}
            >
              Traspaso
            </button>
            <button
              type="button"
              id="inventory-adjust-trigger"
              className="purchase-button purchase-button-primary"
              onClick={() => {
                setAdjustmentNotice("")
                setAdjusting(true)
              }}
            >
              Ajuste
            </button>
          </div>
        </>
      )}

      {locations ? (
        <section
          className="purchase-workspace"
          aria-label="Ubicaciones de inventario"
        >
          <div className="inventory-location-grid">
            {almacenes.map((item, index) => {
              const local = inventoryProducts(state, item.id)
              return (
                <button
                  type="button"
                  key={item.id}
                  id={"inventory-location-" + item.id}
                  className={
                    "inventory-location-card inventory-location-tone-" + index
                  }
                  onClick={() => {
                    setAlmacenId(item.id)
                    setCategoryId(null)
                    setQuery("")
                    setLowStockOnly(false)
                    setLocations(false)
                    setNotice("")
                  }}
                >
                  <span className="inventory-location-icon">
                    <Icon name="box" className="size-6" />
                  </span>
                  <strong>{item.id === 1 ? "Tienda" : item.nombre}</strong>
                  <span>
                    {local
                      .reduce((sum, product) => sum + product.stock, 0)
                      .toLocaleString("es-BO")}{" "}
                    unidades físicas
                  </span>
                  <span>
                    {local.filter((product) => product.stock > 0).length}{" "}
                    productos con existencias
                  </span>
                  <span className="inventory-location-link">
                    Ver existencias <Icon name="arrow" className="size-4" />
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      ) : (
        <section
          className="purchase-workspace inventory-workspace"
          aria-label={`Existencias de ${locationName}`}
        >
          <div className="inventory-toolbar">
            <h2
              ref={heading}
              tabIndex={-1}
              className="inventory-location-badge"
            >
              <Icon name="box" className="size-4" />
              <span>
                Ubicación: <strong>{locationName}</strong>
              </span>
            </h2>
            <button
              type="button"
              className="purchase-button purchase-button-secondary"
              onClick={back}
            >
              <span aria-hidden="true">←</span> Volver
            </button>
            <label className="inventory-category-filter">
              <span className="sr-only">Categoría</span>
              <select
                value={categoryId ?? ""}
                onChange={(event) =>
                  setCategoryId(
                    event.target.value === ""
                      ? null
                      : Number(event.target.value),
                  )
                }
              >
                <option value="">Todas las categorías</option>
                {categories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.nombre}
                  </option>
                ))}
              </select>
            </label>
            <button
              id="inventory-low-stock-toggle"
              type="button"
              aria-pressed={lowStockOnly}
              className={`purchase-button inventory-toggle ${
                lowStockOnly
                  ? "inventory-toggle-active"
                  : "purchase-button-secondary"
              }`}
              onClick={() => setLowStockOnly(!lowStockOnly)}
            >
              <Icon name="warning" className="size-4" /> Mostrar stock bajo
            </button>
            <label className="inventory-search">
              <span className="sr-only">
                Buscar productos por código o nombre
              </span>
              <Icon name="search" className="size-4" />
              <input
                type="search"
                placeholder="Buscar productos"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          <p
            className="inventory-result-count"
            role="status"
            aria-live="polite"
          >
            {filtered.length} de {products.length}{" "}
            {products.length === 1 ? "producto" : "productos"} · Unidades
            sueltas y paquetes cerrados · Mínimos en unidades totales
          </p>
          {notice && (
            <p className="inventory-notice" role="status">
              {notice}
            </p>
          )}
          <div className="inventory-table-wrap">
            <table className="stock-table">
              <caption className="sr-only">
                Existencias y stock mínimo de {locationName}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Código</th>
                  <th scope="col">Nombre</th>
                  <th scope="col">Unidades</th>
                  <th scope="col">Paquetes</th>
                  <th scope="col">Cant. mínima</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((product) => (
                  <tr
                    key={product.id}
                    className={product.lowStock ? "stock-row-alert" : ""}
                  >
                    <td data-label="Código">
                      <span className="stock-code">{product.code}</span>
                    </td>
                    <td data-label="Nombre">
                      <strong>{product.name}</strong>
                      <span className="stock-cell-hint">
                        {product.category}
                      </span>
                      {product.lowStock && (
                        <span className="stock-alert-badge">
                          <Icon name="warning" className="size-3" />
                          {product.stock === 0
                            ? "Sin existencias"
                            : "Stock bajo"}
                        </span>
                      )}
                    </td>
                    <td data-label="Unidades">
                      <strong className="stock-number">
                        {product.units.toLocaleString("es-BO")}
                      </strong>
                      <span
                        className={
                          product.lowStock
                            ? "stock-total-alert"
                            : "stock-cell-hint"
                        }
                      >
                        Total: {product.stock.toLocaleString("es-BO")} u.
                      </span>
                    </td>
                    <td data-label="Paquetes">
                      <strong className="stock-number">
                        {product.packages.toLocaleString("es-BO")}
                      </strong>
                      <span className="stock-cell-hint">
                        {product.packageSize > 1
                          ? `${product.packageSize} u. por paquete`
                          : "Venta por unidad"}
                      </span>
                    </td>
                    <td data-label="Cant. mínima">
                      <strong className="stock-number">
                        {product.minimum.toLocaleString("es-BO")}
                      </strong>
                      <button
                        type="button"
                        className="stock-edit-button"
                        aria-label={`Editar mínimo de ${product.name}`}
                        onClick={() => {
                          setEditingId(product.id)
                          setNotice("")
                        }}
                      >
                        <Icon name="edit" className="size-3" /> Editar mín.
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && (
              <p className="details-empty">
                {products.length === 0
                  ? "Todavía no hay productos registrados."
                  : "No hay productos que coincidan con los filtros."}
              </p>
            )}
          </div>
        </section>
      )}
      {editingProduct && (
        <MinimumModal
          product={editingProduct}
          onClose={() => setEditingId(null)}
          onSave={(productoId, almacenId, minimum) => {
            onMinimumChange(productoId, almacenId, minimum)
            setNotice(
              `Mínimo de ${editingProduct.name} actualizado a ${minimum} unidades.`,
            )
          }}
        />
      )}
      <SupplierToast
        message={adjustmentNotice}
        onClose={clearAdjustmentNotice}
      />
      {adjusting && (
        <AdjustmentModal
          state={state}
          origin={almacenId}
          feedback={feedback}
          onClose={() => setAdjusting(false)}
          onSave={onAdjustment}
          onSuccess={(origin, adjustmentId) => {
            setAlmacenId(origin)
            setAdjusting(false)
            setAdjustmentNotice(
              "Ajuste A-" +
                adjustmentId +
                " registrado correctamente en " +
                almacenes.find((item) => item.id === origin)?.nombre +
                ".",
            )
          }}
        />
      )}
      {transferring && (
        <TransferModal
          state={state}
          feedback={transferFeedback}
          onSave={onTransfer}
          onClose={() => setTransferring(false)}
          onSuccess={(draft) => {
            setTransferring(false)
            const name = (id: number | null) =>
              id === 1
                ? "Tienda"
                : almacenes.find((item) => item.id === id)?.nombre
            setAdjustmentNotice(
              `Traspaso de ${draft.items.length} ${
                draft.items.length === 1
                  ? "producto realizado"
                  : "productos realizado"
              } con éxito de ${name(draft.origenId)} a ${name(draft.destinoId)}.`,
            )
          }}
        />
      )}
    </div>
  )
}
