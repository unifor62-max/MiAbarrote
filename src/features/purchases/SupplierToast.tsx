import { useEffect } from "react"
import Icon from "../../components/Icon"

export default function SupplierToast({
  message,
  onClose,
}: {
  message: string
  onClose: () => void
}) {
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(onClose, 4000)
    return () => window.clearTimeout(timer)
  }, [message, onClose])

  return (
    <div
      className="product-toast"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {message && (
        <div>
          <span>{message}</span>
          <button
            type="button"
            className="purchase-close"
            onClick={onClose}
            aria-label="Cerrar confirmación"
          >
            <Icon name="close" />
          </button>
        </div>
      )}
    </div>
  )
}
