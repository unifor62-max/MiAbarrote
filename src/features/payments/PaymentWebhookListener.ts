import {
  normalizePaymentPayload,
  validatePaymentNotification,
  type PaymentNotification,
} from "../../data/payments.ts"

export interface PaymentStatus {
  connected: boolean
  message: string
}
type ListenerOptions = {
  mode: "demo" | "cloud"
  fetcher?: typeof fetch
  target?: EventTarget
  storage?: Storage
  channelFactory?: () => BroadcastChannel | null
  lock?: <T>(name: string, callback: () => T | Promise<T>) => Promise<T>
}
type DemoLease = {
  owner?: string
  leaseUntil?: number
  consumed?: boolean
  commitId?: string
  qr?: number
  expires: number
}
const localEventName = "miabarrote:payment"

export class PaymentWebhookListener {
  readonly mode: "demo" | "cloud"
  private callbacks = new Set<(event: PaymentNotification) => void>()
  private statusCallbacks = new Set<(status: PaymentStatus) => void>()
  private seen = new Map<string, number>()
  private channel: BroadcastChannel | null = null
  private target: EventTarget
  private fetcher: typeof fetch
  private timer: ReturnType<typeof setTimeout> | undefined
  private controller: AbortController | null = null
  private cursor: number | undefined
  private delay = 2000
  private offset = 0
  private active = false
  private generation = 0
  private status: PaymentStatus
  private previousSimulator: Window["simularPagoQR"]
  private options: ListenerOptions

