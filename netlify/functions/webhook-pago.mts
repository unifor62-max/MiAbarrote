import { paymentApiFromEnv } from "../../server/paymentApi.ts"
export default (request: Request, context: { ip?: string }) =>
  paymentApiFromEnv()(request, "webhook-pago", context.ip ?? "unknown")
export const config = { path: "/api/webhook-pago" }
