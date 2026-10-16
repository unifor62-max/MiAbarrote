import {
  scannerRequest,
  ScannerApiError,
  scannerToken,
  validScannerCode,
  validScannerId,
  type ScannerCredentials,
  type ScannerResult,
  type ScannerState,
  type RemoteScan,
} from "../../data/remoteScanner.ts"
const storageKey = "miabarrote:phone-reader"
interface PhoneState {
  connected: boolean
  accepting: boolean
  busy: boolean
  message: string
  result: ScannerResult | null
  lastCode: string
}
export class PhoneScanner {
  private credentials?: ScannerCredentials
  private pair?: string
  private pending?: RemoteScan
  private lastCode = ""
  private target?: ScannerState["target"]
  private active = false
  private generation = 0
  private busy = false
  private timer?: ReturnType<typeof setTimeout>
  private abort?: AbortController
  private delay = 2000
  private state: PhoneState = {
    connected: false,
    accepting: false,
    busy: false,
    message: "Vinculando teléfono…",
    result: null,
    lastCode: "",
  }
  private listeners = new Set<() => void>()
  private storage: Storage
  private api: typeof scannerRequest
  constructor(storage: Storage, api: typeof scannerRequest = scannerRequest) {
    this.storage = storage
    this.api = api
  }
  getSnapshot = () => this.state
  subscribe = (callback: () => void) => {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }
  private update(patch: Partial<PhoneState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((callback) => callback())
  }
  private save() {
    this.storage.setItem(
      storageKey,
      JSON.stringify({
        credentials: this.credentials,
        pending: this.pending,
        pair: this.pair,
      }),
    )
  }
  start(fragment = "") {
    if (this.active) return
    this.active = true
    this.generation++
    try {
      const params = new URLSearchParams(fragment.replace(/^#/, ""))
      if (params.has("session")) {
        const sessionId = params.get("session"),
          pair = params.get("pair")
        if (!validScannerId(sessionId) || !pair || !/^[a-f0-9]{64}$/.test(pair))
          throw Error("El enlace de vinculación es inválido.")
        this.credentials = { sessionId, token: scannerToken() }
        this.pair = pair
        this.pending = undefined
        this.save()
      } else {
        const saved = JSON.parse(this.storage.getItem(storageKey) ?? "null")
        if (
          !saved?.credentials ||
          !validScannerId(saved.credentials.sessionId) ||
          !/^[a-f0-9]{64}$/.test(saved.credentials.token)
        )
          throw Error("Abre un QR de vinculación desde la laptop.")
        this.credentials = saved.credentials
        this.pair = saved.pair
        if (
          saved.pending &&
          validScannerId(saved.pending.id) &&
          validScannerId(saved.pending.contextId) &&
          validScannerCode(saved.pending.code)
        )
          this.pending = saved.pending
      }
      void this.tick(this.generation)
    } catch (error) {
      this.update({
        message: error instanceof Error ? error.message : "Abre un nuevo QR.",
      })
      this.active = false
    }
  }
  stop() {
    this.active = false
    this.generation++
    this.abort?.abort()
    clearTimeout(this.timer)
    this.busy = false
  }
  async disconnect() {
    this.stop()
    if (this.credentials) {
      try {
        await this.api("sesion", this.credentials, { operation: "close" })
      } catch {}
    }
    this.storage.removeItem(storageKey)
    this.credentials = undefined
    this.pending = undefined
    this.update({
      connected: false,
      accepting: false,
      busy: false,
      message: "Teléfono desconectado. Abre un nuevo QR en la laptop.",
    })
  }
  resetLatch() {
    this.lastCode = ""
  }
  scan(code: string) {
    if (
      !this.active ||
      !this.state.accepting ||
      this.pending ||
      code === this.lastCode ||
      !validScannerCode(code)
    )
      return
    this.lastCode = code
    if (!this.target) return
    this.pending = { id: crypto.randomUUID(), contextId: this.target.id, code }
    this.save()
    this.update({
      busy: true,
      lastCode: code,
      result: null,
      message: "Esperando confirmación de la laptop…",
    })
    if (!this.busy) {
      clearTimeout(this.timer)
      void this.tick(this.generation)
    }
  }
  private finish(result: ScannerResult) {
    this.pending = undefined
    this.save()
    this.update({
      busy: false,
      result,
      lastCode: result.code,
      message: result.message,
    })
  }
  private async tick(generation: number) {
    if (
      !this.active ||
      !this.credentials ||
      this.busy ||
      generation !== this.generation
    )
      return
    this.busy = true
    this.abort = new AbortController()
    const options = { signal: this.abort.signal, eventId: this.pending?.id }
    try {
      if (this.pair) {
        await this.api(
          "sesion",
          this.credentials,
          {
            operation: "pair",
            pair: this.pair,
            sender: this.credentials.token,
          },
          options,
        )
        if (!this.active || generation !== this.generation) return
        this.pair = undefined
        this.save()
      }
      const state = await this.api<ScannerState>(
        "eventos",
        this.credentials,
        undefined,
        options,
      )
      if (!this.active || generation !== this.generation) return
      if (this.target?.id !== state.target?.id) this.lastCode = ""
      this.target = state.target
      this.update({
        connected: true,
        accepting: state.accepting,
        message: this.pending
          ? "Esperando confirmación de la laptop…"
          : state.accepting
            ? (this.state.result?.message ?? "Listo para escanear")
            : "Lector pausado. Abre la selección de productos en la laptop.",
      })
      if (this.pending) {
        if (state.result) this.finish(state.result)
        else if (
          !state.accepting ||
          state.target?.id !== this.pending.contextId
        )
          this.finish({
            ...this.pending,
            outcome: "paused",
            message: "La operación cambió. Vuelve a escanear.",
          })
        else {
          const scan = this.pending
          const result = await this.api<{ result?: ScannerResult }>(
            "eventos",
            this.credentials,
            { operation: "scan", scan },
            options,
          )
          if (!this.active || generation !== this.generation) return
          if (result.result) this.finish(result.result)
        }
      }
      this.delay = 2000
    } catch (error) {
      if (!this.active || generation !== this.generation) return
      this.update({
        accepting: false,
        message:
          error instanceof Error ? error.message : "Reconectando lector…",
      })
      if (
        error instanceof ScannerApiError &&
        ([401, 403, 410].includes(error.status) ||
          (this.pair && error.status === 409))
      ) {
        this.storage.removeItem(storageKey)
        this.credentials = undefined
        this.pending = undefined
        this.update({ connected: false, busy: false })
        return
      }
      this.delay = Math.min(30000, this.delay * 2)
    } finally {
      if (generation === this.generation) {
        this.busy = false
        if (this.active && this.credentials)
          this.timer = setTimeout(() => void this.tick(generation), this.delay)
      }
    }
  }
}
