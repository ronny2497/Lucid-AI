import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The emit-or-omit / define-adapter tests assert emitted spans through an
 * InMemorySpanExporter, exactly like the @lucid/sdk tests. Those OTel packages
 * are dev-only test infrastructure (declared in devDependencies) — NOT runtime
 * dependencies of the adapter-sdk surface (@lucid/sdk owns the OTel runtime
 * path; the plan prohibition is on new RUNTIME deps only).
 *
 * Under pnpm's isolated node_modules these resolve normally once installed.
 * The aliases below are a resilience shim: when the local node_modules has not
 * yet been refreshed for the new devDependencies, resolution falls back to the
 * workspace pnpm store so the same store versions the @lucid/sdk runtime uses
 * are loaded (the in-memory provider the test registers is then the very
 * provider the SDK's trace.getTracer() resolves). When a normal install IS
 * present the aliases still point at the identical store entry, so they are a
 * no-op in that case.
 */
const store = (p: string) =>
  fileURLToPath(new URL(`../../node_modules/.pnpm/${p}`, import.meta.url));

const otelApi = store("@opentelemetry+api@1.9.1/node_modules/@opentelemetry/api");
const otelSdkTraceNode = store(
  "@opentelemetry+sdk-trace-node@2.8.0_@opentelemetry+api@1.9.1/node_modules/@opentelemetry/sdk-trace-node",
);

const alias: Record<string, string> = {};
if (existsSync(otelApi)) alias["@opentelemetry/api"] = otelApi;
if (existsSync(otelSdkTraceNode)) alias["@opentelemetry/sdk-trace-node"] = otelSdkTraceNode;

export default defineConfig({
  resolve: { alias },
  test: {
    include: ["test/**/*.test.ts"],
    watch: false,
  },
});
