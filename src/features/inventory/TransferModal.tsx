import { useEffect, useRef, useState, type FormEvent } from "react"
import Icon from "../../components/Icon"
import {
  almacenes,
  formatMoney,
  resolveProductCode,
  type PurchaseState,
} from "../../data/purchases"
import {
  prepareInventoryTransfer,
  type InventoryTransferDraft,
  type InventoryTransferItemDraft,
  type TransferFeedback,
} from "../../data/inventoryTransfers"
import ModalShell from "../purchases/ModalShell"
import { createBarcodeScanner } from "../purchases/barcodeScanner"
import {
  matchesProductCode,
  prioritizedProducts,
} from "../purchases/productSelection"

interface ScanSnapshot {
  draft: InventoryTransferDraft
  category: string
  field: HTMLInputElement | HTMLSelectElement | null
  value: string
}
export default function TransferModal({
  state,
  feedback,
  onSave,
  onClose,
  onSuccess,
}: {
  state: PurchaseState
  feedback: TransferFeedback
  onSave: (draft: InventoryTransferDraft) => void
  onClose: () => void
  onSuccess: (draft: InventoryTransferDraft) => void
}) {
  const [step, setStep] = useState<1 | 2>(1)
  const [code, setCode] = useState("")
  const [category, setCategory] = useState("")
  const [draft, setDraft] = useState<InventoryTransferDraft>({
    origenId: null,
    destinoId: null,
    items: [],
  })
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [pending, setPending] = useState(false)
  const attempt = useRef<{
    number: number
    draft: InventoryTransferDraft
  } | null>(null)
  const codeInput = useRef<HTMLInputElement>(null)
  const destinationInput = useRef<HTMLSelectElement>(null)
  const scanner = useRef(createBarcodeScanner<ScanSnapshot>())
  const sequence = useRef(0)
  const current = useRef({ draft, category })
  current.current = { draft, category }
  const preview = prepareInventoryTransfer(state, draft)
  const canContinue =
    almacenes.some((item) => item.id === draft.origenId) &&
    draft.items.length > 0
  const visible = prioritizedProducts(
    state.productos,
    draft.items.map((item) => item.productoId),
    (product) =>
      (!category || product.categoriaId === Number(category)) &&
      matchesProductCode(product, state.paquetes, code) &&
      (draft.origenId === null ||
        (state.existencias.find(
          (stock) =>
            stock.productoId === product.id &&
            stock.almacenId === draft.origenId,
        )?.stock ?? 0) > 0),
  )
  const name = (id: number | null) =>
    id === 1
      ? "Tienda"
      : (almacenes.find((item) => item.id === id)?.nombre ?? "Sin seleccionar")
  const scanHandler = useRef(
    (_value: string, _previous: InventoryTransferDraft) => {},
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
    const packageCode = state.paquetes.find(
      (pack) => pack.id === product.paqueteId,
    )?.codigo_barra
    const alreadySelected = previous.items.some(
      (item) => item.productoId === product.id,
    )
    const next: InventoryTransferDraft = alreadySelected
      ? previous
      : {
          ...previous,
          items: [
            ...previous.items,
            {
              productoId: product.id,
              presentacion: value.trim() === packageCode ? "paquete" : "unidad",
              cantidad: "1",
            },
          ],
        }
    current.current = { ...current.current, draft: next }
    setDraft(next)
    setError("")
    sequence.current += 1
    setNotice(
      product.nombre +
        (alreadySelected ? " ya estaba seleccionado" : " seleccionado") +
        " · lectura " +
        sequence.current +
        ".",
    )
    requestAnimationFrame(() =>
      codeInput.current?.focus({ preventScroll: true }),
    )
  }
  useEffect(() => {
    if (step === 1) codeInput.current?.focus()
    else destinationInput.current?.focus()
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
    const saved = attempt.current
    if (!saved || feedback.intento <= saved.number) return
    attempt.current = null
    setPending(false)
    if (feedback.error || feedback.traspasoId === null)
      setError(feedback.error || "No se pudo registrar el traspaso.")
    else onSuccess(saved.draft)
  }, [feedback, onSuccess])
  function remove(productoId: number) {
    setDraft((previous) => ({
      ...previous,
      items: previous.items.filter((item) => item.productoId !== productoId),
    }))
    setError("")
    setNotice("")
    requestAnimationFrame(() =>
      step === 1
        ? codeInput.current?.focus()
        : destinationInput.current?.focus(),
    )
  }
  function toggle(productoId: number) {
    if (draft.items.some((item) => item.productoId === productoId))
      remove(productoId)
    else {
      setDraft((previous) => ({
        ...previous,
        items: [
          ...previous.items,
          { productoId, presentacion: "unidad", cantidad: "1" },
        ],
      }))
      setError("")
      setNotice("")
    }
  }
  function update(
    productoId: number,
    data: Partial<InventoryTransferItemDraft>,
  ) {
    setDraft((previous) => ({
      ...previous,
      items: previous.items.map((item) =>
        item.productoId === productoId ? { ...item, ...data } : item,
      ),
    }))
    setError("")
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (attempt.current) return
    if (step === 1) {
      if (canContinue) {
        setStep(2)
        setError("")
        setNotice("")
      }
      return
    }
    if (!preview.valid) {
      setError(
        preview.error ||
          "Revisa la disponibilidad y las cantidades de los productos.",
      )
      return
    }
    attempt.current = { number: feedback.intento, draft }
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
          : "No se pudo registrar el traspaso.",
      )
    }
  }
  return (
    <ModalShell
      title={
        step === 1 ? "Seleccionar productos" : "Configuración del traspaso"
      }
      description={`Paso ${step} de 2 · ${
        step === 1
          ? "Elige el origen y los productos que deseas mover."
          : "Desde " +
            name(draft.origenId) +
            " · Define el destino y las cantidades."
      }`}
      size="sale"
      className="transfer-dialog"
      onClose={onClose}
      restoreFocusSelector="#inventory-transfer-trigger"
    >
      <form onSubmit={submit} noValidate>
        {step === 1 ? (
          <>
            <div className="transfer-filters">
              <label className="purchase-field" htmlFor="transfer-code">
                <span>Código</span>
                <input
                  ref={codeInput}
                  id="transfer-code"
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
              <label className="purchase-field" htmlFor="transfer-category">
                <span>Seleccionar categoría</span>
                <select
                  id="transfer-category"
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
              <label className="purchase-field" htmlFor="transfer-origin">
                <span>Seleccionar origen</span>
                <select
                  id="transfer-origin"
                  value={draft.origenId ?? ""}
                  onChange={(event) => {
                    const origin = event.target.value
                      ? Number(event.target.value)
                      : null
                    setDraft((previous) => ({
                      ...previous,
                      origenId: origin,
                      destinoId:
                        previous.destinoId === origin
                          ? null
                          : previous.destinoId,
                    }))
                    setError("")
                  }}
                >
                  <option value="">Seleccionar origen</option>
                  {almacenes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {name(item.id)}
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
              {draft.items.length} productos seleccionados ·{" "}
              {draft.origenId === null
                ? "Selecciona un origen para consultar el stock"
                : "Stock físico en " + name(draft.origenId)}
            </p>
            <div className="purchase-product-grid transfer-product-grid">
              {visible.map((product) => {
                const selected = draft.items.some(
                  (item) => item.productoId === product.id,
                )
                const stock =
                  state.existencias.find(
                    (item) =>
                      item.productoId === product.id &&
                      item.almacenId === draft.origenId,
                  )?.stock ?? 0
                return (
                  <button
                    type="button"
                    key={product.id}
                    id={"transfer-product-" + product.id}
                    aria-pressed={selected}
                    className={
                      "purchase-product-card" + (selected ? " is-selected" : "")
                    }
                    onClick={() => toggle(product.id)}
                  >
                    <span className="purchase-product-top">
                      <strong>{product.nombre}</strong>
                      <span
                        className="transfer-selection-check"
                        aria-hidden="true"
                      >
                        {selected ? "✓" : "+"}
                      </span>
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
                      {draft.origenId === null
                        ? "Origen pendiente"
                        : stock + " unidades físicas"}
                    </span>
                    {selected && draft.origenId !== null && stock === 0 && (
                      <span className="sale-row-error">
                        Sin stock en este origen
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            {!visible.length && (
              <p className="details-empty">
                No hay productos con existencias que coincidan con los filtros.
              </p>
            )}
          </>
        ) : (
          <>
            <label
              className="purchase-field transfer-destination"
              htmlFor="transfer-destination"
            >
              <span>Seleccionar destino</span>
              <select
                ref={destinationInput}
                id="transfer-destination"
                value={draft.destinoId ?? ""}
                disabled={pending}
                onChange={(event) => {
                  setDraft((previous) => ({
                    ...previous,
                    destinoId: event.target.value
                      ? Number(event.target.value)
                      : null,
                  }))
                  setError("")
                }}
              >
                <option value="">Seleccionar destino</option>
                {almacenes.map((item) => (
                  <option
                    key={item.id}
                    value={item.id}
                    disabled={item.id === draft.origenId}
                  >
                    {name(item.id)}
                    {item.id === draft.origenId ? " (origen)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <p className="sale-selection-summary">
              {name(draft.origenId)} → {name(draft.destinoId)} ·{" "}
              {draft.items.length} productos
            </p>
            <div className="transfer-table-wrap">
              <table className="transfer-table">
                <caption className="sr-only">
                  Productos, presentación y cantidades del traspaso
                </caption>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Unidad</th>
                    <th>Paquete</th>
                    <th>Cantidad</th>
                    <th>
                      <span className="sr-only">Eliminar</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, index) => {
                    const item = draft.items[index]
                    const product = state.productos.find(
                      (product) => product.id === item.productoId,
                    )
                    const size = state.paquetes.find(
                      (pack) => pack.id === product?.paqueteId,
                    )?.cantidad_unitaria
                    const issue = preview.issues[row.productoId]
                    return (
                      <tr key={row.productoId}>
                        <td data-label="Producto">
                          <strong>{row.nombreProducto}</strong>
                          <span className="sale-row-hint">
                            Stock en origen: {row.stock} u. ·{" "}
                            {Number.isSafeInteger(row.unidades) &&
                            row.unidades > 0
                              ? row.unidades + " u. a trasladar"
                              : "Cantidad pendiente"}
                          </span>
                          {!issue && (
                            <span className="sale-row-hint">
                              Origen restante: {row.stock - row.unidades} u.
                            </span>
                          )}
                          {issue && (
                            <span
                              id={"transfer-issue-" + row.productoId}
                              className="sale-row-error"
                              role="alert"
                            >
                              {issue}
                            </span>
                          )}
                        </td>
                        {(["unidad", "paquete"] as const).map(
                          (presentation) => (
                            <td
                              key={presentation}
                              data-label={
                                presentation === "unidad" ? "Unidad" : "Paquete"
                              }
                            >
                              <input
                                type="radio"
                                name={"transfer-presentation-" + row.productoId}
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
                                  update(row.productoId, {
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
                                ? "transfer-issue-" + row.productoId
                                : undefined
                            }
                            disabled={pending}
                            value={item.cantidad}
                            onChange={(event) =>
                              update(row.productoId, {
                                cantidad: event.target.value,
                              })
                            }
                          />
                        </td>
                        <td data-label="Acción">
                          <button
                            type="button"
                            className="details-icon-button details-annul"
                            aria-label={"Quitar " + row.nombreProducto}
                            disabled={pending}
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
            </div>
            {!draft.items.length && (
              <p className="details-empty">
                No quedan productos. Vuelve al paso anterior para seleccionar
                otros.
              </p>
            )}
            {preview.error && (
              <p className="transfer-validation" role="status">
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
        <footer className="purchase-modal-footer">
          <p className="purchase-total-label">
            {step === 1
              ? "Los productos seleccionados permanecen visibles al filtrar."
              : "Las cantidades se descuentan del origen y se suman al destino."}
          </p>
          <div className="purchase-footer-actions">
            {step === 1 ? (
              <button
                type="button"
                className="purchase-button purchase-button-secondary"
                onClick={onClose}
              >
                Cancelar
              </button>
            ) : (
              <button
                type="button"
                className="purchase-button purchase-button-secondary"
                disabled={pending}
                onClick={() => {
                  setStep(1)
                  setError("")
                }}
              >
                Anterior
              </button>
            )}
            <button
              type="submit"
              className="purchase-button purchase-button-primary"
              disabled={step === 1 ? !canContinue : !preview.valid || pending}
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
