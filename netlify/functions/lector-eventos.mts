import { scannerApiFromEnv } from "../../server/scannerApi.ts"
export default (request: Request, context: { ip?: string }) =>
  scannerApiFromEnv()(request, "lector-eventos", context.ip ?? "unknown")
export const config = { path: "/api/lector-eventos" }
