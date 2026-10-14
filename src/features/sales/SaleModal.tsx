import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import Icon from "../../components/Icon"
import {
  formatMoney,
  resolveProductCode,
  type PurchaseState,
} from "../../data/purchases"
import { prepareSale, saleCatalog, type SaleDraftRow } from "../../data/sales"
import ModalShell from "../purchases/ModalShell"
import { createBarcodeScanner } from "../purchases/barcodeScanner"
import {
  matchesProductCode,
  prioritizedProducts,
} from "../purchases/productSelection"

interface ScanSnapshot {
  field: HTMLInputElement | HTMLSelectElement | null
  value: string
}

export default function SaleModal({
  inventario,
  error,
  onClose,
  onSell,
}: {
  inventario: PurchaseState
  error: string
  onClose: () => void
  onSell: (draft: SaleDraftRow[]) => void
}) {
  const [step, setStep] = useState<1 | 2>(1)
  const [code, setCode] = useState("")
  const [category, setCategory] = useState("")
  const [draft, setDraft] = useState<SaleDraftRow[]>([])
  const [scanNotice, setScanNotice] = useState("")
  const [scanError, setScanError] = useState("")
  const scanSequence = useRef(0)
  const scanner = useRef(createBarcodeScanner<ScanSnapshot>())
  const [clock, setClock] = useState(() => new Date().toISOString())
  const codeInput = useRef<HTMLInputElement>(null)
  const stepHeading = useRef<HTMLHeadingElement>(null)
  const previousButton = useRef<HTMLButtonElement>(null)
  const quantityInputs = useRef(new Map<number, HTMLInputElement>())
  useEffect(() => {
    const timer = window.setInterval(
      () => setClock(new Date().toISOString()),
      60000,
    )
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (step === 1) codeInput.current?.focus()
    else stepHeading.current?.focus()
  }, [step])
  const catalog = useMemo(
    () => saleCatalog(inventario, clock),
    [inventario, clock],
  )
  const preview = useMemo(
    () => prepareSale(inventario, draft, clock),
    [inventario, draft, clock],
  )
  const products = prioritizedProducts(
    catalog,
    draft.map((row) => row.productoId),
    (product) =>
      matchesProductCode(product, inventario.paquetes, code) &&
      (!category || product.categoriaId === Number(category)),
  )

  const scanHandler = useRef((_value: string) => {})
  scanHandler.current = (value) => {
    setCode("")
    const match = resolveProductCode(inventario, value)
    const product = catalog.find((item) => item.id === match?.id)
    if (!product || !product.stockVendible) {
      setScanNotice("")
      setScanError(
        product
          ? "El producto no tiene stock vendible."
          : "Código no encontrado: " + (value.trim() || "vacío") + ".",
      )
      codeInput.current?.focus()
      return
    }
    setDraft((previous) =>
      previous.some((row) => row.productoId === product.id)
        ? previous
        : [
            ...previous,
            { productoId: product.id, presentacion: "unidad", cantidad: "1" },
          ],
    )
    setScanError("")
    scanSequence.current += 1
    setScanNotice(
      product.nombre + " seleccionado · lectura " + scanSequence.current + ".",
    )
    requestAnimationFrame(() => {
      codeInput.current?.focus({ preventScroll: true })
      document
        .getElementById("sale-product-" + product.id)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" })
    })
  }
  useEffect(() => {
    const reader = scanner.current
    reader.clear()
    if (step !== 1) return
    function keydown(event: KeyboardEvent) {
      if (event.target === codeInput.current) {
        reader.clear()
        return
      }
      const result = reader.feed(event, () => {
        const field =
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLSelectElement
            ? event.target
            : null
        return { field, value: field?.value ?? "" }
      })
      if (!result) return
      event.preventDefault()
      event.stopPropagation()
      if (result.snapshot.field?.isConnected)
        result.snapshot.field.value = result.snapshot.value
      scanHandler.current(result.code)
    }
    window.addEventListener("keydown", keydown, true)
    return () => {
      window.removeEventListener("keydown", keydown, true)
      reader.clear()
    }
  }, [step])

  function toggle(id: number) {
    setScanNotice("")
    setScanError("")
    setDraft((previous) =>
      previous.some((row) => row.productoId === id)
        ? previous.filter((row) => row.productoId !== id)
        : [
            ...previous,
            { productoId: id, presentacion: "unidad", cantidad: "1" },
          ],
    )
  }
  function update(id: number, data: Partial<Omit<SaleDraftRow, "productoId">>) {
    setDraft((previous) =>
      previous.map((row) =>
        row.productoId === id ? { ...row, ...data } : row,
      ),
    )
  }
  function remove(id: number) {
    const index = draft.findIndex((row) => row.productoId === id)
    const remaining = draft.filter((row) => row.productoId !== id)
    setDraft(remaining)
    const next = remaining[Math.min(index, remaining.length - 1)]
    requestAnimationFrame(() => {
      if (next) quantityInputs.current.get(next.productoId)?.focus()
      else previousButton.current?.focus()
    })
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (step === 1) {
      if (draft.length) setStep(2)
    } else if (preview.valid) onSell(draft)
  }

  return (
    <ModalShell
      title={step === 1 ? "Seleccionar productos" : "Configurar venta"}
      description={`Paso ${step} de 2 · ${
        step === 1
          ? "Marca los productos que deseas vender."
          : "Elige presentación y cantidad antes de confirmar."
      }`}
      size="sale"
      restoreFocusSelector="#register-sale-trigger"
      onClose={onClose}
    >
      <form onSubmit={submit}>
        {step === 1 ? (
          <>
            <div className="sale-filters">
              <label className="purchase-field" htmlFor="sale-code">
                <span>Código</span>
                <input
                  ref={codeInput}
                  id="sale-code"
                  type="search"
                  autoComplete="off"
                  placeholder="Ej. DEMO-000001"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || event.nativeEvent.isComposing)
                      return
                    event.preventDefault()
                    event.stopPropagation()
                    scanHandler.current(code)
                  }}
                />
              </label>
              <label className="purchase-field" htmlFor="sale-category">
                <span>Seleccionar categoría</span>
                <select
                  id="sale-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                >
                  <option value="">Todas las categorías</option>
                  {inventario.categorias.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.nombre}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {scanNotice && (
              <p
                className="purchase-scan-notice"
                role="status"
                aria-live="polite"
              >
                ✓ {scanNotice}
              </p>
            )}
            {scanError && (
              <p className="purchase-error" role="alert">
                {scanError}
              </p>
            )}
            <p
              className="sale-selection-summary"
              role="status"
              aria-live="polite"
            >
              {draft.length} productos seleccionados · El stock vendible excluye
              lotes vencidos.
            </p>
            <div className="sale-product-grid">
              {products.map((product) => {
                const selected = draft.some(
                  (row) => row.productoId === product.id,
                )
                return (
                  <button
                    key={product.id}
                    id={"sale-product-" + product.id}
                    type="button"
                    aria-pressed={selected}
                    disabled={!product.stockVendible && !selected}
                    className={`sale-product-card${
                      selected ? " is-selected" : ""
                    }`}
                    aria-label={`Seleccionar ${product.nombre}`}
                    onClick={() => toggle(product.id)}
                  >
                    <span className="sale-product-top">
                      <Icon name="box" className="size-6" />
                      <span className="sale-selection-check" aria-hidden="true">
                        {selected ? "✓" : "+"}
                      </span>
                    </span>
                    <span className="sale-product-name">{product.nombre}</span>
                    <span className="sale-product-code">
                      {product.codigo_barra}
                    </span>
                    <span className="sale-product-price">
                      Unidad{" "}
                      <strong>{formatMoney(product.precio_unitario)}</strong>
                    </span>
                    <span className="sale-product-price">
                      Paquete{" "}
                      <strong>
                        {product.unidadesPorPaquete &&
                        product.precio_paquete !== null
                          ? formatMoney(product.precio_paquete)
                          : "No disponible"}
                      </strong>
                    </span>
                    <span className="sale-product-stock">
                      {product.stockVendible
                        ? `${product.stockVendible} unidades vendibles`
                        : "Sin stock vendible"}
                    </span>
                  </button>
                )
              })}
            </div>
            {!products.length && (
              <p className="details-empty">
                No hay productos que coincidan con el código y la categoría.
              </p>
            )}
          </>
        ) : (
          <>
            <h3 ref={stepHeading} tabIndex={-1} className="sale-step-heading">
              Productos de la venta
            </h3>
            <div className="sale-table-wrap">
              <table className="sale-config-table">
                <caption className="sr-only">
                  Presentaciones, cantidades y precios de los productos
                  seleccionados
                </caption>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Unidad</th>
                    <th>Paquete</th>
                    <th>Cantidad</th>
                    <th>Precio</th>
                    <th>
                      <span className="sr-only">Acción</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {draft.map((row, index) => {
                    const product = catalog.find(
                      (item) => item.id === row.productoId,
                    )
                    const detail = preview.rows[index]
                    const issue = preview.issues[row.productoId]
                    return (
                      <tr key={row.productoId}>
                        <td data-label="Producto">
                          <strong>{detail.nombreProducto}</strong>
                          <span className="sale-row-hint">
                            {detail.stockVendible} unidades vendibles
                          </span>
                          {issue && (
                            <span
                              className="sale-row-error"
                              id={`sale-error-${row.productoId}`}
                            >
                              {issue}
                            </span>
                          )}
                        </td>
                        <td data-label="Unidad">
                          <input
                            type="radio"
                            name={`sale-presentation-${row.productoId}`}
                            aria-label={`Unidad para ${detail.nombreProducto}`}
                            value="unidad"
                            checked={row.presentacion === "unidad"}
                            onChange={() =>
                              update(row.productoId, { presentacion: "unidad" })
                            }
                          />
                        </td>
                        <td data-label="Paquete">
                          <input
                            type="radio"
                            name={`sale-presentation-${row.productoId}`}
                            aria-label={`Paquete para ${detail.nombreProducto}`}
                            value="paquete"
                            checked={row.presentacion === "paquete"}
                            disabled={
                              !product?.unidadesPorPaquete ||
                              product.precio_paquete === null
                            }
                            onChange={() =>
                              update(row.productoId, {
                                presentacion: "paquete",
                              })
                            }
                          />
                          <span className="sale-row-hint">
                            {product?.unidadesPorPaquete
                              ? `${product.unidadesPorPaquete} unid.`
                              : "No disponible"}
                          </span>
                        </td>
                        <td data-label="Cantidad">
                          <input
                            ref={(input) => {
                              if (input)
                                quantityInputs.current.set(
                                  row.productoId,
                                  input,
                                )
                              else quantityInputs.current.delete(row.productoId)
                            }}
                            className="sale-quantity"
                            type="number"
                            min="1"
                            step="1"
                            required
                            inputMode="numeric"
                            aria-label={`Cantidad para ${detail.nombreProducto}`}
                            aria-invalid={!!issue}
                            aria-describedby={
                              issue ? `sale-error-${row.productoId}` : undefined
                            }
                            value={row.cantidad}
                            onChange={(event) =>
                              update(row.productoId, {
                                cantidad: event.target.value,
                              })
                            }
                          />
                        </td>
                        <td data-label="Precio">
                          <strong>{formatMoney(detail.precio)}</strong>
                          <span className="sale-row-hint">
                            Subtotal:{" "}
                            {issue ? "—" : formatMoney(detail.subtotal)}
                          </span>
                        </td>
                        <td data-label="Acción">
                          <button
                            type="button"
                            className="details-icon-button details-annul"
                            aria-label={`Quitar ${detail.nombreProducto}`}
                            onClick={() => remove(row.productoId)}
                          >
                            <Icon name="trash" className="size-4" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {!draft.length && (
                <p className="details-empty">
                  La venta está vacía. Regresa al paso anterior para seleccionar
                  productos.
                </p>
              )}
            </div>
            {preview.error && draft.length > 0 && (
              <p className="purchase-error" role="alert">
                {preview.error}
              </p>
            )}
          </>
        )}
        {error && (
          <p className="purchase-error" role="alert">
            {error}
          </p>
        )}
        <footer className="purchase-modal-footer sale-wizard-footer">
          {step === 2 ? (
            <div>
              <p className="purchase-total-label">Total de la venta</p>
              <output className="purchase-total" aria-live="polite">
                {preview.valid ? formatMoney(preview.total) : "—"}
              </output>
            </div>
          ) : (
            <span className="sale-footer-count">
              {draft.length} productos seleccionados
            </span>
          )}
          <div className="purchase-footer-actions">
            <button
              type="button"
              className="purchase-button purchase-button-secondary"
              onClick={onClose}
            >
              Cancelar
            </button>
            {step === 2 && (
              <button
                ref={previousButton}
                type="button"
                className="purchase-button purchase-button-secondary"
                onClick={() => setStep(1)}
              >
                Anterior
              </button>
            )}
            <button
              type="submit"
              className="purchase-button purchase-button-primary"
              disabled={step === 1 ? !draft.length : !preview.valid}
            >
              {step === 1 ? "Siguiente" : "Vender"}
            </button>
          </div>
        </footer>
      </form>
    </ModalShell>
  )
}
