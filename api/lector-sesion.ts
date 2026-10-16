import { scannerApiFromEnv } from "../server/scannerApi.ts"
export default {
  fetch: (request: Request) =>
    scannerApiFromEnv()(
      request,
      "lector-sesion",
      request.headers.get("x-vercel-forwarded-for") ?? "unknown",
    ),
}
