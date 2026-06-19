/**
 * The @lucid/collector Hono app factory + the runnable server entrypoint.
 *
 * `createCollectorApp(store, options)` builds a Hono app exposing the OTLP/JSON
 * receiver at `POST /v1/traces`. The store is injected so tests can supply an
 * in-memory `SqliteTraceStore`; Plan 01-04 mounts the query/metrics routes onto
 * the SAME app instance, and Plan 01-06 points adapters at `/v1/traces`.
 *
 * Running this module directly (`node dist/server.js`) constructs a
 * `SqliteTraceStore` at the configured path and serves the app on the OTLP/HTTP
 * port (default 4318).
 */

import { Hono } from "hono";
import { SqliteTraceStore } from "@lucid/store";
import type { TraceStore } from "@lucid/store";
import { createTracesHandler, type ReceiverOptions } from "./receiver.js";
import { mountQueryRoutes } from "./routes/index.js";

export type CollectorOptions = ReceiverOptions;

/**
 * Build the collector Hono app. Mounts the thin OTLP/JSON receiver at
 * `POST /v1/traces`; future plans mount additional routes onto the returned app.
 */
export function createCollectorApp(
  store: TraceStore,
  options: CollectorOptions = {},
): Hono {
  const app = new Hono();
  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.post("/v1/traces", createTracesHandler(store, options));
  // Additive read surface (Plan 01-04). Does not alter the receiver above.
  mountQueryRoutes(app, store);
  return app;
}

/** Resolve the listen port from the environment (OTLP/HTTP default 4318). */
function resolvePort(): number {
  const fromEnv = Number(process.env.LUCID_COLLECTOR_PORT);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 4318;
}

/** Resolve the SQLite store path (default: on-disk file alongside the cwd). */
function resolveStorePath(): string {
  return process.env.LUCID_STORE_PATH ?? "lucid-traces.db";
}

/**
 * Start the collector server. Imported lazily inside the entrypoint guard so
 * `@hono/node-server` is only required when actually serving (tests use
 * `app.request` and never touch the node server).
 */
async function main(): Promise<void> {
  const { serve } = await import("@hono/node-server");
  const store = new SqliteTraceStore(resolveStorePath());
  const app = createCollectorApp(store);
  const port = resolvePort();
  serve({ fetch: app.fetch, port });
  // Counts/config only — never raw trace content (T-01-02).
  console.info(`[collector] listening on :${port} — POST /v1/traces (OTLP/JSON)`);
}

// Run only when executed directly (not when imported by tests / other modules).
const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  main().catch((err) => {
    console.error("[collector] failed to start:", err);
    process.exitCode = 1;
  });
}
