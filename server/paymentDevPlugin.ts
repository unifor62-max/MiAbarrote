import type { Plugin } from "vite"
import { Readable } from "node:stream"
import { paymentApiFromEnv, type PaymentRoute } from "./paymentApi.ts"
import { scannerApiFromEnv, type ScannerRoute } from "./scannerApi.ts"

export function paymentDevPlugin(
  env: Record<string, string | undefined>,
): Plugin {
  return {
    name: "local-payment-api",
    apply: "serve",
    configureServer(server) {
      const handler = paymentApiFromEnv(env)
      const scanner = scannerApiFromEnv(env)
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?")[0]
        if (
          !path ||
          ![
            "/api/webhook-pago",
            "/api/pagos-sesion",
            "/api/pagos-estado",
            "/api/lector-sesion",
            "/api/lector-eventos",
          ].includes(path)
        )
          return next()
        try {
          const request = new Request(`http://${req.headers.host}${req.url}`, {
            method: req.method,
            headers: new Headers(
              Object.entries(req.headers).flatMap(([key, value]) =>
                value === undefined
                  ? []
                  : [[key, Array.isArray(value) ? value.join(",") : value]],
              ),
            ),
            ...(req.method === "GET"
              ? {}
              : {
                  body: Readable.toWeb(req) as ReadableStream<Uint8Array>,
                  duplex: "half",
                }),
          } as RequestInit)
          const response = path.startsWith("/api/lector-")
            ? await scanner(
                request,
                path.slice(5) as ScannerRoute,
                req.socket.remoteAddress ?? "unknown",
              )
            : await handler(
                request,
                path.slice(5) as PaymentRoute,
                req.socket.remoteAddress ?? "unknown",
              )
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(await response.text())
        } catch {
          res.statusCode = 503
          res.setHeader("Content-Type", "application/json")
          res.end(
            JSON.stringify({
              error: "No se pudo acceder al servicio local de pagos.",
            }),
          )
        }
      })
    },
  }
}
