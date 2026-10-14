export interface ScannerKey {
  key: string
  timeStamp: number
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
  repeat?: boolean
  isComposing?: boolean
}
export interface ScanResult<T> {
  code: string
  snapshot: T
}

/** Keyboard-wedge readers finish a fast printable burst with Enter. */
export function createBarcodeScanner<T>() {
  let buffer = ""
  let last = 0
  let original: T | undefined
  function clear() {
    buffer = ""
    original = undefined
    last = 0
  }
  function feed(event: ScannerKey, snapshot: () => T): ScanResult<T> | null {
    if (
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.isComposing ||
      event.repeat
    ) {
      clear()
      return null
    }
    if (event.key === "Shift") return null
    if (event.key === "Enter") {
      const result =
        buffer.length >= 3 &&
        event.timeStamp - last <= 100 &&
        original !== undefined
          ? { code: buffer, snapshot: original }
          : null
      clear()
      return result
    }
    if (event.key.length !== 1) {
      clear()
      return null
    }
    if (!buffer || event.timeStamp - last > 50) {
      buffer = ""
      original = snapshot()
    }
    buffer += event.key
    last = event.timeStamp
    if (buffer.length > 128) clear()
    return null
  }
  return { feed, clear }
}
