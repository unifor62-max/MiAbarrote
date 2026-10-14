import { useEffect, useState, type FormEvent } from "react"
import ModalShell from "../purchases/ModalShell"
import { getPaymentListener } from "./PaymentWebhookListener"

export default function PaymentConnection() {
  const listener = getPaymentListener()
  const [status, setStatus] = useState(listener.getStatus())
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => listener.subscribeStatus(setStatus), [listener])
  async function connect(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError("")
    try {
      await listener.connect(key)
      setKey("")
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo conectar.")
    } finally {
      setBusy(false)
    }
  }
  if (listener.mode === "demo")
    return (
      <span className="payment-connection-status">
        Modo demostración · pagos simulados
      </span>
    )
  return (
    <>
      <div className="payment-connection">
        <span className="payment-connection-status" role="status">
          {status.message}
        </span>
        <button
          type="button"
          className="purchase-button purchase-button-secondary"
          onClick={() => setOpen(true)}
        >
          {status.connected ? "Reconectar pagos" : "Conectar pagos"}
        </button>
      </div>
      {open && (
        <ModalShell
          title="Conectar pagos"
          description="Introduce la clave privada de esta caja para recibir las notificaciones QR."
          size="name"
          onClose={() => {
            if (!busy) {
              setOpen(false)
              setKey("")
              setError("")
            }
          }}
        >
          <form onSubmit={connect}>
            <label className="purchase-field">
              <span>Clave de caja</span>
              <input
                type="password"
                autoComplete="off"
                value={key}
                required
                disabled={busy}
                onChange={(event) => setKey(event.target.value)}
              />
            </label>
            {error && (
              <p className="purchase-error" role="alert">
                {error}
              </p>
            )}
            <footer className="purchase-modal-footer">
              <button
                type="submit"
                className="purchase-button purchase-button-primary"
                disabled={busy}
              >
                {busy ? "Conectando…" : "Conectar"}
              </button>
            </footer>
          </form>
        </ModalShell>
      )}
    </>
  )
}
