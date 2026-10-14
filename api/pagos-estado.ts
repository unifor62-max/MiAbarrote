import { paymentApiFromEnv } from "../server/paymentApi.ts"
export default {
  fetch: (request: Request) =>
    paymentApiFromEnv()(
      request,
      "pagos-estado",
      request.headers.get("x-vercel-forwarded-for") ?? "unknown",
    ),
}
