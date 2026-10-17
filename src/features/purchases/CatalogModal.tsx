import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react"
import {
  prepareProduct,
  type NamedCatalog,
  type ProductDraft,
  type PurchaseState,
} from "../../data/purchases"
import ModalShell from "./ModalShell"
import PhoneReaderButton, {
  useRemoteScanner,
} from "../scanner/PhoneReaderButton"
import { validScannerCode } from "../../data/remoteScanner"
import { createBarcodeScanner } from "./barcodeScanner"
type CodeField = "codigoBarra" | "codigoPaquete"
interface CatalogScanSnapshot {
  draft: ProductDraft
  field: HTMLInputElement | HTMLSelectElement | null
  value: string
  target: CodeField
}
export type CatalogModalKind = "product" | "category"
const titles = { product: "Nuevo producto", category: "Nueva categoría" }

export default function CatalogModal({
  kind,
  state,
  onClose,
  onProduct,
  onName,
}: {
  kind: CatalogModalKind
  state: PurchaseState
  onClose: () => void
  onProduct: (draft: ProductDraft) => void
  onName: (catalog: NamedCatalog, nombre: string) => void
}) {
  const id = useId()
  const submitting = useRef(false)
  const codeInput = useRef<HTMLInputElement>(null)
  const packageCodeInput = useRef<HTMLInputElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<ProductDraft>({
    codigoBarra: "",
    codigoPaquete: "",
    codigoPaqueteActivo: false,
    precioPaqueteActivo: false,
    categoriaId: "",
    nombre: "",
    cantidadUnitaria: "",
    precioUnitario: "",
    precioPaquete: "",
  })
  const [error, setError] = useState("")
  const [scanNotice, setScanNotice] = useState("")
  const [scanTarget, setScanTarget] = useState<CodeField>("codigoBarra")
  const scanner = useRef(createBarcodeScanner<CatalogScanSnapshot>())
  const current = useRef({ draft, scanTarget })
  current.current = { draft, scanTarget }
  const isProduct = kind === "product"
  const individualCode = draft.codigoBarra.trim()
  const packageCode = draft.codigoPaqueteActivo
    ? (draft.codigoPaquete?.trim() ?? "")
    : ""
  const duplicateCode =
    isProduct &&
    ((individualCode && individualCode === packageCode) ||
      [...state.productos, ...state.paquetes].some(
        (item) =>
          (individualCode && item.codigo_barra === individualCode) ||
          (packageCode && item.codigo_barra === packageCode),
      ))
  const barcodeError = duplicateCode
    ? "Este código ya está asignado. Usa códigos diferentes y únicos para el producto y su paquete."
    : ""
  const valid = isProduct
    ? !!prepareProduct(state, draft)
    : !!draft.nombre.trim() && draft.nombre.trim().length <= 120

  function receiveCode(
    value: string,
    field: CodeField,
    previous: ProductDraft,
  ) {
    const code = value.trim()
    if (!validScannerCode(code)) {
      setError("El código leído no es válido. Vuelve a escanear.")
      return false
    }
    if (field === "codigoPaquete" && !previous.codigoPaqueteActivo) return false
    const other =
      field === "codigoBarra"
        ? previous.codigoPaqueteActivo
          ? previous.codigoPaquete?.trim()
          : ""
        : previous.codigoBarra.trim()
    const duplicate =
      other === code ||
      [...state.productos, ...state.paquetes].some(
        (item) => item.codigo_barra === code,
      )
    setDraft({ ...previous, [field]: code })
    setError("")
    setScanNotice(
      duplicate
        ? ""
        : `Código ${
            field === "codigoBarra" ? "del producto" : "del paquete"
          } leído: ${code}. Completa los datos y pulsa Guardar.`,
    )
    return !duplicate
  }
  useRemoteScanner(
    scanTarget === "codigoPaquete" ? "package" : "product",
    isProduct,
    codeInput,
    (scan) => {
      const accepted = receiveCode(
        scan.code,
        current.current.scanTarget,
        current.current.draft,
      )
      return {
        ...scan,
        outcome: accepted ? "selected" : "unknown",
        message: accepted
          ? "Código recibido. Completa el producto en la computadora y pulsa Guardar."
          : "Código inválido o ya asignado. Revisa el formulario en la computadora.",
      }
    },
  )
  const receive = useRef(receiveCode)
  receive.current = receiveCode
  useEffect(() => {
    if (!isProduct) return
    const reader = scanner.current
    function keydown(event: globalThis.KeyboardEvent) {
      const own = codeInput.current?.closest("dialog")
      const dialogs = document.querySelectorAll("dialog[open]")
      if (
        document.visibilityState !== "visible" ||
        dialogs[dialogs.length - 1] !== own ||
        event.target === codeInput.current ||
        event.target === packageCodeInput.current
      ) {
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
          target: current.current.scanTarget,
        }
      })
      if (!result) return
      event.preventDefault()
      event.stopPropagation()
      if (result.snapshot.field?.isConnected)
        result.snapshot.field.value = result.snapshot.value
      receive.current(
        result.code,
        result.snapshot.target,
        result.snapshot.draft,
      )
    }
    window.addEventListener("keydown", keydown, true)
    return () => {
      window.removeEventListener("keydown", keydown, true)
      reader.clear()
    }
  }, [isProduct, scanTarget])
  function update(key: keyof ProductDraft, value: string) {
    setDraft((previous) => ({ ...previous, [key]: value }))
    setError("")
    setScanNotice("")
  }
  function toggle(
    key: "codigoPaqueteActivo" | "precioPaqueteActivo",
    checked: boolean,
  ) {
    if (key === "codigoPaqueteActivo" && !checked) setScanTarget("codigoBarra")
    setDraft((previous) => ({
      ...previous,
      [key]: checked,
      ...(!checked
        ? key === "codigoPaqueteActivo"
          ? { codigoPaquete: "" }
          : { precioPaquete: "" }
        : {}),
    }))
    setError("")
    setScanNotice("")
  }
  function scanEnter(
    event: KeyboardEvent<HTMLInputElement>,
    field: "codigoBarra" | "codigoPaquete",
  ) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing || event.repeat)
      return
    event.preventDefault()
    event.stopPropagation()
    if (field === "codigoPaquete" && !draft.codigoPaqueteActivo) return
    receiveCode(event.currentTarget.value, field, draft)
    if (field === "codigoBarra" && draft.codigoPaqueteActivo)
      packageCodeInput.current?.focus()
    else nameInput.current?.focus()
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    if (!valid) {
      setError(
        "Revisa los campos obligatorios y los atributos de paquete activados.",
      )
      return
    }
    submitting.current = true
    try {
      if (isProduct) onProduct(draft)
      else onName("categorias", draft.nombre)
    } catch {
      submitting.current = false
      setError("No se pudo guardar. Revisa los datos e inténtalo de nuevo.")
    }
  }
  return (
    <ModalShell
      title={titles[kind]}
      description={
        isProduct
          ? "Completa los datos del producto y activa los atributos de paquete que correspondan."
          : "Ingresa el nombre de la categoría."
      }
      size={isProduct ? "product" : "name"}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        {isProduct && (
          <div className="catalog-scanner">
            <PhoneReaderButton />
            <div
              className="catalog-scan-target"
              role="group"
              aria-label="Destino del código escaneado"
            >
              <button
                type="button"
                className="purchase-button purchase-button-secondary"
                aria-pressed={scanTarget === "codigoBarra"}
                onClick={() => {
                  setScanTarget("codigoBarra")
                  codeInput.current?.focus()
                }}
              >
                Escanear código producto
              </button>
              <button
                type="button"
                className="purchase-button purchase-button-secondary"
                aria-pressed={scanTarget === "codigoPaquete"}
                disabled={!draft.codigoPaqueteActivo}
                onClick={() => {
                  setScanTarget("codigoPaquete")
                  packageCodeInput.current?.focus()
                }}
              >
                Escanear código paquete
              </button>
            </div>
            <p className="catalog-hint">
              Escanea con tu teléfono o lector de barras. El código se coloca en{" "}
              {scanTarget === "codigoBarra"
                ? "Código producto"
                : "Código paquete"}
              . Activa Código paquete para registrar también su envase.
            </p>
            {scanNotice && (
              <p className="purchase-scan-notice" role="status">
                {scanNotice}
              </p>
            )}
          </div>
        )}
        <div className="catalog-fields">
          {isProduct && (
            <>
              <label className="purchase-field" htmlFor={id + "-category"}>
                <span>Seleccionar categoría</span>
                <select
                  id={id + "-category"}
                  required
                  value={draft.categoriaId}
                  onChange={(event) =>
                    update("categoriaId", event.target.value)
                  }
                >
                  <option value="">Seleccionar categoría</option>
                  {state.categorias.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <div className="catalog-pair-grid">
                <label className="purchase-field" htmlFor={id + "-barcode"}>
                  <span>Código producto</span>
                  <input
                    ref={codeInput}
                    id={id + "-barcode"}
                    onFocus={(event) => {
                      setScanTarget("codigoBarra")
                      event.currentTarget.select()
                    }}
                    required
                    autoComplete="off"
                    maxLength={128}
                    value={draft.codigoBarra}
                    onChange={(event) =>
                      update("codigoBarra", event.target.value)
                    }
                    onKeyDown={(event) => scanEnter(event, "codigoBarra")}
                  />
                </label>
                <div className="purchase-field">
                  <div className="catalog-option-label">
                    <label htmlFor={id + "-package-code"}>Código paquete</label>
                    <input
                      type="checkbox"
                      aria-label="Activar código paquete"
                      checked={!!draft.codigoPaqueteActivo}
                      aria-controls={id + "-package-code"}
                      onChange={(event) =>
                        toggle("codigoPaqueteActivo", event.target.checked)
                      }
                    />
                  </div>
                  <input
                    ref={packageCodeInput}
                    onFocus={(event) => {
                      setScanTarget("codigoPaquete")
                      event.currentTarget.select()
                    }}
                    id={id + "-package-code"}
                    autoComplete="off"
                    maxLength={128}
                    required={!!draft.codigoPaqueteActivo}
                    disabled={!draft.codigoPaqueteActivo}
                    value={draft.codigoPaquete}
                    onChange={(event) => {
                      if (draft.codigoPaqueteActivo)
                        update("codigoPaquete", event.target.value)
                    }}
                    onKeyDown={(event) => scanEnter(event, "codigoPaquete")}
                  />
                </div>
              </div>
            </>
          )}
          <label className="purchase-field" htmlFor={id + "-name"}>
            <span>Nombre</span>
            <input
              ref={nameInput}
              id={id + "-name"}
              required
              maxLength={120}
              autoComplete="off"
              value={draft.nombre}
              onChange={(event) => update("nombre", event.target.value)}
            />
          </label>
          {isProduct && (
            <>
              <label className="purchase-field" htmlFor={id + "-quantity"}>
                <span>Cantidad unitaria por paquete (opcional)</span>
                <input
                  id={id + "-quantity"}
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  placeholder="Ej. 12"
                  value={draft.cantidadUnitaria}
                  onChange={(event) =>
                    update("cantidadUnitaria", event.target.value)
                  }
                />
              </label>
              <div className="catalog-pair-grid">
                <label className="purchase-field" htmlFor={id + "-unit"}>
                  <span>Precio unitario (Bs)</span>
                  <input
                    id={id + "-unit"}
                    required
                    type="text"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={draft.precioUnitario}
                    onChange={(event) =>
                      update("precioUnitario", event.target.value)
                    }
                    aria-describedby={id + "-price-hint"}
                  />
                </label>
                <div className="purchase-field">
                  <div className="catalog-option-label">
                    <label htmlFor={id + "-package"}>
                      Precio por paquete (Bs)
                    </label>
                    <input
                      type="checkbox"
                      aria-label="Activar precio por paquete"
                      checked={!!draft.precioPaqueteActivo}
                      aria-controls={id + "-package"}
                      onChange={(event) =>
                        toggle("precioPaqueteActivo", event.target.checked)
                      }
                    />
                  </div>
                  <input
                    id={id + "-package"}
                    required={!!draft.precioPaqueteActivo}
                    disabled={!draft.precioPaqueteActivo}
                    type="text"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={draft.precioPaquete}
                    onChange={(event) => {
                      if (draft.precioPaqueteActivo)
                        update("precioPaquete", event.target.value)
                    }}
                    aria-describedby={id + "-price-hint"}
                  />
                </div>
              </div>
              <p id={id + "-price-hint"} className="catalog-hint">
                Precios positivos con hasta dos decimales (coma o punto). Los
                atributos de paquete desactivados se guardan vacíos.
              </p>
            </>
          )}
        </div>
        {(error || barcodeError) && (
          <p className="purchase-error" role="alert">
            {error || barcodeError}
          </p>
        )}
        <footer className="purchase-modal-footer catalog-modal-footer">
          <div className="purchase-footer-actions">
            <button
              type="submit"
              className="purchase-button purchase-button-primary"
              disabled={!valid}
            >
              Guardar
            </button>
            <button
              type="button"
              className="purchase-button purchase-button-secondary"
              onClick={onClose}
            >
              Cancelar
            </button>
          </div>
        </footer>
      </form>
    </ModalShell>
  )
}
