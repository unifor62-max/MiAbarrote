import type { Peer } from "peerjs"
import type { ScannerPeerFactory } from "../../src/features/scanner/PeerTransport.ts"

class Events {
  listeners = new Map<string, (...args: any[]) => void[]>()
  on(event: string, listener: (...args: any[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    return this
  }
  emit(event: string, ...args: any[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
}
export class MemoryScannerStorage implements Storage {
  values = new Map<string, string>()
  get length() {
    return this.values.size
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
  clear() {
    this.values.clear()
  }
}
class FakeConnection extends Events {
  open = false
  peer: string
  owner: FakePeer
  twin: FakeConnection
  constructor(owner: FakePeer, peer: string) {
    super()
    this.owner = owner
    this.peer = peer
  }
  send(value: any) {
    if (!this.open) throw Error("Closed data channel")
    const data = structuredClone(value)
    this.owner.network.frames.push({ data, connection: this })
    if (this.owner.network.drop?.(data, this)) return
    queueMicrotask(() => {
      if (this.twin.open) this.twin.emit("data", data)
    })
  }
  close() {
    if (!this.open) return
    this.open = false
    this.twin.open = false
    this.emit("close")
    this.twin.emit("close")
  }
}
class FakePeer extends Events {
  id: string
  network: FakePeerNetwork
  destroyed = false
  disconnected = false
  connections: FakeConnection[] = []
  constructor(network: FakePeerNetwork, id: string) {
    super()
    this.network = network
    this.id = id
  }
  connect(id: string) {
    const local = new FakeConnection(this, id)
    this.connections.push(local)
    const remote = this.network.peers.get(id)
    if (!remote) {
      setTimeout(() => this.emit("error", { type: "peer-unavailable" }), 0)
      return local
    }
    const incoming = new FakeConnection(remote, this.id)
    local.twin = incoming
    incoming.twin = local
    remote.connections.push(incoming)
    queueMicrotask(() => {
      if (this.destroyed || remote.destroyed) return
      remote.emit("connection", incoming)
      local.open = incoming.open = true
      incoming.emit("open")
      local.emit("open")
    })
    return local
  }
  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    if (this.network.peers.get(this.id) === this)
      this.network.peers.delete(this.id)
    for (const connection of this.connections) connection.close()
    this.emit("close")
  }
  reconnect() {
    this.disconnected = false
    this.emit("open", this.id)
  }
}
export class FakePeerNetwork {
  peers = new Map<string, FakePeer>()
  frames: {
    data: any
    connection: FakeConnection
  }[] = []
  drop?: (data: any, connection: FakeConnection) => boolean
  createPeer: ScannerPeerFactory = async (id = crypto.randomUUID()) => {
    const peer = new FakePeer(this, id)
    if (this.peers.has(id))
      setTimeout(() => peer.emit("error", { type: "unavailable-id" }), 0)
    else {
      this.peers.set(id, peer)
      setTimeout(() => {
        if (!peer.destroyed) peer.emit("open", id)
      }, 0)
    }
    return peer as unknown as Peer
  }
  replay(type: string) {
    const frame = [...this.frames]
      .reverse()
      .find((item) => item.data.type === type)
    if (!frame) throw Error("No frame: " + type)
    frame.connection.send(frame.data)
  }
}
