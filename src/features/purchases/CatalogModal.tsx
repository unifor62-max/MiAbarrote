import {
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

  function update(key: keyof ProductDraft, value: string) {
    setDraft((previous) => ({ ...previous, [key]: value }))
    setError("")
  }
  function toggle(
    key: "codigoPaqueteActivo" | "precioPaqueteActivo",
    checked: boolean,
  ) {
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
    update(field, event.currentTarget.value)
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
                    id={id + "-barcode"}
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
