import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { PhoneScanner } from "./PhoneScanner"
import type { IScannerControls } from "@zxing/browser"
import { scannerLabels } from "../../data/remoteScanner"

export default function PhoneReaderPage() {
  const [reader] = useState(() => new PhoneScanner(window.localStorage))
  const state = useSyncExternalStore(reader.subscribe, reader.getSnapshot)
  const [camera, setCamera] = useState(false)
  const [cameraBusy, setCameraBusy] = useState(false)
  const [error, setError] = useState("")
  const video = useRef<HTMLVideoElement>(null)
  const controls = useRef<IScannerControls | null>(null)
  const cameraGeneration = useRef(0)
  const fragment = useRef(window.location.hash)
  function stopCamera() {
    cameraGeneration.current++
    controls.current?.stop()
    controls.current = null
    const stream = video.current?.srcObject
    if (stream instanceof MediaStream)
      stream.getTracks().forEach((track) => track.stop())
    if (video.current) video.current.srcObject = null
    setCamera(false)
    setCameraBusy(false)
  }
  useEffect(() => {
    reader.start(fragment.current)
    fragment.current = ""
    if (window.location.hash) history.replaceState(null, "", "/lector")
    const hidden = () => {
      if (document.visibilityState !== "visible") stopCamera()
    }
    document.addEventListener("visibilitychange", hidden)
    return () => {
      document.removeEventListener("visibilitychange", hidden)
      reader.stop()
      stopCamera()
    }
  }, [reader])
  useEffect(() => {
    if (!state.connected) stopCamera()
  }, [state.connected])
  async function startCamera() {
    if (cameraBusy || camera) return
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "La cámara requiere HTTPS y un navegador compatible. Abre este enlace en Chrome.",
      )
      return
    }
    const generation = ++cameraGeneration.current
    setCameraBusy(true)
    setError("")
    try {
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] =
        await Promise.all([import("@zxing/browser"), import("@zxing/library")])
      if (generation !== cameraGeneration.current) return
      const hints = new Map()
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
      ])
      const decoder = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 150,
        delayBetweenScanSuccess: 350,
      })
      const activeControls = await decoder.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } }, audio: false },
        video.current!,
        (result) => {
          if (generation === cameraGeneration.current && result)
            reader.scan(result.getText())
        },
      )
      if (generation !== cameraGeneration.current) {
        activeControls.stop()
        return
      }
      controls.current = activeControls
      setCamera(true)
    } catch (cause) {
      if (generation !== cameraGeneration.current) return
      setError(
        cause instanceof Error && cause.name === "NotAllowedError"
          ? "Permite el acceso a la cámara en los ajustes de este sitio y vuelve a intentar."
          : "No se pudo abrir la cámara. Cierra otras aplicaciones que la estén usando y vuelve a intentar.",
      )
    } finally {
      if (generation === cameraGeneration.current) setCameraBusy(false)
    }
  }
  return (
    <main className="phone-reader-page">
      <header>
        <p className="purchase-eyebrow">MiAbarrote · Lector móvil</p>
        <h1>Escanear productos</h1>
        <p>
          Apunta al código de barras del envase. Las imágenes permanecen en tu
          teléfono.
        </p>
      </header>
      <section className="phone-reader-card">
        {state.kind && (
          <p className="phone-reader-operation">
            Escaneando para {scannerLabels[state.kind]} en la computadora
          </p>
        )}
        <div
          className={`phone-reader-state ${state.accepting ? "is-ready" : ""}`}
          role="status"
        >
          {state.message}
        </div>
        <div className="phone-camera">
          <video
            ref={video}
            muted
            playsInline
            aria-label="Vista de la cámara para leer códigos de barras"
          />
          {!camera && <span>Cámara apagada</span>}
        </div>
        {error && (
          <p className="purchase-error" role="alert">
            {error}
          </p>
        )}
        <div className="phone-reader-actions">
          <button
            type="button"
            className="purchase-button purchase-button-primary"
            disabled={!state.connected || cameraBusy}
            onClick={() => (camera ? stopCamera() : void startCamera())}
          >
            {cameraBusy
              ? "Abriendo cámara…"
              : camera
                ? "Apagar cámara"
                : "Iniciar cámara"}
          </button>
          <button
            type="button"
            className="purchase-button purchase-button-secondary"
            disabled={state.busy}
            onClick={() => reader.resetLatch()}
          >
            Volver a leer
          </button>
        </div>
        {state.lastCode && (
          <p className="phone-last-code">
            Último código: <strong>{state.lastCode}</strong>
          </p>
        )}
        {state.busy && (
          <p>
            Envío pendiente. Espera la confirmación antes de escanear otro
            producto.
          </p>
        )}
        <p>
          Funciona cuando la laptop tiene abierto el primer paso de una venta o
          compra. Cambiar cantidades y confirmar se hace en la laptop.
        </p>
        <button
          type="button"
          className="purchase-button purchase-button-secondary"
          onClick={() => {
            stopCamera()
            void reader.disconnect()
          }}
        >
          Desconectar teléfono
        </button>
      </section>
    </main>
  )
}
