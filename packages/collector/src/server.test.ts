/**
 * Integration tests for the @lucid/collector Hono receiver.
 *
 * These drive the public surface (`createCollectorApp(store)` + `app.request`)
 * exactly the way an OTLP/HTTP exporter would, asserting the 200/415/413/400
 * paths and the end-to-end persist→query round-trip. The fixtures are real
 * OTLP/JSON `ExportTraceServiceRequest` documents (resourceSpans>scopeSpans>spans).
 *
 * RED until server.ts / receiver.ts / otlp.ts / validator.ts are implemented.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { SqliteTraceStore } from "@lucid/store";
import { createCollectorApp } from "./server.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures");

function fixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

const VALID = fixture("otlp-valid.json");
const MISSING_EVENT_TYPE = fixture("otlp-missing-event-type.json");

function post(app: ReturnType<typeof createCollectorApp>, body: string, contentType = "application/json") {
  return app.request("/v1/traces", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
}

describe("POST /v1/traces", () => {
  it("accepts a valid OTLP/JSON batch (200) and the trace is queryable afterward", async () => {
    const store = new SqliteTraceStore(":memory:");
    const app = createCollectorApp(store);

    const res = await post(app, VALID);
    expect(res.status).toBe(200);

    const traces = await store.queryTraces({});
    expect(traces.length).toBe(1);
    const trace = traces[0];
    expect(trace.traceId).toBe("trace-golden-0001");
    expect(trace.agentId).toBe("agent-langgraph-demo");

    // All three events round-tripped; absence preserved (no verify.result row).
    const events = trace.turns.flatMap((t) => t.events);
    const types = events.map((e) => e.eventType).sort();
    expect(types).toEqual(["plan.emit", "task.slice", "tool.call"]);
    expect(types).not.toContain("verify.result");

    // The mutating tool.call survived with its harness attrs intact.
    const toolCall = events.find((e) => e.eventType === "tool.call");
    expect(toolCall?.attrs["harness.mutated_state"]).toBe(true);
  });

  it("rejects a non-application/json content-type with 415", async () => {
    const store = new SqliteTraceStore(":memory:");
    const app = createCollectorApp(store);

    const res = await post(app, VALID, "text/plain");
    expect(res.status).toBe(415);

    const traces = await store.queryTraces({});
    expect(traces.length).toBe(0);
  });

  it("rejects a batch missing harness.event_type with 400 and writes nothing", async () => {
    const store = new SqliteTraceStore(":memory:");
    const app = createCollectorApp(store);

    const res = await post(app, MISSING_EVENT_TYPE);
    expect(res.status).toBe(400);

    const traces = await store.queryTraces({});
    expect(traces.length).toBe(0);
  });

  it("rejects malformed JSON with 400 and writes nothing", async () => {
    const store = new SqliteTraceStore(":memory:");
    const app = createCollectorApp(store);

    const res = await post(app, "{ not valid json ");
    expect(res.status).toBe(400);

    const traces = await store.queryTraces({});
    expect(traces.length).toBe(0);
  });

  it("rejects an oversized body with 413 before persisting", async () => {
    const store = new SqliteTraceStore(":memory:");
    // 1 KiB ceiling makes the valid fixture (a few KB) oversized for this test.
    const app = createCollectorApp(store, { maxBodyBytes: 1024 });

    const res = await app.request("/v1/traces", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(VALID)),
      },
      body: VALID,
    });
    expect(res.status).toBe(413);

    const traces = await store.queryTraces({});
    expect(traces.length).toBe(0);
  });
});