  constructor(options: ListenerOptions) {
    this.options = options
    this.mode = options.mode
    this.target = options.target ?? window
    // Window.fetch must keep its native receiver when called from this instance.
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
    this.status = {
      connected: this.mode === "demo",
      message:
        this.mode === "demo"
          ? "Simulador de pagos"
          : "Conecta la caja para recibir pagos.",
    }
  }
  now() {
    return Date.now() + this.offset
  }
  getStatus() {
    return this.status
  }
  subscribe(callback: (event: PaymentNotification) => void) {
    this.callbacks.add(callback)
    return () => {
      this.callbacks.delete(callback)
    }
  }
  subscribeStatus(callback: (status: PaymentStatus) => void) {
    this.statusCallbacks.add(callback)
    callback(this.status)
    return () => {
      this.statusCallbacks.delete(callback)
    }
  }
  private setStatus(status: PaymentStatus) {
    this.status = status
    this.statusCallbacks.forEach((callback) => callback(status))
  }
  private deliver(event: PaymentNotification) {
    const cutoff = this.now() - 86400000
    for (const [id, time] of this.seen) if (time < cutoff) this.seen.delete(id)
    if (this.seen.has(event.id) || event.receivedAt < cutoff) return
    this.seen.set(event.id, event.receivedAt)
    this.callbacks.forEach((callback) => callback(event))
  }
  private localHandler = (message: Event) => {
    if (this.mode !== "demo") return
    try {
      const raw = validatePaymentNotification((message as CustomEvent).detail, "demo")
      if (
        raw.source !== "demo" ||
        !Number.isFinite(raw.receivedAt) ||
        raw.receivedAt > Date.now() + 1000
      )
        return
      this.deliver(raw)
    } catch {
      /* Malformed local messages cannot become payment evidence. */
    }
  }
  start() {
    if (this.active) return
    this.active = true
    this.generation++
    if (this.mode === "demo") {
      this.target.addEventListener(localEventName, this.localHandler)
      this.channel = this.options.channelFactory
        ? this.options.channelFactory()
        : typeof BroadcastChannel === "undefined"
          ? null
          : new BroadcastChannel(localEventName)
      if (this.channel)
        this.channel.onmessage = (message) =>
          this.localHandler(
            new CustomEvent(localEventName, { detail: message.data }),
          )
      if (typeof window !== "undefined") {
        this.previousSimulator = window.simularPagoQR
        window.simularPagoQR = this.simulate
      }
    } else void this.poll(this.generation)
  }
  stop() {
    this.active = false
    this.generation++
    clearTimeout(this.timer)
    this.controller?.abort()
    this.target.removeEventListener(localEventName, this.localHandler)
    this.channel?.close()
    this.channel = null
    if (
      typeof window !== "undefined" &&
      window.simularPagoQR === this.simulate
    ) {
      window.simularPagoQR = this.previousSimulator
    }
  }
  simulate = (titular: string, monto: number) => {
    if (this.mode !== "demo" || !this.active)
      throw new Error("La simulación está deshabilitada en recepción real.")
    const normalized = normalizePaymentPayload({
      titular,
      monto,
      timestamp: new Date().toISOString(),
    })
    const event: PaymentNotification = {
      id: crypto.randomUUID(),
      titular: normalized.titular,
      montoCentavos: normalized.montoCentavos,
      timestamp: normalized.timestamp,
      receivedAt: Date.now(),
      source: "demo",
    }
    this.target.dispatchEvent(
      new CustomEvent(localEventName, { detail: event }),
    )
    this.channel?.postMessage(event)
    return event.id
  }
  private async request(path: string, body?: unknown) {
    const response = await this.fetcher(path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })
    const data = await response.json()
    if (!response.ok)
      throw new Error(
        data.error || "No se pudo conectar con el servicio de pagos.",
      )
    return data
  }
  async connect(clave: string) {
    if (this.mode === "demo") return
    const data = await this.request("/api/pagos-sesion", { clave: clave.trim() })
    this.offset = data.serverNow - Date.now()
    this.delay = 2000
    this.setStatus({
      connected: true,
      message: "Caja conectada · esperando pagos",
    })
    // Invalidate the previous request before reconnecting; late responses cannot overwrite the cursor.
    this.controller?.abort()
    clearTimeout(this.timer)
    const generation = ++this.generation
    if (this.active) await this.poll(generation)
  }
  private async poll(generation: number) {
    if (!this.active || generation !== this.generation) return
    this.controller = new AbortController()
    const controller = this.controller
    try {
      const response = await this.fetcher(
        `/api/webhook-pago${
          this.cursor === undefined ? "" : `?cursor=${this.cursor}`
        }`,
        {
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10000),
          ]),
        },
      )
      const data = await response.json()
      if (!this.active || generation !== this.generation) return
      if (!response.ok) {
        if (response.status === 401 || response.status === 409) {
          this.setStatus({
            connected: false,
            message: data.error || "Reconecta los pagos.",
          })
          if (response.status === 409) this.cursor = undefined
          return
        }
        throw new Error(data.error || "No se pudo consultar el buzón de pagos.")
      }
      if (
        !Number.isSafeInteger(data.cursor) ||
        data.cursor < (this.cursor ?? 0) ||
        !Number.isFinite(data.serverNow) ||
        !Array.isArray(data.events)
      )
        throw new Error("Respuesta de pagos inválida.")
      this.offset = data.serverNow - Date.now()
      const events: PaymentNotification[] = data.events.map(
        (raw: PaymentNotification) => {
          return validatePaymentNotification(raw, "cloud")
        },
      )
      events.forEach((event) => this.deliver(event))
      this.cursor = data.cursor
      this.delay = 2000
      this.setStatus({
        connected: true,
        message: "Caja conectada · esperando pagos",
      })
    } catch (error) {
      if (!this.active || generation !== this.generation) return
      this.setStatus({
        connected: false,
        message: error instanceof Error ? error.message : "Reconectando pagos…",
      })
      this.delay = Math.min(30000, this.delay * 2)
    }
    if (this.active && generation === this.generation)
      this.timer = setTimeout(() => void this.poll(generation), this.delay)
  }
  async transition(
    event: PaymentNotification,
    operation: "reserve" | "release" | "consume",
    owner: string,
    commitId = "",
  ) {
    if (event.source !== this.mode)
      throw new Error("Origen de pago incompatible con esta caja.")
    if (this.mode === "cloud") {
      await this.request("/api/pagos-estado", {
        id: event.id,
        operation,
        owner,
        qr: event.montoCentavos,
        commitId,
      })
      return
    }
    const execute = () => {
      const storage = this.options.storage ?? window.localStorage
      const key = "miabarrote:payment-lease:" + event.id
      const raw = storage.getItem(key)
      const existing: DemoLease = raw
        ? JSON.parse(raw)
        : { expires: event.receivedAt + 86400000 }
      const now = Date.now()
      if (existing.expires <= now) throw new Error("El pago expiró.")
      if (operation === "reserve") {
        if (
          existing.consumed ||
          (existing.owner &&
            existing.owner !== owner &&
            (existing.leaseUntil ?? 0) > now)
        )
          throw new Error("El pago ya está reservado o utilizado.")
        existing.owner = owner
        existing.leaseUntil = now + 300000
      } else if (operation === "release") {
        if (existing.consumed || existing.owner !== owner)
          throw new Error("No se puede liberar este pago.")
        delete existing.owner
        delete existing.leaseUntil
      } else {
        if (existing.consumed) {
          if (
            existing.owner === owner &&
            existing.commitId === commitId &&
            existing.qr === event.montoCentavos
          )
            return
          throw new Error("El pago ya fue utilizado.")
        }
        if (existing.owner !== owner || (existing.leaseUntil ?? 0) <= now)
          throw new Error("La reserva del pago expiró.")
        existing.consumed = true
        existing.commitId = commitId
        existing.qr = event.montoCentavos
      }
      storage.setItem(key, JSON.stringify(existing))
    }
    if (this.options.lock) await this.options.lock(event.id, execute)
    else if (navigator.locks)
      await navigator.locks.request("miabarrote-payment-" + event.id, execute)
    else
      throw new Error(
        "Este navegador no admite reservas seguras del simulador.",
      )
  }
}

let shared: PaymentWebhookListener | undefined
export function getPaymentListener() {
  return (shared ??= new PaymentWebhookListener({
    mode: import.meta.env?.VITE_PAYMENT_MODE === "cloud" ? "cloud" : "demo",
  }))
}
