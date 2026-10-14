import { useEffect, useRef, useState } from "react"
import {
  cashPayment,
  parsePaymentMoney,
  paymentError,
  paymentInput,
  type PaymentMode,
  type PaymentNotification,
  type SalePaymentDraft,
} from "../../data/payments"
import { formatMoney } from "../../data/purchases"
import { getPaymentListener } from "./PaymentWebhookListener"

export function useSalePayment(
  step: number,
  total: number,
  productsValid: boolean,
) {
  const listener = getPaymentListener()
  const [mode, setMode] = useState<PaymentMode>(3)
  const [qr, setQr] = useState("")
  const [cash, setCash] = useState("")
  const [manual, setManual] = useState(false)
  const [accepted, setAccepted] = useState<PaymentNotification | null>(null)
  const [message, setMessage] = useState("")
  const [processing, setProcessing] = useState(false)
  const [status, setStatus] = useState(listener.getStatus())
  const [healthy, setHealthy] = useState(true)
  const entered = useRef(0)
  const busy = useRef(false)
  const eventRef = useRef<PaymentNotification | null>(null)
  const mounted = useRef(true)
  const consumed = useRef(false)
  const owner = useRef(crypto.randomUUID())
  const commitId = useRef(crypto.randomUUID())
  const current = useRef({ step, total, productsValid, mode })
  current.current = { step, total, productsValid, mode }

  useEffect(() => {
    if (step === 2) entered.current = listener.now()
  }, [step, listener])
  useEffect(() => listener.subscribeStatus(setStatus), [listener])
  useEffect(() => {
    mounted.current = true
    const unsubscribe = listener.subscribe(async (event) => {
      const snapshot = current.current
      if (
        snapshot.step !== 2 ||
        snapshot.mode === 3 ||
        !snapshot.productsValid ||
        busy.current ||
        eventRef.current ||
        event.receivedAt <= entered.current
      )
        return
      if (
        (snapshot.mode === 1 && event.montoCentavos !== snapshot.total) ||
        (snapshot.mode === 2 && event.montoCentavos >= snapshot.total)
      ) {
        setMessage(
          `Discrepancia: se recibieron ${formatMoney(event.montoCentavos)} para un total de ${formatMoney(snapshot.total)}.${
            snapshot.mode === 2
              ? " En Híbrido debe quedar un importe positivo en efectivo."
              : " El importe QR debe ser exactamente igual."
          }`,
        )
        return
      }
      busy.current = true
      setProcessing(true)
      setMessage("")
      try {
        await listener.transition(event, "reserve", owner.current)
        const now = current.current
        if (
          !mounted.current ||
          now.step !== 2 ||
          now.mode !== snapshot.mode ||
          now.total !== snapshot.total ||
          !now.productsValid
        ) {
          await listener.transition(event, "release", owner.current)
          return
        }
        eventRef.current = event
        setAccepted(event)
        setHealthy(true)
        setManual(false)
        setQr(paymentInput(event.montoCentavos))
        setCash(paymentInput(snapshot.total - event.montoCentavos))
      } catch (error) {
        if (mounted.current)
          setMessage(
            error instanceof Error
              ? error.message
              : "No se pudo reservar el pago.",
          )
      } finally {
        busy.current = false
        if (mounted.current) setProcessing(false)
      }
    })
    return () => {
      mounted.current = false
      unsubscribe()
      if (eventRef.current && !consumed.current)
        void listener
          .transition(eventRef.current, "release", owner.current)
          .catch(() => {})
    }
  }, [listener])
  useEffect(() => {
    if (!accepted) return
    let renewing = false
    let active = true
    const timer = setInterval(async () => {
      if (busy.current || renewing) return
      renewing = true
      try {
        await listener.transition(accepted, "reserve", owner.current)
        if (!active) {
          if (!consumed.current) await listener.transition(accepted, "release", owner.current).catch(() => {})
          return
        }
        if (mounted.current) setHealthy(true)
      } catch (error) {
        if (active && mounted.current) {
          setHealthy(false)
          setMessage(
            error instanceof Error
              ? error.message
              : "La reserva necesita reconexión.",
          )
        }
      } finally {
        renewing = false
      }
    }, 60000)
    return () => { active = false; clearInterval(timer) }
  }, [accepted, listener])

  const automaticCash =
    accepted && !manual
      ? Math.max(0, total - accepted.montoCentavos)
      : parsePaymentMoney(cash)
  const payment: SalePaymentDraft =
    mode === 3
      ? cashPayment(total)
      : {
          tipoPagoId: mode,
          detallePago: {
            monto_qr:
              accepted && !manual
                ? accepted.montoCentavos
                : mode === 1 ? 0 : (parsePaymentMoney(qr) ?? NaN),
            monto_efectivo: mode === 1 ? 0 : (automaticCash ?? NaN),
          },
          ...(accepted ? { notificacion: accepted } : {}),
          ...(manual ? { manual: true } : {}),
        }
  const validation = paymentError(payment, total)
  async function clearAssociation() {
    const event = eventRef.current
    if (event && !consumed.current)
      await listener.transition(event, "release", owner.current)
    eventRef.current = null
    setAccepted(null)
    setHealthy(true)
    entered.current = listener.now()
  }
  async function modify(action: () => void) {
    if (busy.current) return
    busy.current = true
    setProcessing(true)
    setMessage("")
    try {
      await clearAssociation()
      action()
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "No se pudo liberar el pago.",
      )
    } finally {
      busy.current = false
      if (mounted.current) setProcessing(false)
    }
  }
  function changeMode(next: PaymentMode) {
    if (next === mode) return
    void modify(() => {
      setMode(next)
      setQr("")
      setCash("")
      setManual(false)
    })
  }
  function editAmount(field: "qr" | "cash", value: string) {
    const apply = () => {
      setManual(true)
      if (field === "qr") {
        setQr(value)
        setCash(accepted && !manual ? paymentInput(automaticCash ?? 0) : cash)
      } else {
        setCash(value)
        setQr(qr)
      }
    }
    if (eventRef.current) void modify(apply)
    else {
      setMessage("")
      apply()
    }
  }
  async function close(onClose: () => void) {
    if (busy.current) return
    busy.current = true
    setProcessing(true)
    try {
      await clearAssociation()
    } catch {
      // A disconnected or expired session must not trap the cashier in the modal.
      // The server lease expires after five minutes even if release cannot reach it.
      eventRef.current = null
    } finally {
      onClose()
      busy.current = false
      if (mounted.current) setProcessing(false)
    }
  }
  async function confirm(
    action: (
      payment: SalePaymentDraft,
      owner: string,
      commitId: string,
    ) => void | Promise<void>,
  ) {
    if (busy.current || validation || !healthy || !productsValid) return
    busy.current = true
    setProcessing(true)
    setMessage("")
    try {
      await action(payment, owner.current, commitId.current)
      consumed.current = true
    } catch (error) {
      if (mounted.current)
        setMessage(
          error instanceof Error
            ? error.message
            : "No se pudo confirmar el pago.",
        )
    } finally {
      busy.current = false
      if (mounted.current) setProcessing(false)
    }
  }
  return {
    mode,
    payment,
    accepted,
    manual,
    processing,
    status,
    listener,
    qr:
      mode === 3
        ? "0.00"
        : mode === 1
          ? paymentInput(accepted?.montoCentavos ?? 0)
          : qr,
    cash:
      mode === 3
        ? paymentInput(total)
        : mode === 1
          ? "0.00"
          : accepted && !manual
            ? paymentInput(automaticCash ?? 0)
            : cash,
    message,
    validation,
    valid: !validation && healthy && productsValid,
    changeMode,
    editAmount,
    confirm,
    close,
    changePayment: () =>
      modify(() => {
        setQr("")
        setCash("")
        setManual(false)
      }),
  }
}
