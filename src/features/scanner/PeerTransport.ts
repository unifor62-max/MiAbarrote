import type { DataConnection, Peer } from "peerjs"
export type ScannerPeerFactory = (id?: string) => Promise<Peer>

// Injectable boundary: controllers can be tested without opening a network connection.
export const scannerTransport: { createPeer: ScannerPeerFactory } = {
  async createPeer(id) {
    const { Peer } = await import("peerjs")
    const options = {
      secure: true,
      config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] },
    }
    return id ? new Peer(id, options) : new Peer(options)
  },
}
export function readPeerMessage(
  value: unknown,
): Record<string, unknown> | null {
  try {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      JSON.stringify(value).length > 4096
    )
      return null
    return value as Record<string, unknown>
  } catch {
    return null
  }
}
export function sendPeerMessage(
  connection: DataConnection | undefined,
  message: unknown,
) {
  if (!connection?.open) return false
  try {
    connection.send(message)
    return true
  } catch {
    return false
  }
}
