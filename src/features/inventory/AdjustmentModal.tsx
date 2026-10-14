import { useEffect, useRef, useState, type FormEvent } from "react"
import Icon from "../../components/Icon"
import {
  almacenes,
  formatMoney,
  resolveProductCode,
  type PurchaseState,
} from "../../data/purchases"
import {
  prepareInventoryAdjustment,
  type AdjustmentFeedback,
  type InventoryAdjustmentDraft,
  type InventoryAdjustmentItemDraft,
} from "../../data/inventoryAdjustments"
import ModalShell from "../purchases/ModalShell"
import { createBarcodeScanner } from "../purchases/barcodeScanner"
import {
  matchesProductCode,
  prioritizedProducts,
} from "../purchases/productSelection"

interface ScanSnapshot {
  draft: InventoryAdjustmentDraft
  category: string
  field: HTMLInputElement | HTMLSelectElement | null
  value: string
}
export default function AdjustmentModal({
  state,
  origin,
  feedback,
  onClose,
  onSave,
  onSuccess,
}: {
  state: PurchaseState
  origin: number
  feedback: AdjustmentFeedback
  onClose: () => void
  onSave: (draft: InventoryAdjustmentDraft) => void
  onSuccess: (origin: number, adjustmentId: number) => void
}) {
  const [step, setStep] = useState<1 | 2>(1)
  const [code, setCode] = useState("")
  const [category, setCategory] = useState("")
  const [draft, setDraft] = useState<InventoryAdjustmentDraft>({
    almacenId: origin,
    tipo: "entrada",
    items: [],
  })
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [invalidDates, setInvalidDates] = useState(new Set<number>())
  const [pending, setPending] = useState(false)
  const attempt = useRef<number | null>(null)
  const codeInput = useRef<HTMLInputElement>(null)
  const detailHeading = useRef<HTMLHeadingElement>(null)
  const sequence = useRef(0)
  const scanner = useRef(createBarcodeScanner<ScanSnapshot>())
  const current = useRef({ draft, category })
  current.current = { draft, category }
  const preview = prepareInventoryAdjustment(state, draft)
  const canConfirm =
    preview.valid &&
    !(draft.tipo === "entrada" && invalidDates.size) &&
    !pending
  const visible = prioritizedProducts(
    state.productos,
    draft.items.map((row) => row.productoId),
    (product) =>
      (!category || product.categoriaId === Number(category)) &&
      matchesProductCode(product, state.paquetes, code),
  )
  const originName =
    almacenes.find((item) => item.id === draft.almacenId)?.nombre ??
    "Origen no disponible"
  const scanHandler = useRef(
    (_code: string, _draft: InventoryAdjustmentDraft) => {},
  )
  scanHandler.current = (value, previous) => {
    setCode("")
    const product = resolveProductCode(state, value)
    if (!product) {
      setDraft(previous)
      setNotice("")
      setError("Código no encontrado: " + (value.trim() || "vacío") + ".")
      codeInput.current?.focus()
      return
    }
    setDraft(
      previous.items.some((row) => row.productoId === product.id)
        ? previous
        : {
            ...previous,
            items: [
              ...previous.items,
              {
                productoId: product.id,
                presentacion: "unidad",
                cantidad: "1",
                fechaVencimiento: "",
              },
            ],
          },
    )
    setError("")
    sequence.current += 1
    setNotice(
      product.nombre + " seleccionado · lectura " + sequence.current + ".",
    )
    requestAnimationFrame(() => {
      codeInput.current?.focus({ preventScroll: true })
      document
        .getElementById("adjust-product-" + product.id)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" })
    })
  }
  useEffect(() => {
    if (step === 1) codeInput.current?.focus()
    else detailHeading.current?.focus()
  }, [step])
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
        return { ...current.current, field, value: field?.value ?? "" }
      })
      if (!result) return
      event.preventDefault()
      event.stopPropagation()
      if (result.snapshot.field?.isConnected)
        result.snapshot.field.value = result.snapshot.value
      setCategory(result.snapshot.category)
      scanHandler.current(result.code, result.snapshot.draft)
    }
    window.addEventListener("keydown", keydown, true)
    return () => {
      window.removeEventListener("keydown", keydown, true)
      reader.clear()
    }
  }, [step])
  useEffect(() => {
    if (attempt.current === null || feedback.intento <= attempt.current) return
    attempt.current = null
    setPending(false)
    if (feedback.error || feedback.ajusteId === null)
      setError(feedback.error || "No se pudo registrar el ajuste.")
    else onSuccess(draft.almacenId, feedback.ajusteId)
  }, [feedback, onSuccess, draft.almacenId])
  function remove(productoId: number) {
    setDraft((previous) => ({
      ...previous,
      items: previous.items.filter((row) => row.productoId !== productoId),
    }))
    setInvalidDates((previous) => {
      const next = new Set(previous)
      next.delete(productoId)
      return next
    })
    setError("")
    setNotice("")
    requestAnimationFrame(() =>
      step === 2 ? detailHeading.current?.focus() : codeInput.current?.focus(),
    )
  }
  function toggle(productoId: number) {
    if (draft.items.some((row) => row.productoId === productoId))
      remove(productoId)
    else {
      setDraft((previous) => ({
        ...previous,
        items: [
          ...previous.items,
          {
            productoId,
            presentacion: "unidad",
            cantidad: "1",
            fechaVencimiento: "",
          },
        ],
      }))
      setError("")
      setNotice("")
    }
  }
  function update(
    productoId: number,
    data: Partial<InventoryAdjustmentItemDraft>,
    invalidDate = false,
  ) {
    setDraft((previous) => ({
      ...previous,
      items: previous.items.map((row) =>
        row.productoId === productoId ? { ...row, ...data } : row,
      ),
    }))
    if ("fechaVencimiento" in data)
      setInvalidDates((previous) => {
        const next = new Set(previous)
        if (invalidDate) next.add(productoId)
        else next.delete(productoId)
        return next
      })
    setError("")
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (attempt.current !== null) return
    if (step === 1) {
      if (
        draft.items.length &&
        almacenes.some((item) => item.id === draft.almacenId)
      ) {
        setStep(2)
        setError("")
      }
      return
    }
    if (!canConfirm) {
      setError(
        "Revisa las cantidades, el vencimiento y el stock de todos los productos.",
      )
      return
    }
    attempt.current = feedback.intento
    setPending(true)
    setError("")
    try {
      onSave(draft)
    } catch (cause) {
      attempt.current = null
      setPending(false)
      setError(
        cause instanceof Error
          ? cause.message
          : "No se pudo registrar el ajuste.",
      )
    }
  }
  return (
    <ModalShell
      title={step === 1 ? "Seleccionar productos" : "Detalle del ajuste"}
      description={
        "Paso " +
        step +
        " de 2 · " +
        (step === 1
          ? "Selecciona productos para ajustar sus existencias."
          : "El ajuste se aplicará en " + originName + ".")
      }
      size="sale"
      onClose={onClose}
      restoreFocusSelector="#inventory-adjust-trigger"
    >
      <form onSubmit={submit} noValidate>
        {step === 1 ? (
          <>
            <div className="adjustment-filters">
              <label className="purchase-field" htmlFor="adjust-code">
                <span>Código</span>
                <input
                  ref={codeInput}
                  id="adjust-code"
                  autoComplete="off"
                  maxLength={128}
                  placeholder="Código de producto o paquete"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault()
                      event.stopPropagation()
                      scanHandler.current(code, draft)
                    }
                  }}
                />
              </label>
              <label className="purchase-field" htmlFor="adjust-category">
                <span>Seleccionar categoría</span>
                <select
                  id="adjust-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                >
                  <option value="">Todas las categorías</option>
                  {state.categorias.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <label className="purchase-field" htmlFor="adjust-origin">
                <span>Seleccionar origen</span>
                <select
                  id="adjust-origin"
                  value={draft.almacenId}
                  onChange={(event) => {
                    setDraft((previous) => ({
                      ...previous,
                      almacenId: Number(event.target.value),
                    }))
                    setError("")
                  }}
                >
                  {almacenes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.nombre}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {notice && (
              <p className="purchase-scan-notice" role="status">
                ✓ {notice}
              </p>
            )}
            <p className="sale-selection-summary" role="status">
              {draft.items.length} productos seleccionados · Stock físico en{" "}
              {originName}
            </p>
            <div className="purchase-product-grid">
              {visible.map((product) => {
                const selected = draft.items.some(
                  (row) => row.productoId === product.id,
                )
                const stock =
                  state.existencias.find(
                    (item) =>
                      item.productoId === product.id &&
                      item.almacenId === draft.almacenId,
                  )?.stock ?? 0
                return (
                  <button
                    type="button"
                    key={product.id}
                    id={"adjust-product-" + product.id}
                    aria-pressed={selected}
                    className={
                      "purchase-product-card" + (selected ? " is-selected" : "")
                    }
                    onClick={() => toggle(product.id)}
                  >
                    <span className="purchase-product-top">
                      <strong>{product.nombre}</strong>
                      <span aria-hidden="true">{selected ? "✓" : "+"}</span>
                    </span>
                    <span className="purchase-product-code">
                      {product.codigo_barra}
                    </span>
                    <span>Unidad: {formatMoney(product.precio_unitario)}</span>
                    <span>
                      {product.paqueteId === null
                        ? "Sin paquete"
                        : product.precio_paquete === null
                          ? "Precio de paquete no definido"
                          : "Paquete: " + formatMoney(product.precio_paquete)}
                    </span>
                    <span className="adjustment-card-stock">
                      {stock} unidades físicas
                    </span>
                  </button>
                )
              })}
            </div>
            {!visible.length && (
              <p className="details-empty">
                No hay productos que coincidan con los filtros.
              </p>
            )}
          </>
        ) : (
          <>
            <h3 ref={detailHeading} tabIndex={-1} className="sale-step-heading">
              Productos del ajuste · {originName}
            </h3>
            <fieldset className="adjustment-movement" disabled={pending}>
              <legend>Tipo de movimiento</legend>
              {(["entrada", "salida"] as const).map((tipo) => (
                <label
                  key={tipo}
                  className={draft.tipo === tipo ? "is-active" : ""}
                >
                  <input
                    type="radio"
                    name="adjust-type"
                    value={tipo}
                    checked={draft.tipo === tipo}
                    onChange={() => {
                      setDraft((previous) => ({ ...previous, tipo }))
                      setError("")
                    }}
                  />
                  {tipo === "entrada" ? "Entrada" : "Salida"}
                </label>
              ))}
            </fieldset>
            <div className="adjustment-table-wrap">
              <table className="adjustment-table">
                <caption className="sr-only">
                  Productos, presentación y cantidades del ajuste
                </caption>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Unidad</th>
                    <th>Paquete</th>
                    <th>Cantidad</th>
                    {draft.tipo === "entrada" && <th>Vencimiento</th>}
                    <th>
                      <span className="sr-only">Eliminar</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {draft.items.map((item, index) => {
                    const product = state.productos.find(
                      (product) => product.id === item.productoId,
                    )
                    const size = state.paquetes.find(
                      (pack) => pack.id === product?.paqueteId,
                    )?.cantidad_unitaria
                    const row = preview.rows[index]
                    const issue =
                      preview.issues[item.productoId] ||
                      (draft.tipo === "entrada" &&
                      invalidDates.has(item.productoId)
                        ? "Introduce una fecha válida o déjala vacía."
                        : "")
                    return (
                      <tr key={item.productoId}>
                        <td data-label="Producto">
                          <strong>{row.nombreProducto}</strong>
                          <span className="sale-row-hint">
                            Stock: {row.stock} u. ·{" "}
                            {Number.isSafeInteger(row.unidades) &&
                            row.unidades > 0
                              ? row.unidades + " u. de " + draft.tipo
                              : "Cantidad pendiente"}
                          </span>
                          <span className="sale-row-hint">
                            Stock resultante:{" "}
                            {issue ? "—" : row.stockResultante + " u."}
                          </span>
                          {issue && (
                            <span
                              className="sale-row-error"
                              id={"adjust-issue-" + item.productoId}
                              role="alert"
                            >
                              {issue}
                            </span>
                          )}
                        </td>
                        {(["unidad", "paquete"] as const).map(
                          (presentation) => (
                            <td
                              data-label={
                                presentation === "unidad" ? "Unidad" : "Paquete"
                              }
                              key={presentation}
                            >
                              <input
                                type="radio"
                                name={"adjust-presentation-" + item.productoId}
                                aria-label={
                                  (presentation === "unidad"
                                    ? "Unidad"
                                    : "Paquete") +
                                  " para " +
                                  row.nombreProducto
                                }
                                checked={item.presentacion === presentation}
                                disabled={
                                  pending ||
                                  (presentation === "paquete" &&
                                    (!size ||
                                      !Number.isSafeInteger(size) ||
                                      size <= 0))
                                }
                                onChange={() =>
                                  update(item.productoId, {
                                    presentacion: presentation,
                                  })
                                }
                              />
                              {presentation === "paquete" && (
                                <span className="sale-row-hint">
                                  {size && size > 0
                                    ? size + " u."
                                    : "No disponible"}
                                </span>
                              )}
                            </td>
                          ),
                        )}
                        <td data-label="Cantidad">
                          <input
                            className="sale-quantity"
                            type="number"
                            min="1"
                            step="1"
                            inputMode="numeric"
                            aria-label={"Cantidad para " + row.nombreProducto}
                            aria-invalid={!!issue}
                            aria-describedby={
                              issue
                                ? "adjust-issue-" + item.productoId
                                : undefined
                            }
                            disabled={pending}
                            value={item.cantidad}
                            onChange={(event) =>
                              update(item.productoId, {
                                cantidad: event.target.value,
                              })
                            }
                          />
                        </td>
                        {draft.tipo === "entrada" && (
                          <td data-label="Vencimiento">
                            <input
                              className="adjustment-expiration"
                              type="date"
                              min="0001-01-01"
                              max="9999-12-31"
                              aria-label={
                                "Vencimiento opcional para " +
                                row.nombreProducto
                              }
                              disabled={pending}
                              value={item.fechaVencimiento}
                              onChange={(event) =>
                                update(
                                  item.productoId,
                                  { fechaVencimiento: event.target.value },
                                  !event.target.validity.valid,
                                )
                              }
                              onInput={(event) =>
                                update(
                                  item.productoId,
                                  {
                                    fechaVencimiento: event.currentTarget.value,
                                  },
                                  !event.currentTarget.validity.valid,
                                )
                              }
                            />
                            <span className="sale-row-hint">
                              Opcional · vacío: sin caducidad
                            </span>
                          </td>
                        )}
                        <td data-label="Acción">
                          <button
                            type="button"
                            className="details-icon-button details-annul"
                            aria-label={"Quitar " + row.nombreProducto}
                            disabled={pending}
                            onClick={() => remove(item.productoId)}
                          >
                            <Icon name="trash" className="size-4" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {!draft.items.length && (
              <p className="details-empty">
                El ajuste está vacío. Regresa al paso anterior para seleccionar
                productos.
              </p>
            )}
            {preview.error && (
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
          <span className="sale-footer-count">
            {draft.items.length} productos seleccionados
          </span>
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
                type="button"
                className="purchase-button purchase-button-secondary"
                disabled={pending}
                onClick={() => {
                  setStep(1)
                  setError("")
                  setNotice("")
                }}
              >
                Anterior
              </button>
            )}
            <button
              type="submit"
              className="purchase-button purchase-button-primary"
              disabled={step === 1 ? !draft.items.length : !canConfirm}
            >
              {step === 1
                ? "Siguiente"
                : pending
                  ? "Confirmando…"
                  : "Confirmar"}
            </button>
          </div>
        </footer>
      </form>
    </ModalShell>
  )
}
