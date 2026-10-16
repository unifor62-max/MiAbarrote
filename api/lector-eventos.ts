import { scannerApiFromEnv } from "../server/scannerApi.ts"
export default {
  fetch: (request: Request) =>
    scannerApiFromEnv()(
      request,
      "lector-eventos",
      request.headers.get("x-vercel-forwarded-for") ?? "unknown",
    ),
}
