import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Icon from "../components/Icon"
import type { ProveedorDraft, PurchaseState } from "../data/purchases"
import SupplierModal from "../features/purchases/SupplierModal"
import SupplierToast from "../features/purchases/SupplierToast"
import {
  filterSuppliers,
  supplierBatchSize,
  visibleSuppliers,
} from "../features/purchases/supplierDetails"

export default function SupplierDetails({
  state,
  onBack,
  onSave,
}: {
  state: PurchaseState
  onBack: () => void
  onSave: (id: number, draft: ProveedorDraft) => void
}) {
  const [search, setSearch] = useState("")
  const [limit, setLimit] = useState(supplierBatchSize)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [notice, setNotice] = useState("")
  const heading = useRef<HTMLHeadingElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const scrollContainer = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const closeNotice = useCallback(() => setNotice(""), [])
  const result = useMemo(
    () => visibleSuppliers(state.proveedores, search, limit),
    [state.proveedores, search, limit],
  )
  const supplier = state.proveedores.find((item) => item.id === selectedId)
  const loadMore = useCallback(() => {
    setLimit(Math.min(limit + supplierBatchSize, result.total))
  }, [limit, result.total])

  useEffect(() => {
    heading.current?.focus()
  }, [])

  useEffect(() => {
    if (
      !result.hasMore ||
      !sentinel.current ||
      !scrollContainer.current ||
      typeof IntersectionObserver === "undefined"
    )
      return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore()
      },
      { root: scrollContainer.current },
    )
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [result.hasMore, loadMore, search])

  return (
    <div className="purchases-page supplier-details">
      <header className="details-header">
        <button
          type="button"
          className="purchase-button purchase-button-secondary"
          onClick={onBack}
        >
          <Icon name="arrow" className="size-4 rotate-180" /> Volver
        </button>
        <div className="min-w-0">
          <h2 ref={heading} tabIndex={-1} className="text-2xl font-bold">
            Detalle proveedores
          </h2>
          <p className="purchase-description">
            Consulta y actualiza los contactos de tus proveedores.
          </p>
        </div>
      </header>
      <section
        className="purchase-workspace details-workspace"
        aria-label="Directorio de proveedores"
      >
        <div className="supplier-toolbar">
          <label
            className="purchase-field supplier-search"
            htmlFor="supplier-search"
          >
            <span>Buscar por Nombre</span>
            <input
              ref={searchInput}
              id="supplier-search"
              type="search"
              autoComplete="off"
              placeholder="Escribe el nombre del proveedor"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setLimit(supplierBatchSize)
                scrollContainer.current?.scrollTo({
                  top: 0,
                  behavior: "instant",
                })
              }}
            />
          </label>
          <p className="supplier-result-count" role="status" aria-live="polite">
            {result.total} {result.total === 1 ? "proveedor" : "proveedores"}
          </p>
        </div>
        <p className="supplier-hint">
          Selecciona una tarjeta para editar sus datos de contacto.
        </p>
        <div
          ref={scrollContainer}
          className="supplier-scroll"
          role="region"
          aria-label="Lista de proveedores"
          tabIndex={0}
        >
          {result.total ? (
            <div className="supplier-grid">
              {result.rows.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="supplier-card"
                  aria-label={`Editar proveedor ${item.nombre}, teléfono ${item.telefono}`}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="supplier-avatar" aria-hidden="true">
                    <Icon name="user" className="size-7" />
                  </span>
                  <span className="supplier-card-data">
                    <span className="supplier-card-label">Nombre</span>
                    <span className="supplier-name">{item.nombre}</span>
                    <span className="supplier-card-label">Teléfono</span>
                    <span className="supplier-phone">{item.telefono}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="details-empty">
              No se encontraron proveedores con ese nombre.
            </p>
          )}
          {result.hasMore && (
            <div
              ref={sentinel}
              className="supplier-sentinel"
              aria-hidden="true"
            />
          )}
        </div>
        <footer className="supplier-footer">
          <span>
            Mostrando {result.rows.length} de {result.total}
          </span>
          {result.hasMore && (
            <button
              type="button"
              className="purchase-button purchase-button-secondary"
              onClick={loadMore}
            >
              Cargar más
            </button>
          )}
        </footer>
      </section>
      <SupplierToast message={notice} onClose={closeNotice} />
      {supplier && (
        <SupplierModal
          key={supplier.id}
          supplier={supplier}
          onClose={() => setSelectedId(null)}
          onSave={(draft) => {
            onSave(supplier.id, draft)
            setSelectedId(null)
            setNotice(`Proveedor actualizado: ${draft.nombre}.`)
            if (!filterSuppliers([{ ...supplier, ...draft }], search).length) {
              requestAnimationFrame(() => searchInput.current?.focus())
            }
          }}
        />
      )}
    </div>
  )
}
