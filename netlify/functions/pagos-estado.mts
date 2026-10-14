import { paymentApiFromEnv } from "../../server/paymentApi.ts"
export default (request: Request, context: { ip?: string }) =>
  paymentApiFromEnv()(request, "pagos-estado", context.ip ?? "unknown")
export const config = { path: "/api/pagos-estado" }
