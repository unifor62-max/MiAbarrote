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
  useEffect(() => {
    if (!open) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [open])
  useEffect(() => {
    let valid = true
    setImage("")
    setQrError("")
    if (open && state.url && !state.paired)
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
  }, [open, state.url, state.paired])
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
          size="name"
          onClose={() => setOpen(false)}
        >
          <div className="phone-pairing">
            <p role="status">{state.message}</p>
            {qrError && (
              <p role="alert" className="purchase-error">
                {qrError}
              </p>
            )}
            {!state.paired && state.pairUntil > now && image && (
              <img
                src={image}
                alt="QR para abrir el lector en tu teléfono"
                width="280"
                height="280"
              />
            )}
            {!state.paired && state.pairUntil > 0 && (
              <p>
                {state.pairUntil > now
                  ? `QR válido por ${Math.min(120, Math.ceil((state.pairUntil - now) / 1000))} segundos.`
                  : "El QR venció. Genera uno nuevo."}
              </p>
            )}
            {state.paired && (
              <p>
                Cierra esta ventana para continuar seleccionando productos. El
                teléfono seguirá vinculado durante esta sesión.
              </p>
            )}
            <div className="phone-reader-actions">
              {!state.paired && (!state.url || state.pairUntil <= now) && (
                <button
                  type="button"
                  className="purchase-button purchase-button-primary"
                  disabled={state.linking}
                  onClick={() => void desktopScanner.link()}
                >
                  Generar QR
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
