import type { DataConnection, Peer } from "peerjs"
import {
  desktopStorageKey,
  SCANNER_LIFETIME,
  scannerToken,
  validCredentials,
  validScan,
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

type Consumer = {
  target: ScannerTarget
  read: (scan: RemoteScan) => ScannerResult
}
interface DesktopState {
  linking: boolean
  paired: boolean
  message: string
  url: string
  expiresAt: number
}
interface DesktopOptions {
  storage?: Storage
  createPeer?: ScannerPeerFactory
  clock?: () => number
  origin?: () => string
}

export class DesktopScanner {
  private options: DesktopOptions
  private credentials?: ScannerCredentials
  private consumer: Consumer | null = null
  private peer?: Peer
  private opening?: Promise<Peer>
  private connection?: DataConnection
  private connections = new Map<DataConnection, number>()
  private epoch = 0
  private timer?: ReturnType<typeof setInterval>
  private retry?: ReturnType<typeof setTimeout>
  private lastSeen = 0
  private lastState = 0
  private startedAt = 0
  private receipts = new Map<string, ScannerResult>()
  private listeners = new Set<() => void>()
  private storageListener?: () => void
  private state: DesktopState = {
    linking: false,
    paired: false,
    message: "Teléfono sin vincular",
    url: "",
    expiresAt: 0,
  }
  constructor(options: DesktopOptions = {}) {
    this.options = options
  }
  private now() {
    return (this.options.clock ?? Date.now)()
  }
  private storage() {
    return this.options.storage ?? window.localStorage
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
  private saved() {
    const raw = this.storage().getItem(desktopStorageKey)
    try {
      const value: unknown = JSON.parse(raw ?? "null")
      return validCredentials(value) ? value : undefined
    } catch {
      return undefined
    }
  }
  private valid() {
    return !!this.credentials && this.now() < this.credentials.expiresAt
  }
  setConsumer(consumer: Consumer | null) {
    if (this.consumer?.target.id === consumer?.target.id) return
    this.consumer = consumer
    if (this.connection) this.sendState()
  }
  async link() {
    if (this.state.linking) return
    try {
      let credentials = this.saved()
      if (!credentials || credentials.expiresAt <= this.now()) {
        credentials = {
          sessionId: crypto.randomUUID(),
          token: scannerToken(),
          expiresAt: this.now() + SCANNER_LIFETIME,
        }
        this.storage().setItem(desktopStorageKey, JSON.stringify(credentials))
      }
      await this.boot(credentials)
    } catch {
      this.update({
        linking: false,
        message:
          "Permite el almacenamiento de este navegador para conservar el enlace de 8 horas.",
      })
    }
  }
  async resume() {
    try {
      const saved = this.saved()
      if (!saved) return
      if (saved.expiresAt <= this.now()) {
        this.expire()
        return
      }
      await this.boot(saved)
    } catch {
      this.update({
        message: "No se pudo recuperar el enlace. Genera uno nuevo.",
      })
    }
  }
  private async boot(credentials: ScannerCredentials) {
    if (
      this.peer &&
      !this.peer.destroyed &&
      this.credentials?.sessionId === credentials.sessionId
    )
      return
    const previousOpening = this.opening
    this.stop()
    const epoch = this.epoch
    this.credentials = credentials
    this.startedAt = this.now()
    const url = new URL(
      "/lector",
      (this.options.origin ?? (() => window.location.origin))(),
    )
    url.hash = new URLSearchParams({
      session: credentials.sessionId,
      token: credentials.token,
      expires: String(credentials.expiresAt),
    }).toString()
    this.update({
      linking: true,
      url: url.href,
      expiresAt: credentials.expiresAt,
      message: "Enlace listo · conectando el lector…",
    })
    this.timer = setInterval(() => this.maintain(), 1000)
    if (typeof window !== "undefined") {
      const onStorage = (event: StorageEvent) => {
        if (event.key !== desktopStorageKey && event.key !== null) return
        try {
          if (this.saved()?.token !== this.credentials?.token)
            this.end("revoked")
        } catch {
          this.end("revoked")
        }
      }
      window.addEventListener("storage", onStorage)
      this.storageListener = () =>
        window.removeEventListener("storage", onStorage)
    }
    try {
      if (previousOpening) {
        await previousOpening.catch(() => undefined)
        if (epoch !== this.epoch) return
      }
      const opening = (this.options.createPeer ?? scannerTransport.createPeer)(
        credentials.sessionId,
      )
      this.opening = opening
      const peer = await opening
      if (this.opening === opening) this.opening = undefined
      if (epoch !== this.epoch) {
        peer.destroy()
        return
      }
      this.peer = peer
      peer.on("open", () => {
        if (epoch !== this.epoch) return
        this.update({
          linking: false,
          message: "Escanea el QR o abre el enlace en tu teléfono",
        })
      })
      peer.on("connection", (connection) => {
        if (epoch !== this.epoch) {
          connection.close()
          return
        }
        this.accept(connection, epoch)
      })
      peer.on("disconnected", () => {
        if (epoch !== this.epoch || !this.valid()) return
        if (!this.connection)
          this.update({
            message:
              "Reconectando el lector. Comprueba tu conexión a Internet.",
          })
        clearTimeout(this.retry)
        this.retry = setTimeout(() => {
          if (epoch === this.epoch && !peer.destroyed && peer.disconnected)
            peer.reconnect()
        }, 2000)
      })
      peer.on("error", (error) => {
        if (epoch !== this.epoch) return
        this.update({
          linking: false,
          message:
            error.type === "unavailable-id"
              ? "Este enlace ya está abierto en otra pestaña de la computadora. Usa esa pestaña o ciérrala antes de reintentar."
              : "No se pudo conectar el lector. Revisa Internet y la Wi-Fi; puedes reintentar con el mismo enlace.",
        })
        if (!this.connection) {
          this.peer = undefined
          peer.destroy()
        }
      })
    } catch {
      if (epoch === this.epoch)
        this.update({
          linking: false,
          message:
            "No se pudo cargar el lector. Reintenta con el mismo enlace.",
        })
    }
  }
  private accept(connection: DataConnection, epoch: number) {
    // Unauthenticated connections have ten seconds to prove possession of the QR secret.
    if (this.connections.size >= 8) {
      connection.close()
      return
    }
    this.connections.set(connection, this.now())
    connection.on("data", (value) => {
      if (epoch !== this.epoch) return
      if (!this.valid()) {
        this.expire()
        return
      }
      const message = readPeerMessage(value)
      if (!message) {
        connection.close()
        return
      }
      if (message.type === "hello") {
        if (
          message.protocol !== 1 ||
          message.sessionId !== this.credentials?.sessionId ||
          message.token !== this.credentials?.token
        ) {
          sendPeerMessage(connection, { type: "end", reason: "unauthorized" })
          return
        }
        if (this.connection && this.connection !== connection) {
          sendPeerMessage(connection, { type: "end", reason: "busy" })
          return
        }
        this.connection = connection
        this.lastSeen = this.now()
        this.update({ paired: true, linking: false })
        this.sendState()
        return
      }
      if (connection !== this.connection) {
        connection.close()
        return
      }
      this.lastSeen = this.now()
      if (message.type === "disconnect") {
        void this.disconnect()
        return
      }
      if (message.type === "ping") {
        this.sendState()
        return
      }
      if (message.type !== "scan" || !validScan(message.scan)) return
      const scan = message.scan
      const previous = this.receipts.get(scan.id)
      let result: ScannerResult
      if (
        previous &&
        previous.contextId === scan.contextId &&
        previous.code === scan.code
      )
        result = previous
      else if (
        previous ||
        !this.consumer ||
        scan.contextId !== this.consumer.target.id
      ) {
        result = {
          ...scan,
          outcome: "paused",
          message: "La operación cambió. Vuelve a escanear.",
        }
      } else {
        try {
          result = this.consumer.read(scan)
        } catch {
          result = {
            ...scan,
            outcome: "paused",
            message: "No se pudo seleccionar el producto. Vuelve a escanear.",
          }
        }
        this.receipts.set(scan.id, result)
        if (this.receipts.size > 200)
          this.receipts.delete(this.receipts.keys().next().value!)
      }
      sendPeerMessage(connection, { type: "result", result })
    })
    const close = () => {
      this.connections.delete(connection)
      if (epoch !== this.epoch || this.connection !== connection) return
      this.connection = undefined
      this.update({
        paired: false,
        message:
          "Teléfono desconectado · vuelve a abrir el mismo enlace para reconectar",
      })
    }
    connection.on("close", close)
    connection.on("error", () => {
      connection.close()
      close()
    })
  }
  private sendState() {
    if (!this.valid()) {
      this.expire()
      return
    }
    const target = this.consumer?.target ?? null
    sendPeerMessage(this.connection, {
      type: "state",
      expiresAt: this.credentials!.expiresAt,
      target,
    })
    this.lastState = this.now()
    if (this.connection)
      this.update({
        message: target
          ? "Teléfono conectado · listo para escanear"
          : "Teléfono conectado · lector pausado",
      })
  }
  private maintain() {
    if (!this.valid()) {
      this.expire()
      return
    }
    if (this.state.linking && this.now() - this.startedAt >= 20000) {
      this.peer?.destroy()
      this.peer = undefined
      this.update({
        linking: false,
        message:
          "No se pudo conectar con el servicio de enlace. Comprueba Internet y reintenta con el mismo QR.",
      })
    }
    for (const [connection, since] of this.connections) {
      if (connection !== this.connection && this.now() - since >= 10000) {
        this.connections.delete(connection)
        connection.close()
      }
    }
    if (this.connection && this.now() - this.lastSeen >= 20000) {
      const connection = this.connection
      this.connection = undefined
      connection.close()
      this.update({
        paired: false,
        message: "Teléfono sin conexión. Abre el mismo enlace para reconectar.",
      })
    } else if (this.connection && this.now() - this.lastState >= 5000)
      this.sendState()
  }
  private expire() {
    this.end("expired")
  }
  private end(reason: "expired" | "revoked") {
    sendPeerMessage(this.connection, { type: "end", reason })
    const peer = this.peer
    const connections = [...this.connections.keys()]
    this.peer = undefined
    this.connections.clear()
    this.connection = undefined
    this.stop()
    setTimeout(() => {
      for (const connection of connections) connection.close()
      peer?.destroy()
    }, 100)
    this.credentials = undefined
    this.receipts.clear()
    this.update({
      url: "",
      expiresAt: 0,
      message:
        reason === "expired"
          ? "El enlace venció tras 8 horas. Genera uno nuevo."
          : "Teléfono desconectado. Genera un nuevo enlace y QR.",
    })
  }
  // Lifecycle cleanup preserves the link. Only explicit disconnect/logout revokes it.
  stop() {
    this.epoch++
    clearInterval(this.timer)
    clearTimeout(this.retry)
    this.storageListener?.()
    this.storageListener = undefined
    this.connection = undefined
    for (const connection of this.connections.keys()) connection.close()
    this.connections.clear()
    this.peer?.destroy()
    this.peer = undefined
    this.update({ paired: false, linking: false })
  }
  async disconnect() {
    const session = this.credentials
    this.end("revoked")
    try {
      if (!session || this.saved()?.sessionId === session.sessionId)
        this.storage().removeItem(desktopStorageKey)
    } catch {
      /* Storage may have been disabled after pairing. */
    }
  }
}
export const desktopScanner = new DesktopScanner()
export type { ScannerKind }
