import { useEffect, useMemo, useRef, useState } from "react"
import Icon from "../components/Icon"
import { formatMoney } from "../data/purchases"
import { formatSaleDate, type POSState } from "../data/sales"
import ModalShell from "../features/purchases/ModalShell"
import { paginateRows } from "../features/purchases/purchaseDetails"
import { tiposPago } from "../data/payments"
import PaymentConnection from "../features/payments/PaymentConnection"

export default function Sales({
  state,
  saleSequence,
  onNewSale,
}: {
  state: POSState
  saleSequence: number
  onNewSale: () => void
}) {
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
  }, [])
  useEffect(() => {
    setPage(1)
  }, [saleSequence])
  const rows = useMemo(
    () =>
      [...state.ventas].sort(
        (a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id,
      ),
    [state.ventas],
  )
  const counts = useMemo(() => {
    const result = new Map<number, Set<number>>()
    for (const detail of state.detallesVenta) {
      if (!result.has(detail.ventaId)) result.set(detail.ventaId, new Set())
      result.get(detail.ventaId)!.add(detail.productoId)
    }
    return result
  }, [state.detallesVenta])
  const result = paginateRows(rows, page)
  const venta = state.ventas.find((item) => item.id === selectedId)
  const details = state.detallesVenta.filter(
    (item) => item.ventaId === selectedId,
  )

  return (
    <div className="purchases-page sales-page">
      <header className="sales-header">
        <div>
          <h2 ref={heading} tabIndex={-1} className="text-2xl font-bold">
            Ventas
          </h2>
          <p className="purchase-description">
            Consulta las transacciones y registra ventas de tu tienda.
          </p>
        </div>
        <button
          id="register-sale-trigger"
          type="button"
          className="purchase-button purchase-button-primary"
          onClick={onNewSale}
        >
          <Icon name="plus" className="size-4" /> Registrar venta
        </button>
      </header>
      <PaymentConnection />
      <section
        className="purchase-workspace details-workspace"
        aria-label="Historial de ventas"
      >
        <h3 className="sale-step-heading">Ventas registradas</h3>
        <div className="sale-table-wrap">
          <table className="sales-history-table">
            <caption className="sr-only">
              Historial de ventas, cantidades de productos, importes y cajeros
            </caption>
            <thead>
              <tr>
                <th>Fecha/Hora</th>
                <th>Cantidad items</th>
                <th>Total cobrado</th>
                <th>Cajer@</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((sale) => (
                <tr key={sale.id}>
                  <td data-label="Fecha/Hora">
                    <strong>{formatSaleDate(sale.fecha)}</strong>
                    <span className="sale-row-hint">V-{sale.id}</span>
                  </td>
                  <td data-label="Cantidad items">
                    {counts.get(sale.id)?.size ?? 0}
                  </td>
                  <td data-label="Total cobrado">
                    <strong>{formatMoney(sale.monto)}</strong>
                  </td>
                  <td data-label="Cajer@">{sale.cajeroNombre}</td>
                  <td data-label="Acción">
                    <button
                      type="button"
                      className="details-icon-button"
                      onClick={() => setSelectedId(sale.id)}
                      aria-label={`Ver detalle de venta V-${sale.id}`}
                    >
                      <Icon name="eye" className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!result.total && (
            <p className="details-empty">Todavía no hay ventas registradas.</p>
          )}
        </div>
        <footer className="details-pagination">
          <p role="status" aria-live="polite">
            {result.total
              ? `${(result.page - 1) * 10 + 1}–${Math.min(result.page * 10, result.total)} de ${result.total} ventas`
              : "0 ventas"}
          </p>
          <nav aria-label="Paginación de ventas">
            <button
              type="button"
              className="details-page-button"
              disabled={result.page === 1}
              onClick={() => setPage(result.page - 1)}
              aria-label="Página anterior"
            >
              ‹
            </button>
            {Array.from({ length: result.pages }, (_, index) => index + 1).map(
              (number) => (
                <button
                  key={number}
                  type="button"
                  className="details-page-button"
                  aria-current={result.page === number ? "page" : undefined}
                  aria-label={`Página ${number}`}
                  onClick={() => setPage(number)}
                >
                  {number}
                </button>
              ),
            )}
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
        </footer>
      </section>
      {venta && (
        <ModalShell
          title={`Comprobante de venta V-${venta.id}`}
          description="Detalle de los productos y precios registrados en esta transacción."
          size="sale"
          onClose={() => setSelectedId(null)}
        >
          <dl className="details-summary">
            <div>
              <dt>Fecha/Hora</dt>
              <dd>{formatSaleDate(venta.fecha)}</dd>
            </div>
            <div>
              <dt>Cajer@</dt>
              <dd>{venta.cajeroNombre}</dd>
            </div>
            <div>
              <dt>Método de pago</dt>
              <dd>
                {tiposPago.find((item) => item.id === venta.tipoPagoId)?.nombre}
              </dd>
            </div>
            <div>
              <dt>QR</dt>
              <dd>{formatMoney(venta.detallePago.monto_qr)}</dd>
            </div>
            <div>
              <dt>Efectivo</dt>
              <dd>{formatMoney(venta.detallePago.monto_efectivo)}</dd>
            </div>
            {venta.notificacionPago && (
              <div>
                <dt>Titular del pago QR</dt>
                <dd>
                  {venta.notificacionPago.titular}
                  {venta.notificacionPago.source === "demo"
                    ? " · Simulado"
                    : ""}
                </dd>
              </div>
            )}
            {venta.origenPago === "manual" && (
              <div>
                <dt>Origen del desglose</dt>
                <dd>Registro manual de contingencia</dd>
              </div>
            )}
            {venta.origenPago === "historico" && (
              <div>
                <dt>Origen del desglose</dt>
                <dd>Datos históricos de demostración</dd>
              </div>
            )}
          </dl>
          <div className="sale-table-wrap">
            <table className="sale-receipt-table">
              <caption className="sr-only">
                Desglose de la venta V-{venta.id}
              </caption>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Presentación</th>
                  <th>Cantidad</th>
                  <th>Precio aplicado</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {details.map((detail) => (
                  <tr key={detail.productoId}>
                    <td data-label="Producto">
                      <strong>{detail.nombreProducto}</strong>
                      <span className="sale-row-hint">
                        {detail.codigoBarra}
                      </span>
                    </td>
                    <td data-label="Presentación">
                      {detail.presentacion === "unidad"
                        ? "Unidad"
                        : `Paquete de ${detail.unidadesPorPaquete} unidades`}
                    </td>
                    <td data-label="Cantidad">{detail.cantidad}</td>
                    <td data-label="Precio aplicado">
                      {formatMoney(detail.precio)}
                    </td>
                    <td data-label="Subtotal">
                      <strong>{formatMoney(detail.subtotal)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <footer className="purchase-modal-footer">
            <div>
              <p className="purchase-total-label">Total pagado</p>
              <strong className="purchase-total">
                {formatMoney(venta.monto)}
              </strong>
            </div>
            <button
              type="button"
              className="purchase-button purchase-button-secondary"
              onClick={() => setSelectedId(null)}
            >
              Cerrar
            </button>
          </footer>
        </ModalShell>
      )}
    </div>
  )
}
