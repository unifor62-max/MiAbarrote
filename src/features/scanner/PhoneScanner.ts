import type { DataConnection, Peer } from "peerjs"
import {
  phoneStorageKey,
  validCredentials,
  validScannerCode,
  validResult,
  validTarget,
  type RemoteScan,
  type ScannerCredentials,
  type ScannerKind,
  type ScannerResult,
  type ScannerTarget,
} from "../../data/remoteScanner.ts"
import {
  readPeerMessage,
  scannerTransport,
  sendPeerMessage,
  type ScannerPeerFactory,
} from "./PeerTransport.ts"

interface PhoneState {
  connected: boolean
  accepting: boolean
  busy: boolean
  message: string
  result: ScannerResult | null
  lastCode: string
  kind: ScannerKind | null
  expiresAt: number
}
interface PhoneOptions {
  createPeer?: ScannerPeerFactory
  clock?: () => number
  retryMs?: number
}
export class PhoneScanner {
  private storage: Storage
  private options: PhoneOptions
  private credentials?: ScannerCredentials
  private peer?: Peer
  private connection?: DataConnection
  private target: ScannerTarget | null = null
  private pending?: RemoteScan
  private lastCode = ""
  private active = false
  private generation = 0
  private pulse?: ReturnType<typeof setInterval>
  private retry?: ReturnType<typeof setTimeout>
  private lastSeen = 0
  private lastSend = 0
  private listeners = new Set<() => void>()
  private state: PhoneState = {
    connected: false,
    accepting: false,
    busy: false,
    message: "Vinculando teléfono…",
    result: null,
    lastCode: "",
    kind: null,
    expiresAt: 0,
  }
  constructor(storage: Storage, options: PhoneOptions = {}) {
    this.storage = storage
    this.options = options
  }
  private now() {
    return (this.options.clock ?? Date.now)()
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
  start(fragment = "") {
    if (this.active) return
    try {
      const params = new URLSearchParams(fragment.replace(/^#/, ""))
      let saved: unknown
      if (params.size) {
        saved = {
          sessionId: params.get("session"),
          token: params.get("token"),
          expiresAt: Number(params.get("expires")),
        }
        if (!validCredentials(saved))
          throw Error(
            "El enlace es inválido o pertenece al lector anterior. Genera un nuevo QR en la computadora.",
          )
      } else saved = JSON.parse(this.storage.getItem(phoneStorageKey) ?? "null")
      if (!validCredentials(saved))
        throw Error("Abre el enlace o QR de vinculación desde la computadora.")
      if (saved.expiresAt <= this.now()) {
        this.storage.removeItem(phoneStorageKey)
        throw Error(
          "El enlace venció tras 8 horas. Genera uno nuevo en la computadora.",
        )
      }
      this.credentials = saved
      this.storage.setItem(phoneStorageKey, JSON.stringify(saved))
      this.active = true
      this.generation++
      this.lastSeen = this.now()
      this.update({
        message: "Conectando con la computadora…",
        expiresAt: saved.expiresAt,
      })
      this.pulse = setInterval(() => this.maintain(), 1000)
      void this.connect(this.generation)
    } catch (error) {
      this.update({
        connected: false,
        accepting: false,
        message:
          error instanceof Error
            ? error.message
            : "No se pudo abrir el enlace. Permite el almacenamiento y vuelve a intentarlo.",
      })
    }
  }
  private async connect(generation: number) {
    if (!this.active || generation !== this.generation || !this.credentials)
      return
    this.lastSeen = this.now()
    try {
      const peer = await (
        this.options.createPeer ?? scannerTransport.createPeer
      )()
      if (!this.active || generation !== this.generation) {
        peer.destroy()
        return
      }
      this.peer = peer
      peer.on("open", () => {
        if (generation !== this.generation || !this.active || !this.credentials)
          return
        const connection = peer.connect(this.credentials.sessionId, {
          reliable: true,
          serialization: "json",
        })
        this.connection = connection
        connection.on("open", () => {
          if (generation !== this.generation || !this.credentials) return
          sendPeerMessage(connection, {
            type: "hello",
            protocol: 1,
            sessionId: this.credentials.sessionId,
            token: this.credentials.token,
          })
        })
        connection.on("data", (value) => {
          if (generation === this.generation && this.active) this.receive(value)
        })
        connection.on("close", () => this.reconnect(generation))
        connection.on("error", () => this.reconnect(generation))
      })
      peer.on("error", () => this.reconnect(generation))
      peer.on("disconnected", () => {
        if (!this.state.connected) this.reconnect(generation)
      })
    } catch {
      this.reconnect(generation)
    }
  }
  private receive(value: unknown) {
    if (!this.credentials || this.credentials.expiresAt <= this.now()) {
      this.ended("expired")
      return
    }
    const message = readPeerMessage(value)
    if (!message) return
    if (message.type === "end") {
      const reason = message.reason
      if (
        ["expired", "revoked", "unauthorized", "busy"].includes(String(reason))
      )
        this.ended(String(reason))
      return
    }
    if (
      message.type === "state" &&
      message.expiresAt === this.credentials.expiresAt &&
      validTarget(message.target)
    ) {
      this.lastSeen = this.now()
      const changed = this.target?.id !== message.target?.id
      if (changed) this.lastCode = ""
      this.target = message.target
      this.update({
        connected: true,
        accepting: !!this.target,
        kind: this.target?.kind ?? null,
        result: changed ? null : this.state.result,
        message: this.pending
          ? "Esperando confirmación de la computadora…"
          : !this.target
            ? "Lector pausado. Abre la selección de productos en la computadora."
            : !changed && this.state.result
              ? this.state.result.message
              : "Listo para escanear en " +
                (this.target.kind === "sale" ? "venta" : "compra"),
      })
      if (this.pending) this.sendPending()
    } else if (message.type === "result" && validResult(message.result)) {
      this.lastSeen = this.now()
      const result = message.result
      if (
        !this.pending ||
        result.id !== this.pending.id ||
        result.code !== this.pending.code ||
        result.contextId !== this.pending.contextId
      )
        return
      this.pending = undefined
      this.lastCode = result.contextId === this.target?.id ? result.code : ""
      this.update({
        busy: false,
        result,
        lastCode: result.code,
        message: result.message,
      })
    }
  }
  private reconnect(generation: number) {
    if (!this.active || generation !== this.generation || this.retry) return
    this.generation++
    const next = this.generation
    const peer = this.peer
    this.peer = undefined
    this.connection = undefined
    peer?.destroy()
    this.update({
      connected: false,
      accepting: false,
      message:
        "Sin conexión con la computadora. Comprueba que esté abierta y ambos equipos usen la misma Wi-Fi. Reconectando…",
    })
    this.retry = setTimeout(() => {
      this.retry = undefined
      if (this.active && next === this.generation) void this.connect(next)
    }, this.options.retryMs ?? 2000)
  }
  private maintain() {
    if (!this.active || !this.credentials) return
    if (this.credentials.expiresAt <= this.now()) {
      this.ended("expired")
      return
    }
    if (this.retry) return
    if (this.now() - this.lastSeen >= 20000) {
      this.reconnect(this.generation)
      return
    }
    if (!this.state.connected || this.now() - this.lastSend < 3000) return
    if (this.pending) this.sendPending()
    else {
      sendPeerMessage(this.connection, { type: "ping" })
      this.lastSend = this.now()
    }
  }
  private sendPending() {
    if (!this.pending || !this.state.connected) return
    sendPeerMessage(this.connection, { type: "scan", scan: this.pending })
    this.lastSend = this.now()
  }
  resetLatch() {
    this.lastCode = ""
  }
  scan(code: string) {
    if (this.credentials && this.credentials.expiresAt <= this.now()) {
      this.ended("expired")
      return
    }
    if (
      !this.active ||
      !this.state.accepting ||
      !this.target ||
      this.pending ||
      code === this.lastCode ||
      !validScannerCode(code)
    )
      return
    this.lastCode = code
    this.pending = { id: crypto.randomUUID(), contextId: this.target.id, code }
    this.update({
      busy: true,
      result: null,
      lastCode: code,
      message: "Esperando confirmación de la computadora…",
    })
    this.sendPending()
  }
  stop() {
    this.active = false
    this.generation++
    clearInterval(this.pulse)
    clearTimeout(this.retry)
    this.retry = undefined
    this.connection = undefined
    this.peer?.destroy()
    this.peer = undefined
    this.update({ connected: false, accepting: false })
  }
  private ended(reason: string) {
    this.stop()
    this.pending = undefined
    if (reason !== "busy") {
      try {
        this.storage.removeItem(phoneStorageKey)
      } catch {
        /* The in-memory reader is still stopped. */
      }
      this.credentials = undefined
    }
    const messages: Record<string, string> = {
      expired:
        "El enlace venció tras 8 horas. Genera uno nuevo en la computadora.",
      revoked:
        "La computadora desconectó el lector. Abre un nuevo enlace o QR.",
      unauthorized:
        "El enlace ya no es válido. Genera uno nuevo en la computadora.",
      busy: "Ya hay otro teléfono conectado. Desconéctalo antes de utilizar este.",
    }
    this.update({
      busy: false,
      kind: null,
      message: messages[reason] ?? "Lector desconectado.",
    })
  }
  async disconnect() {
    sendPeerMessage(this.connection, { type: "disconnect" })
    // Let the reliable data channel deliver the explicit revocation before closing it.
    const peer = this.peer
    this.peer = undefined
    this.ended("revoked")
    setTimeout(() => peer?.destroy(), 100)
  }
}
