import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import Icon from "../components/Icon"
import {
  changedProductEditIds,
  formatMoney,
  validateProductEdits,
  type EditableProduct,
  type ProductEditDraft,
  type ProductEditIssue,
  type ProductEditMode,
  type PurchaseState,
} from "../data/purchases"
import DiscardEditsModal from "../features/purchases/DiscardEditsModal"
import {
  createProductEditDraft,
  filterProductRows,
  productRows,
  productRowsForMode,
  updateProductEditDraft,
  type ProductRow,
} from "../features/purchases/productDetails"
import { displayDay, paginateRows } from "../features/purchases/purchaseDetails"

const editActions: {
  mode: ProductEditMode
  label: string
}[] = [
  { mode: "prices", label: "Editar Precios" },
  { mode: "names", label: "Editar Nombres" },
  { mode: "categories", label: "Editar Categorias" },
  { mode: "expiration", label: "Editar Fecha Vencimiento" },
]
const allColumns = [
  { key: "codigo", label: "Código" },
  { key: "nombre", label: "Nombre" },
  { key: "precioUnitario", label: "Precio Unitario" },
  { key: "precioPaquete", label: "Precio x paquete" },
  { key: "categoriaId", label: "Categoría" },
  { key: "lote", label: "Lote" },
  { key: "expiration", label: "Fecha Vencimiento" },
] as const
type ColumnKey = typeof allColumns[number]["key"]
const visibleColumns: Record<ProductEditMode, readonly ColumnKey[]> = {
  prices: ["codigo", "nombre", "precioUnitario", "precioPaquete"],
  names: ["codigo", "nombre"],
  categories: ["codigo", "nombre", "categoriaId"],
  expiration: ["codigo", "nombre", "lote", "expiration"],
}

