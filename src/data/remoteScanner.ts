export type ScannerKind = "sale" | "purchase" | "product" | "package"
export const scannerLabels: Record<ScannerKind, string> = {
  sale: "venta",
  purchase: "compra",
  product: "registro de producto · código individual",
  package: "registro de producto · código de paquete",
}
export interface ScannerTarget {
  id: string
  kind: ScannerKind
}
export interface RemoteScan {
  id: string
  code: string
  contextId: string
}
export type ScanOutcome = "selected" | "already-selected" | "unknown" | "no-stock" | "paused"
export interface ScannerResult extends RemoteScan {
  outcome: ScanOutcome
  message: string
}
export interface ScannerCredentials {
  sessionId: string
  token: string
  expiresAt: number
}
export const SCANNER_LIFETIME = 8 * 60 * 60 * 1000
export const desktopStorageKey = "miabarrote:desktop-reader:v2"
export const phoneStorageKey = "miabarrote:phone-reader:v2"
export function validScannerCode(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}
export function validScannerId(value: unknown): value is string {
  return typeof value === "string" && /^[\w-]{16,80}$/.test(value)
}
export function scannerToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")
}
export function validCredentials(value: unknown): value is ScannerCredentials {
  if (!value || typeof value !== "object") return false
  const item = value as ScannerCredentials
  return (
    validScannerId(item.sessionId) &&
    typeof item.token === "string" &&
    /^[a-f0-9]{64}$/.test(item.token) &&
    Number.isSafeInteger(item.expiresAt) &&
    item.expiresAt > 0
  )
}
export function validScan(value: unknown): value is RemoteScan {
  if (!value || typeof value !== "object") return false
  const item = value as RemoteScan
  return (
    validScannerId(item.id) &&
    validScannerId(item.contextId) &&
    validScannerCode(item.code)
  )
}
export function validTarget(value: unknown): value is ScannerTarget | null {
  if (value === null) return true
  if (!value || typeof value !== "object") return false
  const item = value as ScannerTarget
  return (
    validScannerId(item.id) &&
    ["sale", "purchase", "product", "package"].includes(item.kind)
  )
}
export function validResult(value: unknown): value is ScannerResult {
  if (!validScan(value)) return false
  const item = value as ScannerResult
  return (
    ["selected", "already-selected", "unknown", "no-stock", "paused"].includes(
      item.outcome,
    ) &&
    typeof item.message === "string" &&
    item.message.length <= 240
  )
}
