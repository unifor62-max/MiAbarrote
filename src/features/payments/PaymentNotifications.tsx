import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import Icon from "../../components/Icon"
import { formatMoney } from "../../data/purchases"
import type { PaymentNotification } from "../../data/payments"
import { getPaymentListener } from "./PaymentWebhookListener"

export default function PaymentNotifications() {
  const [queue, setQueue] = useState<PaymentNotification[]>([])
  const popover = useRef<HTMLDivElement>(null)
  const current = queue[0]
  useEffect(
    () =>
      getPaymentListener().subscribe((event) =>
        setQueue((previous) => [...previous, event]),
      ),
    [],
  )
  useEffect(() => {
    if (!current) return
    if (popover.current && !popover.current.matches(":popover-open"))
      popover.current.showPopover?.()
    const timer = setTimeout(
      () => setQueue((previous) => previous.slice(1)),
      7000,
    )
    return () => clearTimeout(timer)
  }, [current])
  if (!current) return null
  return createPortal(
    <div
      ref={popover}
      popover="manual"
      className="payment-toast"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="payment-toast-icon">
        <Icon name="box" />
      </span>
      <div>
        <span className="payment-toast-eyebrow">
          {current.source === "demo"
            ? "Pago QR simulado"
            : "Notificación de pago QR"}
        </span>
        <strong>{current.titular}</strong>
        <span className="payment-toast-amount">
          {formatMoney(current.montoCentavos)}
        </span>
      </div>
      <button
        type="button"
        aria-label="Cerrar notificación de pago"
        onClick={() => setQueue((previous) => previous.slice(1))}
      >
        <Icon name="close" className="size-4" />
      </button>
      {queue.length > 1 && (
        <span className="payment-toast-pending">
          +{queue.length - 1} pendientes
        </span>
      )}
    </div>,
    document.body,
  )
}
