import { useEffect, useState } from "react"
import { getPaymentListener } from "./PaymentWebhookListener"

export default function PaymentConnection() {
  const listener = getPaymentListener()
  const [status, setStatus] = useState(listener.getStatus())
  useEffect(() => listener.subscribeStatus(setStatus), [listener])
  return (
    <span className="payment-connection-status" role="status">
      {listener.mode === "demo"
        ? "Modo demostración · pagos simulados"
        : status.message}
    </span>
  )
}
