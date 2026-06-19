/**
 * Integration tests for the `/api/*` query routes mounted via
 * `mountQueryRoutes` onto the collector app.
 *
 * The store is seeded directly with `writeSpans(HscSpan[])` (the same write
 * unit the receiver produces) so the routes are exercised over real persisted
 * data without depending on the OTLP wire path. The three routes are driven via
 * `app.request`, exactly as the explorer UI / CLI fetch them.
 *
 * RED until src/routes/* are implemented.
 */

import { describe, it, expect } from "vitest";
import { SqliteTraceStore } from "@lucid/store";
import type { HscSpan } from "@lucid/store";
import { GenAiAttrMap } from "@lucid/hsc-map";
import { HARNESS_ATTR } from "@lucid/hsc-schema";
import { createCollectorApp } from "../server.js";
import { mountQueryRoutes } from "./index.js";

const OK = 1;
const ERROR = 2;

interface SeedEvent {
  eventId: string;
  eventType: string;
  statusCode?: number | null;
  attrs?: Record<string, unknown>;
}

function spansForTrace(
  traceId: string,
  agentId: string,
  opts: {
    version?: string;
    startTime?: number;
    endTime?: number | null;
    statusCode?: number | null;
    events: SeedEvent[];
  },
): HscSpan[] {
  const startTime = opts.startTime ?? 1_000;
  return opts.events.map((ev, i) => ({
    traceId,
    agentId,
    harnessVersion: opts.version ?? "1.0.0",
    traceStartTime: startTime,
    traceEndTime: opts.endTime ?? startTime + 1000,
    traceStatusCode: opts.statusCode ?? OK,
    traceAttrs: {},
    turnId: "turn-1",
    event: {
      eventId: ev.eventId,
      traceId,
      parentId: null,
      // eventType is a wire string; the store stores it verbatim.
      eventType: ev.eventType as never,
      principle: null,
      quadrantX: null,
      quadrantY: null,
      startTime: startTime + i,
      endTime: startTime + i + 1,
      statusCode: ev.statusCode ?? null,
      attrs: (ev.attrs ?? {}) as never,
    },
  }));
}

async function seededApp() {
  const store = new SqliteTraceStore(":memory:");
  const app = mountQueryRoutes(createCollectorApp(store), store);

  // Trace A: agent-a, gpt-4o (priced), 1 errored + 1 ok mutating tool.call.
  await store.writeSpans(
    spansForTrace("trace-a", "agent-a", {
      statusCode: OK,
      startTime: 1_000,
      endTime: 1_500,
      events: [
        {
          eventId: "a-plan",
          eventType: "plan.emit",
          attrs: {
            [GenAiAttrMap.model]: "gpt-4o",
            [GenAiAttrMap.inputTokens]: 1000,
            [GenAiAttrMap.outputTokens]: 1000,
          },
        },
        {
          eventId: "a-tool-ok",
          eventType: "tool.call",
          statusCode: OK,
          attrs: { [HARNESS_ATTR.mutatedState]: true },
        },
        {
          eventId: "a-tool-err",
          eventType: "tool.call",
          statusCode: ERROR,
          attrs: { [HARNESS_ATTR.mutatedState]: true },
        },
      ],
    }),
  );

  // Trace B: a DIFFERENT agent — must not leak into agent-a queries.
  await store.writeSpans(
    spansForTrace("trace-b", "agent-b", {
      statusCode: ERROR,
      events: [{ eventId: "b-plan", eventType: "plan.emit" }],
    }),
  );

  return { store, app };
}

describe("GET /api/traces", () => {
  it("returns only the requested agent's runs as run-list rows", async () => {
    const { app } = await seededApp();
    const res = await app.request("/api/traces?agent=agent-a");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { traces: Array<Record<string, unknown>> };
    expect(body.traces).toHaveLength(1);
    const rowRun = body.traces[0];
    expect(rowRun.traceId).toBe("trace-a");
    expect(rowRun.agentId).toBe("agent-a");
    expect(rowRun.eventCount).toBe(3);
    expect(rowRun.durationNs).toBe(500);
    // gpt-4o is priced: (1000*0.0025 + 1000*0.01)/1000 = 0.0125
    expect(rowRun.cost).toBeCloseTo(0.0125, 6);
  });

  it("returns all runs when no filter is given", async () => {
    const { app } = await seededApp();
    const res = await app.request("/api/traces");
    const body = (await res.json()) as { traces: unknown[] };
    expect(body.traces).toHaveLength(2);
  });
});

describe("GET /api/traces/:id", () => {
  it("returns the full trace (turns->events) for a known id", async () => {
    const { app } = await seededApp();
    const res = await app.request("/api/traces/trace-a");
    expect(res.status).toBe(200);
    const trace = (await res.json()) as {
      traceId: string;
      turns: Array<{ events: unknown[] }>;
    };
    expect(trace.traceId).toBe("trace-a");
    const events = trace.turns.flatMap((t) => t.events);
    expect(events).toHaveLength(3);
  });

  it("returns 404 for an unknown id", async () => {
    const { app } = await seededApp();
    const res = await app.request("/api/traces/does-not-exist");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/metrics", () => {
  it("returns the BaseMetrics shape for the agent window", async () => {
    const { app } = await seededApp();
    const res = await app.request("/api/metrics?agent=agent-a");
    expect(res.status).toBe(200);
    const m = (await res.json()) as Record<string, unknown>;
    expect(m).toHaveProperty("successRate");
    expect(m).toHaveProperty("costPerRun");
    expect(m).toHaveProperty("latencyP50");
    expect(m).toHaveProperty("latencyP95");
    expect(m).toHaveProperty("totalTokens");
    expect(m).toHaveProperty("toolErrorRate");
    // agent-a: priced run -> cost known; OK status -> success; 1/2 tool.call errored.
    expect(m.costUnknown).toBe(false);
    expect(m.successRate).toBe(1);
    expect(m.totalTokens).toBe(2000);
    expect(m.toolErrorRate).toBeCloseTo(0.5, 6);
  });

  it("does not let the ingestion route change behavior (additive mount)", async () => {
    const { app } = await seededApp();
    // The receiver still rejects a non-JSON content-type with 415.
    const res = await app.request("/v1/traces", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "nope",
    });
    expect(res.status).toBe(415);
  });
});
