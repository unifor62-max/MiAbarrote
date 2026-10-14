/// <reference types="vite/client" />

interface Window {
  simularPagoQR?: (titular: string, monto: number) => string
}
