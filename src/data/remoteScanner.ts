export type ScannerKind = "sale" | "purchase"
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
}
export interface ScannerState {
  paired: boolean
  accepting: boolean
  target: ScannerTarget | null
  pending?: RemoteScan | null
  result?: ScannerResult | null
}
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
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  )
}
export class ScannerApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}
export async function scannerRequest<T>(
  route: "sesion" | "eventos",
  credentials?: ScannerCredentials,
  body?: unknown,
  options: {
    signal?: AbortSignal
    eventId?: string
    fetcher?: typeof fetch
  } = {},
): Promise<T> {
  const query = new URLSearchParams()
  if (credentials) query.set("sessionId", credentials.sessionId)
  if (options.eventId) query.set("eventId", options.eventId)
  const response = await (options.fetcher ?? globalThis.fetch.bind(globalThis))(
    `/api/lector-${route}${query.size ? "?" + query : ""}`,
    {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(credentials
          ? { Authorization: "Bearer " + credentials.token }
          : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000),
    },
  )
  const data = await response.json()
  if (!response.ok)
    throw new ScannerApiError(
      data.error || "No se pudo conectar el lector.",
      response.status,
    )
  return data as T
}
