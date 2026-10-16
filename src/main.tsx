import React, { lazy, Suspense } from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import "./index.css"
const PhoneReaderPage = lazy(() => import("./features/scanner/PhoneReaderPage"))

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {window.location.pathname.replace(/\/$/, "") === "/lector" ? (
      <Suspense fallback={<p role="status">Abriendo lector…</p>}>
        <PhoneReaderPage />
      </Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>,
)