export default function ProductDetails({
  state,
  onBack,
  onSave,
  onDirtyChange,
}: {
  state: PurchaseState
  onBack: () => void
  onSave: (draft: ProductEditDraft) => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [draft, setDraft] = useState<ProductEditDraft | null>(null)
  const [issues, setIssues] = useState<ProductEditIssue[]>([])
  const [notice, setNotice] = useState("")
  const [leaving, setLeaving] = useState(false)
  const confirming = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const errorSummary = useRef<HTMLDivElement>(null)
  const allRows = useMemo(() => productRows(state), [state])
  const groupedByProduct =
    draft?.mode === "names" || draft?.mode === "categories"
  const rows = useMemo(
    () => filterProductRows(productRowsForMode(allRows, draft?.mode), query),
    [allRows, draft?.mode, query],
  )
  const result = paginateRows(rows, page)
  const count = draft ? changedProductEditIds(state, draft).count : 0
  const dirty = count > 0
  const columns = allColumns.filter(
    (column) => !draft || visibleColumns[draft.mode].includes(column.key),
  )
  useEffect(() => {
    heading.current?.focus()
  }, [])
  useEffect(() => {
    if (draft?.mode)
      document
        .querySelector<HTMLElement>(
          ".product-edit-table input, .product-edit-table select",
        )
        ?.focus()
  }, [draft?.mode])
  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])
  useEffect(() => {
    if (page !== result.page) setPage(result.page)
  }, [page, result.page])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(""), 8000)
    return () => clearTimeout(timer)
  }, [notice])

  function begin(mode: ProductEditMode) {
    confirming.current = false
    setIssues([])
    setNotice("")
    setPage(1)
    setDraft(createProductEditDraft(state, mode))
  }
  function finish() {
    const mode = draft?.mode
    setDraft(null)
    setPage(1)
    setIssues([])
    onDirtyChange(false)
    requestAnimationFrame(() =>
      document.getElementById(`product-edit-${mode}`)?.focus(),
    )
  }
  function update(
    id: number,
    field: keyof EditableProduct | "expiration",
    value: string,
    invalidDate = false,
  ) {
    setDraft((previous) =>
      previous
        ? updateProductEditDraft(previous, id, field, value, invalidDate)
        : previous,
    )
    setIssues([])
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft || !dirty || confirming.current) return
    const errors = validateProductEdits(state, draft)
    if (errors.length) {
      setIssues(errors)
      requestAnimationFrame(() => errorSummary.current?.focus())
      return
    }
    if (!event.currentTarget.reportValidity()) return
    confirming.current = true
    try {
      onSave(draft)
      setNotice(
        `${count} ${
          draft.mode === "expiration"
            ? count === 1
              ? "lote actualizado"
              : "lotes actualizados"
            : count === 1
              ? "producto actualizado"
              : "productos actualizados"
        }. Cambios guardados.`,
      )
      finish()
    } catch (error) {
      confirming.current = false
      setIssues([
        {
          id: 0,
          target: "product",
          field: "nombre",
          message:
            error instanceof Error
              ? error.message
              : "No se pudieron guardar los cambios.",
        },
      ])
    }
  }
  function cell(row: ProductRow, key: ColumnKey, label: string) {
    if (key === "precioPaquete" && row.precioPaquete === null)
      return "Sin precio por paquete"
    const field = key as keyof EditableProduct | "expiration"
    const editable =
      draft &&
      ((draft.mode === "prices" &&
        (key === "precioUnitario" || key === "precioPaquete")) ||
        (draft.mode === "names" && key === "nombre") ||
        (draft.mode === "categories" && key === "categoriaId") ||
        (draft.mode === "expiration" && key === "expiration"))
    if (editable && draft) {
      const id = key === "expiration" ? row.loteId : row.productoId
      const value =
        key === "expiration"
          ? draft.lots[id]
          : draft.products[id][(key as keyof EditableProduct)]
      const issue = issues.find(
        (item) =>
          item.id === id &&
          item.field === field &&
          item.target === (key === "expiration" ? "lot" : "product"),
      )
      const inputId = groupedByProduct
        ? `product-${row.productoId}-${key}`
        : `lot-${row.loteId}-${key}`
      return (
        <div className="purchase-field product-inline-field">
          <label className="sr-only" htmlFor={inputId}>
            {label}: {row.codigo}
            {!groupedByProduct && `, ${row.lote}`}
          </label>
          {key === "categoriaId" ? (
            <select
              id={inputId}
              value={value}
              required
              aria-invalid={!!issue}
              aria-describedby={issue ? `${inputId}-error` : undefined}
              onChange={(event) => update(id, field, event.target.value)}
            >
              {state.categorias.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nombre}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={inputId}
              value={value}
              type={
                key === "expiration"
                  ? "date"
                  : key === "nombre"
                    ? "text"
                    : "number"
              }
              required={key !== "expiration"}
              maxLength={key === "nombre" ? 120 : undefined}
              min={
                key === "expiration"
                  ? "0001-01-01"
                  : key === "nombre"
                    ? undefined
                    : "0.01"
              }
              max={key === "expiration" ? "9999-12-31" : undefined}
              step={
                key === "precioUnitario" || key === "precioPaquete"
                  ? "0.01"
                  : undefined
              }
              inputMode={
                key === "precioUnitario" || key === "precioPaquete"
                  ? "decimal"
                  : undefined
              }
              aria-invalid={!!issue}
              aria-describedby={issue ? `${inputId}-error` : undefined}
              onInput={(event) =>
                update(
                  id,
                  field,
                  event.currentTarget.value,
                  key === "expiration" && event.currentTarget.validity.badInput,
                )
              }
              onChange={(event) =>
                update(
                  id,
                  field,
                  event.target.value,
                  key === "expiration" && event.target.validity.badInput,
                )
              }
            />
          )}
          {issue && (
            <span id={`${inputId}-error`} className="product-field-error">
              {issue.message}
            </span>
          )}
        </div>
      )
    }
    if (key === "codigo") return row.codigo
    if (key === "nombre") return row.nombre
    if (key === "precioUnitario") return formatMoney(row.precioUnitario)
    if (key === "precioPaquete")
      return row.precioPaquete === null
        ? "Sin precio por paquete"
        : formatMoney(row.precioPaquete)
    if (key === "categoriaId") return row.categoria
    if (key === "lote") return row.lote
    return row.vencimiento ? displayDay(row.vencimiento) : "Sin vencimiento"
  }

  return (
    <div className="purchases-page purchase-details product-details">
      <header className="details-header">
        <button
          type="button"
          className="purchase-button purchase-button-secondary"
          onClick={() => (dirty ? setLeaving(true) : onBack())}
        >
          <Icon name="arrow" className="size-4 rotate-180" /> Volver
        </button>
        <div>
          <h2 ref={heading} tabIndex={-1} className="text-2xl font-bold">
            Detalle producto
          </h2>
          <p className="purchase-description">
            Consulta y actualiza tus productos y los lotes con existencias.
          </p>
        </div>
      </header>
      <section
        className="purchase-workspace details-workspace"
        aria-label="Detalle de productos"
      >
        <div className="product-toolbar">
          <label className="purchase-field product-code-search">
            <span>Buscar por código del producto</span>
            <input
              type="search"
              placeholder="Ej. DEMO-000003"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
            />
          </label>
          <div
            className="purchase-actions product-edit-actions"
            aria-label="Opciones de edición"
          >
            {editActions.map((action) => (
              <button
                key={action.mode}
                id={`product-edit-${action.mode}`}
                type="button"
                className={`purchase-button ${
                  draft?.mode === action.mode
                    ? "purchase-button-primary"
                    : "purchase-button-secondary"
                }`}
                disabled={!!draft || !allRows.length}
                aria-pressed={draft?.mode === action.mode}
                onClick={() => begin(action.mode)}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
        {draft && (
          <p id="product-edit-help" className="product-edit-help">
            {draft.mode === "expiration"
              ? "El vencimiento se modifica solo para el lote de esta fila. Puedes dejarlo vacío."
              : groupedByProduct
                ? "Cada producto aparece una sola vez. Los cambios se reflejan en todos sus lotes."
                : "Los cambios se aplican al producto y se reflejan en todas sus filas, también en otras páginas."}{" "}
            Puedes buscar y cambiar de página sin perder el borrador. Confirma
            para guardar todos los cambios.
          </p>
        )}
        <form
          onSubmit={submit}
          noValidate
          aria-describedby={draft ? "product-edit-help" : undefined}
        >
          <div className="details-table-wrap">
            <table
              className={`details-table product-details-table ${
                draft ? "product-edit-table" : ""
              }`}
            >
              <caption className="sr-only">
                {draft
                  ? editActions.find((item) => item.mode === draft.mode)?.label
                  : "Productos y lotes disponibles"}
              </caption>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th scope="col" key={column.key}>
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={groupedByProduct ? row.productoId : row.loteId}>
                    {columns.map((column) => (
                      <td key={column.key} data-label={column.label}>
                        {cell(row, column.key, column.label)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!result.total && (
              <p className="details-empty">
                {query
                  ? "No hay lotes disponibles que coincidan con el código."
                  : "No hay lotes con existencias. Registra una compra para consultar sus productos."}
              </p>
            )}
          </div>
          {issues.length > 0 && (
            <div
              className="purchase-error"
              role="alert"
              tabIndex={-1}
              ref={errorSummary}
            >
              <p>
                No se guardó ningún cambio. Revisa estos valores, también si
                están en otra página:
              </p>
              <ul className="product-issue-list">
                {issues.map((issue, index) => (
                  <li key={index}>{issue.message}</li>
                ))}
              </ul>
            </div>
          )}
          <footer className="product-bottom-bar">
            {draft && (
              <div className="product-confirm-bar">
                <span>
                  {count} {draft.mode === "expiration" ? "lotes" : "productos"}{" "}
                  con cambios pendientes
                </span>
                <div className="purchase-footer-actions">
                  <button
                    type="button"
                    className="purchase-button purchase-button-secondary"
                    onClick={finish}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="purchase-button purchase-button-primary"
                    disabled={!dirty}
                  >
                    Confirmar
                  </button>
                </div>
              </div>
            )}
            <div className="details-pagination">
              <p role="status" aria-live="polite">
                {result.total
                  ? `${(result.page - 1) * 10 + 1}–${Math.min(result.page * 10, result.total)} de ${result.total} resultados`
                  : "0 resultados"}
              </p>
              <nav aria-label="Paginación de productos">
                <button
                  type="button"
                  className="details-page-button"
                  disabled={result.page === 1}
                  onClick={() => setPage(result.page - 1)}
                  aria-label="Página anterior"
                >
                  ‹
                </button>
                {Array.from(
                  { length: result.pages },
                  (_, index) => index + 1,
                ).map((number) => (
                  <button
                    type="button"
                    key={number}
                    className="details-page-button"
                    aria-current={result.page === number ? "page" : undefined}
                    aria-label={`Página ${number}`}
                    onClick={() => setPage(number)}
                  >
                    {number}
                  </button>
                ))}
                <button
                  type="button"
                  className="details-page-button"
                  disabled={result.page === result.pages}
                  onClick={() => setPage(result.page + 1)}
                  aria-label="Página siguiente"
                >
                  ›
                </button>
              </nav>
            </div>
          </footer>
        </form>
      </section>
      <div
        className="product-toast"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {notice && (
          <div>
            <span>{notice}</span>
            <button
              type="button"
              className="purchase-close"
              onClick={() => setNotice("")}
              aria-label="Cerrar confirmación"
            >
              <Icon name="close" />
            </button>
          </div>
        )}
      </div>
      {leaving && (
        <DiscardEditsModal
          onContinue={() => setLeaving(false)}
          onDiscard={() => {
            onDirtyChange(false)
            setLeaving(false)
            onBack()
          }}
        />
      )}
    </div>
  )
}
