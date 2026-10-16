import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { createRequire } from "node:module"
import { spawnSync } from "node:child_process"

test("Vercel adapters load as emitted JavaScript and report missing Redis as JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "miabarrote-runtime-"))
  const require = createRequire(import.meta.url)
  const oldUrl = process.env.UPSTASH_REDIS_REST_URL
  try {
    const compilation = spawnSync(
      process.execPath,
      [
        require.resolve("typescript/bin/tsc"),
        "api/webhook-pago.ts",
        "api/pagos-sesion.ts",
        "api/pagos-estado.ts",
        "api/lector-sesion.ts",
        "api/lector-eventos.ts",
        "netlify/functions/lector-sesion.mts",
        "netlify/functions/lector-eventos.mts",
        "--target",
        "ES2022",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        "--allowImportingTsExtensions",
        "--rewriteRelativeImportExtensions",
        "--skipLibCheck",
        "--rootDir",
        ".",
        "--outDir",
        directory,
      ],
      { cwd: resolve("."), encoding: "utf8" },
    )
    assert.equal(compilation.status, 0, compilation.stdout + compilation.stderr)
    await writeFile(join(directory, "package.json"), '{"type":"module"}')
    process.env.UPSTASH_REDIS_REST_URL = ""
    for (const route of ["webhook-pago", "pagos-sesion", "pagos-estado"]) {
      const adapter = await import(
        pathToFileURL(join(directory, "api", route + ".js")).href
      )
      const response = await adapter.default.fetch(
        new Request("https://example.test/api/" + route),
      )
      assert.equal(response.status, 503)
      assert.equal(response.headers.get("Cache-Control"), "no-store")
      assert.deepEqual(await response.json(), {
        error: "Configura el buzón Redis de pagos.",
      })
    }
    for (const route of ["lector-sesion", "lector-eventos"]) {
      const vercel = await import(
        pathToFileURL(join(directory, "api", route + ".js")).href
      )
      const netlify = await import(
        pathToFileURL(join(directory, "netlify/functions", route + ".mjs")).href
      )
      assert.equal(netlify.config.path, "/api/" + route)
      for (const handler of [
        vercel.default.fetch,
        (request) => netlify.default(request, { ip: "test" }),
      ]) {
        const response = await handler(
          new Request("https://example.test/api/" + route),
        )
        assert.equal(response.status, 503)
        assert.equal(response.headers.get("Cache-Control"), "no-store")
        assert.deepEqual(await response.json(), {
          error: "Configura Redis para vincular el teléfono.",
        })
      }
    }
  } finally {
    if (oldUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL
    else process.env.UPSTASH_REDIS_REST_URL = oldUrl
    await rm(directory, { recursive: true, force: true })
  }
})
