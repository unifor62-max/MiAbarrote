import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import ModalShell from "../purchases/ModalShell"
import { desktopScanner } from "./DesktopScanner"
import type {
  RemoteScan,
  ScannerKind,
  ScannerResult,
} from "../../data/remoteScanner"

export function useRemoteScanner(
  kind: ScannerKind,
  enabled: boolean,
  anchor: React.RefObject<HTMLInputElement | null>,
  read: (scan: RemoteScan) => ScannerResult,
) {
  const handler = useRef(read)
  handler.current = read
  useLayoutEffect(() => {
    if (!enabled) return
    let active = false
    const sync = () => {
      const dialogs = [
        ...document.querySelectorAll<HTMLDialogElement>("dialog[open]"),
      ]
      const own = anchor.current?.closest("dialog")
      const eligible =
        document.visibilityState === "visible" &&
        !!own &&
        dialogs.at(-1) === own
      if (eligible === active) return
      active = eligible
      desktopScanner.setConsumer(
        eligible
          ? {
              target: { id: crypto.randomUUID(), kind },
              read: (scan) => handler.current(scan),
            }
          : null,
      )
    }
    const observer = new MutationObserver(sync)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
    })
    document.addEventListener("visibilitychange", sync)
    sync()
    return () => {
      observer.disconnect()
      document.removeEventListener("visibilitychange", sync)
      if (active) desktopScanner.setConsumer(null)
    }
  }, [kind, enabled, anchor])
}

export default function PhoneReaderButton() {
  const state = useSyncExternalStore(
    desktopScanner.subscribe,
    desktopScanner.getSnapshot,
  )
  const [open, setOpen] = useState(false)
  const [image, setImage] = useState("")
  const [qrError, setQrError] = useState("")
  const [now, setNow] = useState(Date.now())
  const [copyNotice, setCopyNotice] = useState("")
  useEffect(() => {
    if (!open) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [open])
  useEffect(() => {
    let valid = true
    setImage("")
    setQrError("")
    setCopyNotice("")
    if (open && state.url)
      void import("qrcode")
        .then((module) =>
          module.toDataURL(state.url, {
            scale: 6,
            margin: 4,
            errorCorrectionLevel: "M",
          }),
        )
        .then((url) => {
          if (valid) setImage(url)
        })
        .catch(() => {
          if (valid)
            setQrError(
              "No se pudo mostrar el QR. Cierra esta ventana y vuelve a abrirla.",
            )
        })
    return () => {
      valid = false
    }
  }, [open, state.url])
  return (
    <>
      <button
        type="button"
        className="purchase-button purchase-button-secondary phone-reader-trigger"
        onClick={() => {
          setOpen(true)
          void desktopScanner.link()
        }}
      >
        Usar teléfono como lector
      </button>
      {state.paired && (
        <span className="phone-reader-inline" role="status">
          {state.message}
        </span>
      )}
      {open && (
        <ModalShell
          title="Vincular teléfono"
          description="Escanea este QR con la cámara de tu teléfono. No necesitas instalar una aplicación."
          size="product"
          onClose={() => setOpen(false)}
        >
          <div className="phone-pairing">
            <p role="status">{state.message}</p>
            {qrError && (
              <p role="alert" className="purchase-error">
                {qrError}
              </p>
            )}
            {state.expiresAt > now && image && (
              <img
                src={image}
                alt="QR para abrir el lector en tu teléfono"
                width="280"
                height="280"
              />
            )}
            {state.expiresAt > now && state.url && (
              <div className="phone-reader-link">
                <label className="purchase-field" htmlFor="phone-reader-url">
                  <span>Enlace para tu teléfono</span>
                  <input
                    id="phone-reader-url"
                    type="text"
                    readOnly
                    value={state.url}
                    onFocus={(event) => {
                      const input = event.currentTarget
                      input.select()
                      requestAnimationFrame(() => { input.scrollLeft = 0 })
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="purchase-button purchase-button-secondary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(state.url)
                      setCopyNotice("Enlace copiado.")
                    } catch {
                      document.getElementById("phone-reader-url")?.focus()
                      setCopyNotice("Selecciona y copia el enlace del campo.")
                    }
                  }}
                >
                  Copiar enlace
                </button>
                {copyNotice && <span role="status">{copyNotice}</span>}
              </div>
            )}
            {state.expiresAt > 0 && (
              <p>
                {state.expiresAt > now
                  ? `Mismo enlace durante 8 horas · quedan ${Math.floor((state.expiresAt - now) / 3600000)} h ${Math.floor(((state.expiresAt - now) % 3600000) / 60000)} min. Vence a las ${new Date(state.expiresAt).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit", hour12: false })}.`
                  : "El enlace venció. Genera uno nuevo."}
              </p>
            )}
            {["localhost", "127.0.0.1", "[::1]"].includes(
              window.location.hostname,
            ) && (
              <p className="phone-reader-local-note">
                Estás en localhost: este enlace solo abre en esta computadora.
                Para usar el teléfono, abre la versión HTTPS publicada en Vercel
                y conecta ambos equipos a la misma Wi-Fi.
              </p>
            )}
            {state.paired && (
              <p>
                Cierra esta ventana para continuar seleccionando productos. El
                teléfono seguirá vinculado durante esta sesión.
              </p>
            )}
            <div className="phone-reader-actions">
              {!state.paired && (
                <button
                  type="button"
                  className="purchase-button purchase-button-primary"
                  disabled={state.linking}
                  onClick={() => void desktopScanner.link()}
                >
                  {state.url && state.expiresAt > now
                    ? "Reintentar conexión"
                    : "Generar nuevo enlace y QR"}
                </button>
              )}
              {(state.url || state.paired) && (
                <button
                  type="button"
                  className="purchase-button purchase-button-secondary"
                  onClick={() => void desktopScanner.disconnect()}
                >
                  Desconectar teléfono
                </button>
              )}
              <button
                type="button"
                className="purchase-button purchase-button-primary"
                onClick={() => setOpen(false)}
              >
                Continuar
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </>
  )
}
