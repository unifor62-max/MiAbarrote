import { useId, useState, type FormEvent } from "react"
import ModalShell from "../purchases/ModalShell"
import { parseStockMinimum, type InventoryProduct } from "./inventory"

export default function MinimumModal({
  product,
  onSave,
  onClose,
}: {
  product: InventoryProduct
  onSave: (productoId: number, almacenId: number, minimum: number) => void
  onClose: () => void
}) {
  const id = useId()
  const [value, setValue] = useState(String(product.minimum))
  const [error, setError] = useState("")

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const minimum = parseStockMinimum(value)
    if (minimum === null) {
      setError("Ingresa un número entero mayor o igual a cero.")
      return
    }
    try {
      onSave(product.id, product.almacenId, minimum)
      onClose()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No se pudo guardar el mínimo.",
      )
    }
  }

  return (
    <ModalShell
      title="Editar stock mínimo"
      description={`${product.name} · ${product.code}`}
      size="name"
      onClose={onClose}
      restoreFocusSelector="#inventory-low-stock-toggle"
    >
      <form onSubmit={submit} noValidate>
        <label className="purchase-field" htmlFor={id}>
          <span>Cantidad mínima en unidades totales</span>
          <input
            id={id}
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            required
            value={value}
            aria-invalid={Boolean(error)}
            aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
            onChange={(event) => {
              setValue(event.target.value)
              setError("")
            }}
          />
        </label>
        <p id={`${id}-help`} className="minimum-help">
          Se genera una alerta cuando el stock total es menor o igual a este
          mínimo.
        </p>
        {error && (
          <p id={`${id}-error`} className="purchase-error" role="alert">
            {error}
          </p>
        )}
        <footer className="purchase-modal-footer catalog-modal-footer">
          <div className="purchase-footer-actions">
            <button
              type="button"
              className="purchase-button purchase-button-secondary"
              onClick={onClose}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="purchase-button purchase-button-primary"
            >
              Guardar
            </button>
          </div>
        </footer>
      </form>
    </ModalShell>
  )
}
