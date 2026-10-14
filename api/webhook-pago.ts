import { paymentApiFromEnv } from "../server/paymentApi.ts"
export default {
  fetch: (request: Request) =>
    paymentApiFromEnv()(
      request,
      "webhook-pago",
      request.headers.get("x-vercel-forwarded-for") ?? "unknown",
    ),
}
