import { useId, useRef, useState, type FormEvent } from "react"
import { prepareSupplier, type ProveedorDraft } from "../../data/purchases"
import ModalShell from "./ModalShell"

export default function SupplierModal({
  supplier,
  onClose,
  onSave,
}: {
  supplier?: ProveedorDraft
  onClose: () => void
  onSave: (draft: ProveedorDraft) => void
}) {
  const id = useId()
  const submitting = useRef(false)
  const [draft, setDraft] = useState<ProveedorDraft>(() =>
    supplier
      ? { nombre: supplier.nombre, telefono: supplier.telefono }
      : { nombre: "", telefono: "" },
  )
  const [error, setError] = useState("")

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    const data = prepareSupplier(draft)
    if (!data) {
      setError("Ingresa un nombre de hasta 120 caracteres y un teléfono.")
      return
    }
    submitting.current = true
    try {
      onSave(data)
    } catch {
      submitting.current = false
      setError("No se pudo guardar el proveedor. Revisa los datos.")
    }
  }

  return (
    <ModalShell
      title={supplier ? "Editar proveedor" : "Nuevo proveedor"}
      description="Completa el nombre y teléfono de contacto del proveedor."
      size="name"
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="catalog-fields">
          <label className="purchase-field" htmlFor={`${id}-name`}>
            <span>Nombre</span>
            <input
              id={`${id}-name`}
              required
              maxLength={120}
              autoComplete="organization"
              value={draft.nombre}
              onChange={(event) => {
                setDraft((previous) => ({
                  ...previous,
                  nombre: event.target.value,
                }))
                setError("")
              }}
            />
          </label>
          <label className="purchase-field" htmlFor={`${id}-phone`}>
            <span>Teléfono</span>
            <input
              id={`${id}-phone`}
              required
              type="tel"
              autoComplete="tel"
              placeholder="Ej. +591 7012 3401"
              value={draft.telefono}
              onChange={(event) => {
                setDraft((previous) => ({
                  ...previous,
                  telefono: event.target.value,
                }))
                setError("")
              }}
            />
          </label>
        </div>
        {error && (
          <p className="purchase-error" role="alert">
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
              disabled={!prepareSupplier(draft)}
            >
              Guardar
            </button>
          </div>
        </footer>
      </form>
    </ModalShell>
  )
}
