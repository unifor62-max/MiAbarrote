import { useEffect, useMemo, useRef, useState } from "react"
import Icon from "../components/Icon"
import MetricCard from "../components/MetricCard"
import { bolivianDay } from "../data/dates"
import { formatMoney } from "../data/purchases"
import { buildReports, type ReportFilters } from "../data/reports"
import type { POSState } from "../data/sales"

const emptyFilters: ReportFilters = { inicio: "", final: "" }
const urgencyLabels = {
  critical: "Urgente",
  soon: "Por vencer",
  healthy: "En plazo",
}

export default function Reports({ state }: { state: POSState }) {
  const [filters, setFilters] = useState<ReportFilters>(emptyFilters)
  const [invalidDates, setInvalidDates] = useState<string[]>([])
  const [filterReset, setFilterReset] = useState(0)
  const [soonOnly, setSoonOnly] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const today = bolivianDay()
  const report = useMemo(
    () => buildReports(state, filters, today),
    [state, filters, today],
  )
  const error = invalidDates.length ? "Introduce fechas válidas." : report.error
  const money = (value: number | null) =>
    error || value === null ? "—" : formatMoney(value)
  const lots = soonOnly
    ? report.lots.filter((lot) => lot.days < 30)
    : report.lots
  useEffect(() => {
    heading.current?.focus()
  }, [])

  function updateDate(field: keyof ReportFilters, input: HTMLInputElement) {
    const value = input.value
    const invalid = input.validity.badInput
    setFilters((previous) => ({ ...previous, [field]: value }))
    setInvalidDates((previous) =>
      invalid
        ? [...new Set([...previous, field])]
        : previous.filter((item) => item !== field),
    )
  }

  return (
    <div className="reports-page">
      <header className="inventory-heading">
        <div>
          <span className="purchase-eyebrow">MiAbarrote · Villa Verde</span>
          <h2 ref={heading} tabIndex={-1}>
            Reportes de negocio
          </h2>
          <p className="purchase-description">
            Consulta los resultados de tu tienda y prioriza la reposición.
          </p>
        </div>
        <span className="inventory-total">
          <Icon name="chart" className="size-4" /> Resumen gerencial
        </span>
      </header>

      <section
        className="purchase-workspace report-filter-panel"
        aria-label="Período del reporte"
      >
        <div className="report-filters">
          {([
            ["inicio", "Desde"],
            ["final", "Hasta"],
          ] as const).map(([field, label]) => (
            <label key={field} className="purchase-field">
              <span>{label}</span>
              <input
                key={`${field}-${filterReset}`}
                type="date"
                value={filters[field]}
                aria-invalid={Boolean(error)}
                aria-describedby={
                  error ? "report-filter-error" : "report-period-help"
                }
                onInput={(event) => updateDate(field, event.currentTarget)}
                onKeyUp={(event) => updateDate(field, event.currentTarget)}
                onBlur={(event) => updateDate(field, event.currentTarget)}
                onChange={(event) => updateDate(field, event.currentTarget)}
              />
            </label>
          ))}
          <button
            type="button"
            className="purchase-button purchase-button-secondary"
            onClick={() => {
              setFilters(emptyFilters)
              setInvalidDates([])
              setFilterReset((previous) => previous + 1)
            }}
          >
            Limpiar filtros
          </button>
        </div>
        <p
          id="report-period-help"
          className="report-period-help"
          role="status"
          aria-live="polite"
        >
          {!filters.inicio && !filters.final && !error
            ? "Todo el histórico"
            : "Período seleccionado"}{" "}
          · Fechas inclusivas, hora de Bolivia
        </p>
        {error && (
          <p id="report-filter-error" className="purchase-error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="report-kpis" aria-label="Indicadores principales">
        <MetricCard
          label="Total ingresos"
          value={money(report.ingresos)}
          detail="Ventas registradas del período"
          icon="sale"
          tone="bg-[#e7f3dc] text-[#347d1c]"
        />
        <MetricCard
          label="Total egresos"
          value={money(report.egresos)}
          detail="Compras registradas del período"
          icon="purchase"
          tone="bg-[#fff0e5] text-[#c94c08]"
        />
        <MetricCard
          label="Margen bruto estimado"
          value={money(report.margen)}
          detail="Ingresos menos compras registradas"
          icon="chart"
          tone="bg-[#e5f4fa] text-[#087ba8]"
        />
        <MetricCard
          label="Alertas críticas"
          value={String(report.criticalAlerts)}
          detail={`${report.stockAlerts} ${
            report.stockAlerts === 1 ? "producto" : "productos"
          } con stock bajo · ${report.expiryAlerts} ${
            report.expiryAlerts === 1 ? "lote" : "lotes"
          } por vencer`}
          icon="warning"
          tone="bg-[#fff0e5] text-[#c94c08]"
        />
      </section>

      <section
        className="purchase-workspace report-lots"
        aria-labelledby="report-lots-title"
      >
        <header className="report-section-heading">
          <div>
            <h3 id="report-lots-title">Lotes y próximos vencimientos</h3>
            <p className="purchase-description">
              Stock actual · Las alertas se calculan desde hoy,
              independientemente del período financiero.
            </p>
          </div>
          <button
            type="button"
            aria-pressed={soonOnly}
            className={`purchase-button inventory-toggle ${
              soonOnly ? "inventory-toggle-active" : "purchase-button-secondary"
            }`}
            onClick={() => setSoonOnly(!soonOnly)}
          >
            <Icon name="calendar" className="size-4" /> Solo próximos a vencer
          </button>
        </header>
        <div className="inventory-table-wrap">
          <table className="report-lots-table">
            <caption className="sr-only">
              Lotes con stock y fecha de vencimiento desde hoy, ordenados por
              urgencia
            </caption>
            <thead>
              <tr>
                <th>Lote / Producto</th>
                <th>Vencimiento</th>
                <th>Stock actual</th>
                <th>Prioridad</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((lot) => (
                <tr key={lot.id}>
                  <td data-label="Lote / Producto">
                    <strong>{lot.nombre}</strong>
                    <span className="stock-cell-hint">{lot.producto}</span>
                  </td>
                  <td data-label="Vencimiento">
                    <strong>
                      {lot.vencimiento.split("-").reverse().join("/")}
                    </strong>
                    <span className="stock-cell-hint">
                      {lot.days === 0
                        ? "Vence hoy"
                        : `En ${lot.days} ${lot.days === 1 ? "día" : "días"}`}
                    </span>
                  </td>
                  <td data-label="Stock actual">
                    <strong>{lot.stock} u.</strong>
                  </td>
                  <td data-label="Prioridad">
                    <span
                      className={`report-urgency report-urgency-${lot.urgency}`}
                    >
                      <span className="report-status-dot" aria-hidden="true" />
                      {urgencyLabels[lot.urgency]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!lots.length && (
            <p className="details-empty">
              {soonOnly
                ? "No hay lotes con stock que venzan en menos de 30 días."
                : "No hay lotes con stock y vencimiento desde hoy."}
            </p>
          )}
        </div>
        <p className="report-period-help" role="status" aria-live="polite">
          {lots.length} lotes · Urgente: 0–7 días · Por vencer: 8–29 días · En
          plazo: desde 30 días
        </p>
      </section>

      <section
        className="purchase-workspace"
        aria-labelledby="report-top-title"
      >
        <header className="report-section-heading">
          <div>
            <h3 id="report-top-title">Top 5 productos más vendidos</h3>
            <p className="purchase-description">
              Ranking por unidades totales vendidas durante el período
              seleccionado.
            </p>
          </div>
          <span className="report-section-icon">
            <Icon name="trend" className="size-5" />
          </span>
        </header>
        {error ? (
          <p className="details-empty">
            Corrige el rango de fechas para consultar el ranking.
          </p>
        ) : !report.topProducts.length ? (
          <p className="details-empty">
            No hay ventas registradas en este período.
          </p>
        ) : (
          <div className="inventory-table-wrap">
            <table className="report-ranking-table">
              <caption className="sr-only">
                Ranking de productos por unidades vendidas e ingresos
              </caption>
              <thead>
                <tr>
                  <th>Posición</th>
                  <th>Producto</th>
                  <th>Unidades vendidas</th>
                  <th>Ingresos</th>
                </tr>
              </thead>
              <tbody>
                {report.topProducts.map((product, index) => (
                  <tr key={product.id}>
                    <td data-label="Posición">
                      <span className="report-rank-number">{index + 1}</span>
                    </td>
                    <td data-label="Producto">
                      <strong>{product.nombre}</strong>
                      <span className="stock-cell-hint">{product.codigo}</span>
                      <span className="report-rank-track" aria-hidden="true">
                        <span
                          style={{
                            width: `${(product.unidades / report.topProducts[0].unidades) * 100}%`,
                          }}
                        />
                      </span>
                    </td>
                    <td data-label="Unidades vendidas">
                      <strong>{product.unidades} u.</strong>
                    </td>
                    <td data-label="Ingresos">
                      <strong>{formatMoney(product.ingresos)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
