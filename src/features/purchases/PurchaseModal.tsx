import { useEffect, useId, useRef, useState, type FormEvent } from "react"
import ModalShell from "./ModalShell"
import Icon from "../../components/Icon"
import { createBarcodeScanner } from "./barcodeScanner"
import { matchesProductCode, prioritizedProducts } from "./productSelection"
import {
  almacenes,
  formatMoney,
  preparePurchaseBatch,
  purchaseItemSubtotal,
  resolveProductCode,
  validExpiration,
  type Producto,
  type PurchaseDraft,
  type PurchaseItemDraft,
  type PurchaseFeedback,
  type PurchaseState,
} from "../../data/purchases"

interface ScanSnapshot {
  draft: PurchaseDraft
  field: HTMLInputElement | HTMLSelectElement | null
  value: string
}

export default function PurchaseModal({
  state,
  feedback,
  onClose,
  onSave,
  onSuccess,
}: {
  state: PurchaseState
  feedback: PurchaseFeedback
  onClose: () => void
  onSave: (draft: PurchaseDraft) => void
  onSuccess: (totalCentavos: number) => void
}) {
  const id = useId()
  const [step, setStep] = useState<1 | 2>(1)
  const [code, setCode] = useState("")
  const [category, setCategory] = useState("")
  const [draft, setDraft] = useState<PurchaseDraft>({
    almacenId: "",
    proveedorId: "",
    items: [],
  })
  const [expanded, setExpanded] = useState(new Set<string>())
  const [invalidDates, setInvalidDates] = useState(new Set<string>())
  const [error, setError] = useState("")
  const [scanNotice, setScanNotice] = useState("")
  const [pending, setPending] = useState(false)
  const attempt = useRef<number | null>(null)
  const submittedTotal = useRef(0)
  const codeInput = useRef<HTMLInputElement>(null)
  const nextButton = useRef<HTMLButtonElement>(null)
  const destination = useRef<HTMLSelectElement>(null)
  const noticeSequence = useRef(0)
  const scanner = useRef(createBarcodeScanner<ScanSnapshot>())
  const current = useRef({ state, draft, step, pending })
  current.current = { state, draft, step, pending }
  const prepared = preparePurchaseBatch(state, draft)
  const sum = draft.items.reduce(
    (total, item) => total + (purchaseItemSubtotal(item) ?? 0),
    0,
  )
  const safeTotal = Number.isSafeInteger(sum)
  const total = safeTotal ? sum : 0
  const canBuy = !!prepared && invalidDates.size === 0 && !pending
  const filtered = prioritizedProducts(
    state.productos,
    draft.items.map((item) => Number(item.productoId)),
    (item) =>
      (!category || item.categoriaId === Number(category)) &&
      matchesProductCode(item, state.paquetes, code),
  )

  function addProduct(selected: Producto, previous: PurchaseDraft) {
    if (previous.items.some((item) => item.productoId === String(selected.id)))
      return
    const productId = String(selected.id)
    setDraft({
      ...previous,
      items: [
        ...previous.items,
        {
          productoId: productId,
          categoriaId: String(selected.categoriaId),
          cantidadPaquetes: "1",
          costoPaquete: "",
          fechaVencimiento: "",
        },
      ],
    })
    setExpanded((previous) => new Set(previous).add(productId))
    setError("")
  }
  function toggleProduct(selected: Producto) {
    const productId = String(selected.id)
    if (!draft.items.some((item) => item.productoId === productId))
      addProduct(selected, draft)
    else {
      setDraft((previous) => ({
        ...previous,
        items: previous.items.filter((item) => item.productoId !== productId),
      }))
      setExpanded((previous) => {
        const next = new Set(previous)
        next.delete(productId)
        return next
      })
      setInvalidDates((previous) => {
        const next = new Set(previous)
        next.delete(productId)
        return next
      })
    }
    setScanNotice("")
    setError("")
  }
  const scanHandler = useRef((_value: string, _previous: PurchaseDraft) => {})
  scanHandler.current = (value, previous) => {
    setCode("")
    const selected = resolveProductCode(current.current.state, value)
    if (!selected) {
      setDraft({ ...previous })
      setScanNotice("")
      setError("Código no encontrado: " + (value.trim() || "vacío") + ".")
      return
    }
    // A repeated scan confirms selection without duplicating or toggling the item.
    addProduct(selected, previous)
    setError("")
    noticeSequence.current += 1
    setScanNotice(
      selected.nombre +
        " seleccionado · lectura " +
        noticeSequence.current +
        ".",
    )
    requestAnimationFrame(() => {
      codeInput.current?.focus({ preventScroll: true })
      document
        .getElementById(id + "-product-" + selected.id)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" })
    })
  }

  useEffect(() => {
    if (step === 1) codeInput.current?.focus()
    else destination.current?.focus()
  }, [step])

  useEffect(() => {
    const reader = scanner.current
    reader.clear()
    if (step !== 1) return
    function keydown(event: KeyboardEvent) {
      if (current.current.pending || current.current.step !== 1) return
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
        return {
          draft: current.current.draft,
          field,
          value: field?.value ?? "",
        }
      })
      if (!result) return
      event.preventDefault()
      event.stopPropagation()
      if (result.snapshot.field?.isConnected)
        result.snapshot.field.value = result.snapshot.value
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
    if (feedback.error || feedback.compraId === null)
      setError(feedback.error || "No se pudo registrar la compra.")
    else onSuccess(submittedTotal.current)
  }, [feedback, onSuccess])

  function updateHeader(key: "almacenId" | "proveedorId", value: string) {
    setDraft((previous) => ({ ...previous, [key]: value }))
    setError("")
  }
  function updateItem(
    productId: string,
    key: keyof PurchaseItemDraft,
    value: string,
    invalidDate = false,
  ) {
    setDraft((previous) => ({
      ...previous,
      items: previous.items.map((item) =>
        item.productoId === productId ? { ...item, [key]: value } : item,
      ),
    }))
    if (key === "fechaVencimiento")
      setInvalidDates((previous) => {
        const next = new Set(previous)
        if (invalidDate) next.add(productId)
        else next.delete(productId)
        return next
      })
    setError("")
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (attempt.current !== null) return
    if (step === 1) {
      if (draft.items.length) {
        setStep(2)
        setError("")
      }
      return
    }
    const valid = preparePurchaseBatch(state, draft)
    const invalidItem = draft.items.find(
      (item) =>
        purchaseItemSubtotal(item) === null ||
        !validExpiration(item.fechaVencimiento) ||
        invalidDates.has(item.productoId),
    )
    if (!valid || invalidItem) {
      setError(
        "Selecciona destino y proveedor y completa los datos de todos los productos. El vencimiento es opcional.",
      )
      if (invalidItem) {
        setExpanded((previous) => new Set(previous).add(invalidItem.productoId))
        requestAnimationFrame(() =>
          document
            .getElementById(id + "-" + invalidItem.productoId + "-quantity")
            ?.focus(),
        )
      }
      return
    }
    attempt.current = feedback.intento
    submittedTotal.current = valid.total
    setPending(true)
    try {
      onSave(draft)
    } catch {
      attempt.current = null
      setPending(false)
      setError("No se pudo registrar la compra. Inténtalo de nuevo.")
    }
  }

  return (
    <ModalShell
      title={step === 1 ? "Seleccionar productos" : "Datos de entrada"}
      description={
        "Paso " +
        step +
        " de 2 · " +
        (step === 1
          ? "Selecciona uno o más productos o escanea sus códigos."
          : "Selecciona destino y proveedor y completa los datos de cada producto.")
      }
      onClose={onClose}
      restoreFocusSelector="#register-purchase-trigger"
    >
      <form onSubmit={submit} noValidate>
        {step === 1 ? (
          <>
            <div className="purchase-scanner-row">
              <label className="purchase-field" htmlFor={id + "-code"}>
                <span>Código</span>
                <input
                  ref={codeInput}
                  id={id + "-code"}
                  autoComplete="off"
                  maxLength={128}
                  placeholder="Ej. DEMO-000001 o PACK-000001"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || event.nativeEvent.isComposing)
                      return
                    event.preventDefault()
                    event.stopPropagation()
                    scanHandler.current(code, draft)
                  }}
                />
              </label>
              <button
                type="button"
                className="purchase-button purchase-button-secondary"
                disabled={!code.trim()}
                onClick={() => scanHandler.current(code, draft)}
              >
                Buscar
              </button>
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
            <label className="purchase-field" htmlFor={id + "-category"}>
              <span>Seleccionar categoría</span>
              <select
                id={id + "-category"}
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
            <div className="purchase-product-grid">
              {filtered.map((item) => {
                const selected = draft.items.some(
                  (row) => row.productoId === String(item.id),
                )
                return (
                  <button
                    type="button"
                    key={item.id}
                    id={id + "-product-" + item.id}
                    className={
                      "purchase-product-card" + (selected ? " is-selected" : "")
                    }
                    aria-pressed={selected}
                    onClick={() => toggleProduct(item)}
                  >
                    <span className="purchase-product-top">
                      <strong>{item.nombre}</strong>
                      <span aria-hidden="true">{selected ? "✓" : "+"}</span>
                    </span>
                    <span className="purchase-product-code">
                      {item.codigo_barra}
                    </span>
                    <span>Unidad: {formatMoney(item.precio_unitario)}</span>
                    <span>
                      {item.paqueteId === null
                        ? "Sin paquete"
                        : item.precio_paquete === null
                          ? "Precio por paquete no definido"
                          : "Paquete: " + formatMoney(item.precio_paquete)}
                    </span>
                  </button>
                )
              })}
            </div>
            {!filtered.length && (
              <p className="catalog-empty" role="status">
                No hay productos que coincidan con el código y la categoría.
              </p>
            )}
            <p className="catalog-hint purchase-selection-hint" role="status">
              {draft.items.length
                ? draft.items.length +
                  (draft.items.length === 1
                    ? " producto seleccionado"
                    : " productos seleccionados")
                : "Selecciona al menos un producto para continuar."}
            </p>
          </>
        ) : (
          <>
            <div className="purchase-destination-grid">
              <label className="purchase-field" htmlFor={id + "-destination"}>
                <span>Seleccionar destino</span>
                <select
                  ref={destination}
                  id={id + "-destination"}
                  value={draft.almacenId}
                  disabled={pending}
                  onChange={(event) =>
                    updateHeader("almacenId", event.target.value)
                  }
                >
                  <option value="">Seleccionar destino</option>
                  {almacenes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <label className="purchase-field" htmlFor={id + "-supplier"}>
                <span>Seleccionar proveedor</span>
                <select
                  id={id + "-supplier"}
                  value={draft.proveedorId}
                  disabled={pending}
                  onChange={(event) =>
                    updateHeader("proveedorId", event.target.value)
                  }
                >
                  <option value="">Seleccionar proveedor</option>
                  {state.proveedores.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.nombre}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="purchase-accordion-list">
              {draft.items.map((item) => {
                const product = state.productos.find(
                  (product) => product.id === Number(item.productoId),
                )
                const pack = state.paquetes.find(
                  (pack) => pack.id === product?.paqueteId,
                )
                const unitMode = pack?.cantidad_unitaria == null
                const open = expanded.has(item.productoId)
                const itemId = id + "-" + item.productoId
                const subtotal = purchaseItemSubtotal(item)
                const units =
                  subtotal !== null
                    ? Number(item.cantidadPaquetes) *
                      (pack?.cantidad_unitaria ?? 1)
                    : null
                return (
                  <section
                    className={
                      "purchase-line-card" + (open ? " is-expanded" : "")
                    }
                    key={item.productoId}
                  >
                    <h3>
                      <button
                        type="button"
                        id={itemId + "-heading"}
                        className="purchase-line-heading"
                        aria-expanded={open}
                        aria-controls={itemId + "-panel"}
                        disabled={pending}
                        onClick={() =>
                          setExpanded((previous) => {
                            const next = new Set(previous)
                            if (open) next.delete(item.productoId)
                            else next.add(item.productoId)
                            return next
                          })
                        }
                      >
                        <span className="purchase-line-name">
                          <strong>
                            {product?.nombre ?? "Producto no disponible"}
                          </strong>
                          <span>
                            {unitMode
                              ? "Compra por unidades"
                              : (pack?.cantidad_unitaria ?? 0) +
                                " unidades por paquete"}
                          </span>
                        </span>
                        <span className="purchase-line-subtotal">
                          {formatMoney(subtotal ?? 0)}
                        </span>
                        <Icon
                          name="chevron"
                          className="purchase-line-chevron"
                        />
                      </button>
                    </h3>
                    <div
                      id={itemId + "-panel"}
                      className="purchase-line-panel"
                      inert={!open}
                      role="region"
                      aria-labelledby={itemId + "-heading"}
                      aria-hidden={!open}
                    >
                      <div className="purchase-line-clip">
                        <div className="purchase-line-fields">
                          <label
                            className="purchase-field"
                            htmlFor={itemId + "-quantity"}
                          >
                            <span>
                              Cantidad de {unitMode ? "unidades" : "paquetes"}
                            </span>
                            <input
                              id={itemId + "-quantity"}
                              type="number"
                              min="1"
                              step="1"
                              inputMode="numeric"
                              aria-label={
                                "Cantidad de " +
                                (unitMode ? "unidades" : "paquetes") +
                                ": " +
                                product?.nombre
                              }
                              disabled={pending}
                              value={item.cantidadPaquetes}
                              onChange={(event) =>
                                updateItem(
                                  item.productoId,
                                  "cantidadPaquetes",
                                  event.target.value,
                                )
                              }
                            />
                          </label>
                          <label
                            className="purchase-field"
                            htmlFor={itemId + "-cost"}
                          >
                            <span>
                              Costo {unitMode ? "por unidad" : "del paquete"}{" "}
                              (Bs)
                            </span>
                            <input
                              id={itemId + "-cost"}
                              type="number"
                              min="0.01"
                              step="0.01"
                              inputMode="decimal"
                              placeholder="0,00"
                              aria-label={
                                "Costo " +
                                (unitMode ? "por unidad" : "del paquete") +
                                " (Bs): " +
                                product?.nombre
                              }
                              disabled={pending}
                              value={item.costoPaquete}
                              onChange={(event) =>
                                updateItem(
                                  item.productoId,
                                  "costoPaquete",
                                  event.target.value,
                                )
                              }
                            />
                          </label>
                          <label
                            className="purchase-field"
                            htmlFor={itemId + "-expiration"}
                          >
                            <span>Fecha de vencimiento (opcional)</span>
                            <input
                              id={itemId + "-expiration"}
                              type="date"
                              aria-invalid={invalidDates.has(item.productoId)}
                              aria-describedby={
                                invalidDates.has(item.productoId)
                                  ? itemId + "-date-error"
                                  : undefined
                              }
                              min="0001-01-01"
                              max="9999-12-31"
                              aria-label={
                                "Fecha de vencimiento (opcional): " +
                                product?.nombre
                              }
                              disabled={pending}
                              value={item.fechaVencimiento}
                              onChange={(event) =>
                                updateItem(
                                  item.productoId,
                                  "fechaVencimiento",
                                  event.target.value,
                                  !event.target.validity.valid,
                                )
                              }
                              onInput={(event) =>
                                updateItem(
                                  item.productoId,
                                  "fechaVencimiento",
                                  event.currentTarget.value,
                                  !event.currentTarget.validity.valid,
                                )
                              }
                            />
                          </label>
                        </div>
                        <div className="purchase-line-footnote">
                          {invalidDates.has(item.productoId) && (
                            <span id={itemId + "-date-error"} role="alert">
                              Introduce una fecha válida o borra el campo.
                            </span>
                          )}
                          <span>
                            {units === null
                              ? "Completa la cantidad y el costo."
                              : units + " unidades ingresadas"}
                          </span>
                          <span>
                            Subtotal:{" "}
                            <strong>{formatMoney(subtotal ?? 0)}</strong>
                          </span>
                        </div>
                      </div>
                    </div>
                  </section>
                )
              })}
            </div>
          </>
        )}
        {error && (
          <p className="purchase-error" role="alert">
            {error}
          </p>
        )}
        {!safeTotal && (
          <p className="purchase-error" role="alert">
            El total supera el límite permitido.
          </p>
        )}
        <footer className="purchase-modal-footer purchase-wizard-footer">
          {step === 2 && (
            <div>
              <p className="purchase-total-label">Total</p>
              <output className="purchase-total" aria-live="polite">
                {formatMoney(total)}
              </output>
            </div>
          )}
          <div className="purchase-footer-actions">
            {step === 1 ? (
              <>
                <button
                  type="button"
                  className="purchase-button purchase-button-secondary"
                  onClick={onClose}
                >
                  Cancelar
                </button>
                <button
                  ref={nextButton}
                  type="submit"
                  className="purchase-button purchase-button-primary"
                  disabled={!draft.items.length}
                >
                  Siguiente
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="purchase-button purchase-button-secondary"
                  disabled={pending}
                  onClick={() => {
                    setStep(1)
                    setError("")
                    setScanNotice("")
                  }}
                >
                  Anterior
                </button>
                <button
                  type="submit"
                  className="purchase-button purchase-button-primary"
                  disabled={!canBuy}
                >
                  {pending ? "Comprando…" : "Comprar"}
                </button>
              </>
            )}
          </div>
        </footer>
      </form>
    </ModalShell>
  )
}
