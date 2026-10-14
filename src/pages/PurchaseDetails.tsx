import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Icon from "../components/Icon"
import { almacenes, type PurchaseState } from "../data/purchases"
import ModalShell from "../features/purchases/ModalShell"
import SupplierToast from "../features/purchases/SupplierToast"
import {
  displayDay,
  emptySummaryFilters,
  filterError,
  filterPurchaseSummaries,
  formatPurchaseMoney,
  paginateRows,
  purchaseMetrics,
  purchaseSummaries,
  type PurchaseSummaryFilters,
} from "../features/purchases/purchaseDetails"

export default function PurchaseDetails({
  state,
  onBack,
  onDelete,
}: {
  state: PurchaseState
  onBack: () => void
  onDelete: (id: number) => void
}) {
  const [filters, setFilters] = useState({ ...emptySummaryFilters })
  const [invalidDates, setInvalidDates] = useState(new Set<string>())
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState<{
    kind: "view" | "delete"
    id: number
  } | null>(null)
  const [notice, setNotice] = useState("")
  const closeNotice = useCallback(() => setNotice(""), [])
  const heading = useRef<HTMLHeadingElement>(null)
  const tableHeading = useRef<HTMLHeadingElement>(null)
  const confirming = useRef(false)
  const allRows = useMemo(() => purchaseSummaries(state), [state])
  const error = invalidDates.size
    ? "Introduce fechas válidas."
    : filterError(filters)
  const rows = useMemo(
    () => (error ? [] : filterPurchaseSummaries(allRows, filters)),
    [allRows, filters, error],
  )
  const metrics = purchaseMetrics(rows)
  const result = paginateRows(rows, page)
  const compra = allRows.find((item) => item.id === modal?.id)
  const units = state.lotes
    .filter((item) => item.compraId === modal?.id)
    .reduce((sum, item) => sum + item.stock_actual, 0)
  useEffect(() => {
    heading.current?.focus()
  }, [])
  useEffect(() => {
    if (page !== result.page) setPage(result.page)
  }, [page, result.page])
  useEffect(() => {
    if (notice && !modal) tableHeading.current?.focus()
  }, [notice, modal])
  function update(
    key: keyof PurchaseSummaryFilters,
    value: string,
    invalid = false,
  ) {
    setFilters((previous) => ({ ...previous, [key]: value }))
    if (key !== "proveedorId")
      setInvalidDates((previous) => {
        const next = new Set(previous)
        if (invalid) next.add(key)
        else next.delete(key)
        return next
      })
    setPage(1)
  }
  function open(kind: "view" | "delete", id: number) {
    confirming.current = false
    setNotice("")
    setModal({ kind, id })
  }
  return (
    <div className="purchases-page purchase-details purchase-history">
      <header className="purchase-history-heading">
        <button
          type="button"
          className="purchase-button purchase-button-secondary"
          onClick={onBack}
        >
          <span aria-hidden="true">←</span> Volver
        </button>
        <div>
          <h2 ref={heading} tabIndex={-1}>
            Detalle compra
          </h2>
          <p className="purchase-description">
            Consulta el historial y el desglose de tus compras.
          </p>
        </div>
      </header>
      <section
        className="purchase-history-metrics"
        aria-label="Resumen del período"
      >
        {[
          {
            label: "Compras del período",
            value: error ? "—" : String(metrics.cantidad),
            icon: "purchase",
            tone: "green",
          },
          {
            label: "Monto acumulado",
            value: error ? "—" : formatPurchaseMoney(metrics.monto),
            icon: "chart",
            tone: "orange",
          },
          {
            label: "Proveedores activos",
            value: error ? "—" : String(metrics.proveedores),
            icon: "user",
            tone: "blue",
          },
        ].map((item) => (
          <div
            className={"purchase-history-metric metric-" + item.tone}
            key={item.label}
          >
            <span className="purchase-history-metric-icon">
              <Icon
                name={item.icon as "purchase" | "chart" | "user"}
                className="size-5"
              />
            </span>
            <div>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          </div>
        ))}
      </section>
      <section
        className="purchase-workspace purchase-history-workspace"
        aria-label="Historial de compras"
      >
        <div className="purchase-history-filters">
          {(["inicio", "final"] as const).map((key) => (
            <label
              className="purchase-field"
              key={key}
              htmlFor={"purchase-history-" + key}
            >
              <span>{key === "inicio" ? "Fecha Inicio" : "Fecha Final"}</span>
              <input
                id={"purchase-history-" + key}
                type="date"
                min="0001-01-01"
                max="9999-12-31"
                value={filters[key]}
                aria-invalid={!!error}
                aria-describedby={
                  error ? "purchase-history-filter-error" : undefined
                }
                onInput={(event) =>
                  update(
                    key,
                    event.currentTarget.value,
                    !event.currentTarget.validity.valid,
                  )
                }
                onChange={(event) =>
                  update(key, event.target.value, !event.target.validity.valid)
                }
              />
            </label>
          ))}
          <label className="purchase-field" htmlFor="purchase-history-supplier">
            <span>Seleccionar Proveedor</span>
            <select
              id="purchase-history-supplier"
              value={filters.proveedorId}
              onChange={(event) => update("proveedorId", event.target.value)}
            >
              <option value="">Todos los proveedores</option>
              {state.proveedores.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nombre}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && (
          <p
            className="purchase-error"
            id="purchase-history-filter-error"
            role="alert"
          >
            {error}
          </p>
        )}
        <h3 ref={tableHeading} tabIndex={-1} className="sr-only">
          Compras registradas
        </h3>
        <div className="purchase-history-table-wrap">
          <table className="purchase-history-table">
            <caption className="sr-only">
              Historial: fecha, proveedor, total y acciones. Una fila por
              compra.
            </caption>
            <colgroup>
              <col className="history-date-col" />
              <col className="history-provider-col" />
              <col className="history-total-col" />
              <col className="history-actions-col" />
            </colgroup>
            <thead>
              <tr>
                {["Fecha", "Proveedor", "Total", "Acciones"].map((title) => (
                  <th key={title} scope="col">
                    {title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.id}>
                  <td data-label="Fecha">
                    <strong>{displayDay(row.dia)}</strong>
                    <span className="purchase-history-code">C-{row.id}</span>
                  </td>
                  <td data-label="Proveedor">{row.proveedor}</td>
                  <td data-label="Total" className="purchase-history-money">
                    {formatPurchaseMoney(row.total)}
                  </td>
                  <td data-label="Acciones">
                    <div className="details-row-actions">
                      <button
                        type="button"
                        className="details-icon-button"
                        aria-label={"Ver compra C-" + row.id}
                        onClick={() => open("view", row.id)}
                      >
                        <Icon name="eye" />
                      </button>
                      <button
                        type="button"
                        className="details-icon-button details-annul"
                        aria-label={"Eliminar compra C-" + row.id}
                        onClick={() => open("delete", row.id)}
                      >
                        <Icon name="trash" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <p className="purchase-history-empty">
              {error
                ? "Corrige las fechas para consultar compras."
                : "No hay compras que coincidan con los filtros."}
            </p>
          )}
        </div>
        <footer className="details-pagination purchase-history-pagination">
          <p role="status" aria-live="polite">
            {result.total
              ? (result.page - 1) * 10 +
                1 +
                "–" +
                Math.min(result.page * 10, result.total) +
                " de " +
                result.total +
                " compras"
              : "0 compras"}
          </p>
          <nav aria-label="Paginación de compras">
            <button
              type="button"
              className="details-page-button"
              disabled={result.page === 1}
              aria-label="Página anterior"
              onClick={() => setPage(result.page - 1)}
            >
              ‹
            </button>
            <span
              className="purchase-history-page-current"
              aria-current="page"
              aria-label={"Página " + result.page}
            >
              {result.page}
            </span>
            <button
              type="button"
              className="details-page-button"
              disabled={!result.total || result.page === result.pages}
              aria-label="Página siguiente"
              onClick={() => setPage(result.page + 1)}
            >
              ›
            </button>
            <span className="purchase-history-page-count">
              de {result.pages}
            </span>
          </nav>
        </footer>
      </section>
      <SupplierToast message={notice} onClose={closeNotice} />
      {modal && compra && (
        <ModalShell
          title={
            (modal.kind === "view" ? "Compra C-" : "Eliminar compra C-") +
            compra.id
          }
          description={
            modal.kind === "view"
              ? "Desglose de los productos adquiridos."
              : "Confirma la eliminación de esta compra y sus datos asociados."
          }
          size={modal.kind === "view" ? "receipt" : "purchase"}
          onClose={() => setModal(null)}
        >
          {modal.kind === "view" ? (
            <>
              <dl className="purchase-receipt-meta">
                <div>
                  <dt>Código de compra</dt>
                  <dd>C-{compra.id}</dd>
                </div>
                <div>
                  <dt>Fecha</dt>
                  <dd>{displayDay(compra.dia)}</dd>
                </div>
                <div>
                  <dt>Proveedor</dt>
                  <dd>{compra.proveedor}</dd>
                </div>
                <div>
                  <dt>Estado</dt>
                  <dd>
                    <span className="purchase-receipt-status">Registrada</span>
                  </dd>
                </div>
              </dl>
              <div className="purchase-receipt-wrap">
                <table className="purchase-receipt-table">
                  <caption className="sr-only">
                    Productos adquiridos en la compra C-{compra.id}
                  </caption>
                  <thead>
                    <tr>
                      {[
                        "Producto",
                        "Presentación",
                        "Cantidad",
                        "Costo",
                        "Lote",
                        "Vencimiento",
                        "Subtotal",
                      ].map((title) => (
                        <th scope="col" key={title}>
                          {title}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {compra.detalles.map((item, index) => (
                      <tr
                        key={
                          item.productoId + "-" + item.almacenId + "-" + index
                        }
                      >
                        <td>
                          <strong>{item.nombre}</strong>
                          <span className="purchase-receipt-destination">
                            {
                              almacenes.find(
                                (almacen) => almacen.id === item.almacenId,
                              )?.nombre
                            }
                          </span>
                        </td>
                        <td>
                          {item.presentacion === "paquete"
                            ? "Paquete (" + item.unidadesPorPaquete + " u.)"
                            : "Unidad"}
                        </td>
                        <td>{item.cantidad}</td>
                        <td>
                          {formatPurchaseMoney(item.precio)}
                          <span className="purchase-receipt-destination">
                            por {item.presentacion}
                          </span>
                        </td>
                        <td>
                          {item.lotes.length
                            ? item.lotes.map((lot) => (
                                <span
                                  className="purchase-receipt-lot"
                                  key={lot.id}
                                >
                                  {lot.nombre}
                                </span>
                              ))
                            : "Sin lote"}
                        </td>
                        <td>
                          {item.lotes.length
                            ? item.lotes.map((lot) => (
                                <span
                                  className="purchase-receipt-lot"
                                  key={lot.id}
                                >
                                  {lot.fecha_vencimiento
                                    ? displayDay(lot.fecha_vencimiento)
                                    : "Sin caducidad"}
                                </span>
                              ))
                            : "Sin caducidad"}
                        </td>
                        <td className="purchase-history-money">
                          {formatPurchaseMoney(item.subtotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!compra.detalles.length && (
                  <p className="purchase-history-empty">
                    Esta compra no tiene detalles registrados.
                  </p>
                )}
              </div>
              <footer className="purchase-modal-footer">
                <div>
                  <p className="purchase-total-label">Total liquidado</p>
                  <output className="purchase-total">
                    {formatPurchaseMoney(compra.total)}
                  </output>
                </div>
                <button
                  type="button"
                  className="purchase-button purchase-button-secondary"
                  onClick={() => setModal(null)}
                >
                  Cerrar
                </button>
              </footer>
            </>
          ) : (
            <>
              <p className="details-confirm">
                Se eliminará la compra <strong>C-{compra.id}</strong> por{" "}
                <strong>{formatPurchaseMoney(compra.total)}</strong>, junto con
                sus detalles y lotes. Se retirarán{" "}
                <strong>{units} unidades disponibles</strong> del inventario.
              </p>
              <footer className="purchase-modal-footer catalog-modal-footer">
                <div className="purchase-footer-actions">
                  <button
                    type="button"
                    className="purchase-button purchase-button-secondary"
                    onClick={() => setModal(null)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="purchase-button purchase-button-primary"
                    onClick={() => {
                      if (confirming.current) return
                      confirming.current = true
                      onDelete(compra.id)
                      setModal(null)
                      setNotice(
                        "Compra C-" +
                          compra.id +
                          " eliminada. Se retiraron " +
                          units +
                          " unidades disponibles.",
                      )
                    }}
                  >
                    Confirmar eliminación
                  </button>
                </div>
              </footer>
            </>
          )}
        </ModalShell>
      )}
    </div>
  )
}
