import {
  scannerRequest,
  ScannerApiError,
  type RemoteScan,
  type ScannerCredentials,
  type ScannerKind,
  type ScannerResult,
  type ScannerState,
  type ScannerTarget,
} from "../../data/remoteScanner.ts"
type Consumer = {
  target: ScannerTarget
  read: (scan: RemoteScan) => ScannerResult
}
interface DesktopState {
  linking: boolean
  paired: boolean
  message: string
  url: string
  pairUntil: number
}
export class DesktopScanner {
  private credentials?: ScannerCredentials
  private consumer: Consumer | null = null
  private version = 0
  private epoch = 0
  private timer?: ReturnType<typeof setTimeout>
  private abort?: AbortController
  private busy = false
  private creating = false
  private heartbeat = 0
  private delay = 1000
  private receipts = new Map<string, ScannerResult>()
  private listeners = new Set<() => void>()
  private state: DesktopState = {
    linking: false,
    paired: false,
    message: "Teléfono sin vincular",
    url: "",
    pairUntil: 0,
  }
  private api: typeof scannerRequest
  constructor(api: typeof scannerRequest = scannerRequest) {
    this.api = api
  }
  getSnapshot = () => this.state
  subscribe = (callback: () => void) => {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }
  private update(patch: Partial<DesktopState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((callback) => callback())
  }
  setConsumer(consumer: Consumer | null) {
    if (this.consumer?.target.id === consumer?.target.id) return
    this.consumer = consumer
    this.version++
    this.heartbeat = 0
    if (this.credentials && !this.busy) {
      clearTimeout(this.timer)
      void this.tick(this.epoch)
    }
  }
  async link() {
    if (this.creating) return
    if (
      this.credentials &&
      (this.state.paired || this.state.pairUntil > Date.now())
    )
      return
    this.creating = true
    const closing = this.disconnect()
    const epoch = this.epoch
    this.update({ linking: true, message: "Preparando QR…" })
    try {
      await closing
      if (epoch !== this.epoch) return
      this.abort = new AbortController()
      const result = await this.api<ScannerCredentials & {
        pair: string
        pairUntil: number
      }>("sesion", undefined, { operation: "create" }, {
        signal: this.abort.signal,
      })
      if (epoch !== this.epoch) return
      this.credentials = { sessionId: result.sessionId, token: result.token }
      const url = new URL("/lector", window.location.origin)
      url.hash = new URLSearchParams({
        session: result.sessionId,
        pair: result.pair,
      }).toString()
      this.update({
        url: url.href,
        pairUntil: result.pairUntil,
        message: "Escanea el QR con tu teléfono",
      })
      this.heartbeat = 0
      this.delay = 1000
      void this.tick(epoch)
    } catch (error) {
      if (epoch === this.epoch)
        this.update({
          message:
            error instanceof Error ? error.message : "No se pudo vincular.",
        })
    } finally {
      this.creating = false
      if (epoch === this.epoch) this.update({ linking: false })
    }
  }
  async disconnect() {
    const credentials = this.credentials
    this.epoch++
    this.abort?.abort()
    clearTimeout(this.timer)
    this.credentials = undefined
    this.busy = false
    this.receipts.clear()
    this.heartbeat = 0
    this.update({
      linking: false,
      paired: false,
      url: "",
      pairUntil: 0,
      message: "Teléfono sin vincular",
    })
    if (credentials) {
      try {
        await this.api("sesion", credentials, { operation: "close" })
      } catch {
        /* The mailbox expires without laptop heartbeats. */
      }
    }
  }
  private async tick(epoch: number) {
    if (!this.credentials || this.busy || epoch !== this.epoch) return
    this.busy = true
    this.abort = new AbortController()
    const options = { signal: this.abort.signal }
    try {
      const credentials = this.credentials
      if (Date.now() - this.heartbeat >= 15000) {
        const version = this.version
        await this.api(
          "sesion",
          credentials,
          {
            operation: "heartbeat",
            version,
            target: this.consumer?.target ?? null,
          },
          options,
        )
        if (epoch !== this.epoch) return
        if (version === this.version) this.heartbeat = Date.now()
      }
      const state = await this.api<ScannerState>(
        this.consumer ? "eventos" : "sesion",
        credentials,
        undefined,
        options,
      )
      if (epoch !== this.epoch) return
      if (!state.paired && Date.now() > this.state.pairUntil) {
        await this.disconnect()
        this.update({
          message: "El QR venció. Genera uno nuevo para vincular el teléfono.",
        })
        return
      }
      this.update({
        paired: state.paired,
        message: state.paired
          ? this.consumer
            ? "Teléfono conectado · listo para escanear"
            : "Teléfono conectado · lector pausado"
          : "Escanea el QR con tu teléfono",
      })
      if (state.pending) {
        const scan = state.pending
        let result: ScannerResult
        if (!this.consumer || scan.contextId !== this.consumer.target.id)
          result = {
            ...scan,
            outcome: "paused",
            message: "La operación cambió. Vuelve a escanear.",
          }
        else {
          result = this.receipts.get(scan.id) ?? this.consumer.read(scan)
          this.receipts.set(scan.id, result)
          if (this.receipts.size > 50)
            this.receipts.delete(this.receipts.keys().next().value!)
        }
        await this.api(
          "eventos",
          credentials,
          { operation: "result", result },
          options,
        )
      }
      this.delay = 1000
    } catch (error) {
      if (epoch !== this.epoch) return
      this.update({
        message:
          error instanceof Error ? error.message : "Reconectando lector…",
      })
      if (
        error instanceof ScannerApiError &&
        [401, 410].includes(error.status)
      ) {
        this.credentials = undefined
        this.update({ paired: false, url: "", pairUntil: 0 })
        return
      }
      this.delay = Math.min(30000, this.delay * 2)
    } finally {
      if (epoch === this.epoch) {
        this.busy = false
        if (this.credentials)
          this.timer = setTimeout(
            () => void this.tick(epoch),
            this.delay > 1000
              ? this.delay
              : this.consumer || !this.state.paired
                ? 1000
                : 15000,
          )
      }
    }
  }
}
export const desktopScanner = new DesktopScanner()
export type { ScannerKind }
