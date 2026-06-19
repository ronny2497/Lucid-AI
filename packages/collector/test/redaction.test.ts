import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { HscSpan, TraceStore } from "@lucid/store";
import {
  redactSpans,
  DEFAULT_REDACTION_POLICY,
  CONTENT_FIELD_KEYS,
  type RedactionPolicy,
} from "../src/redaction.js";
import { createCollectorApp } from "../src/server.js";

/**
 * Layer 2 (collector-side) redaction processor — REQ-06 defense-in-depth.
 *
 * This is the authoritative redaction plane. These tests pin: default DROP of
 * the two opt-in content fields; deterministic SHA-256 "hash"; verbatim "keep";
 * never-mutate-input; non-content identifiers always survive; AND the receiver
 * wiring runs redaction AFTER validation and BEFORE the store write, so a
 * content field on the wire never reaches writeSpans under the default policy.
 */

const MESSAGES = CONTENT_FIELD_KEYS[0]; // gen_ai.input.messages
const TOOL_ARGS = CONTENT_FIELD_KEYS[1]; // gen_ai.tool.call.arguments

/** Build one minimal HscSpan with the supplied event attrs. */
function spanWith(attrs: Record<string, unknown>): HscSpan {
  return {
    traceId: "trace-1",
    agentId: "agent-1",
    harnessVersion: "v1",
    traceStartTime: 1,
    traceEndTime: 2,
    traceStatusCode: null,
    traceAttrs: {},
    turnId: "turn-1",
    event: {
      eventId: "evt-1",
      traceId: "trace-1",
      parentId: null,
      eventType: "tool.call" as HscSpan["event"]["eventType"],
      principle: "plan_execute" as HscSpan["event"]["principle"],
      quadrantX: "feedforward",
      quadrantY: "computational",
      startTime: 1,
      endTime: 2,
      statusCode: null,
      attrs: attrs as HscSpan["event"]["attrs"],
    },
  };
}

describe("redactSpans — DEFAULT_REDACTION_POLICY", () => {
  it("DROPS both content fields from every span (content not persisted by default)", () => {
    const spans = [
      spanWith({
        "gen_ai.tool.name": "write_file",
        [MESSAGES]: [{ role: "user", content: "secret prompt" }],
        [TOOL_ARGS]: { path: "/etc/passwd" },
      }),
    ];
    const out = redactSpans(spans, DEFAULT_REDACTION_POLICY);
    expect(out[0].event.attrs[MESSAGES]).toBeUndefined();
    expect(out[0].event.attrs[TOOL_ARGS]).toBeUndefined();
    // Non-content identifier survives.
    expect(out[0].event.attrs["gen_ai.tool.name"]).toBe("write_file");
  });

  it("uses DEFAULT_REDACTION_POLICY when no policy is passed", () => {
    const out = redactSpans([spanWith({ [MESSAGES]: "x" })]);
    expect(out[0].event.attrs[MESSAGES]).toBeUndefined();
  });
});

describe("redactSpans — action: hash", () => {
  const hashPolicy: RedactionPolicy = {
    contentFields: { [MESSAGES]: "hash", [TOOL_ARGS]: "hash" },
    defaultAction: "drop",
  };

  it("replaces the content value with a deterministic SHA-256 hex (not the raw value)", () => {
    const raw = { path: "/secret" };
    const out = redactSpans([spanWith({ [TOOL_ARGS]: raw })], hashPolicy);
    const expected = createHash("sha256").update(JSON.stringify(raw)).digest("hex");
    expect(out[0].event.attrs[TOOL_ARGS]).toBe(expected);
    // Not the plaintext.
    expect(out[0].event.attrs[TOOL_ARGS]).not.toEqual(raw);
  });

  it("hashes the same input identically (deterministic) across calls", () => {
    const a = redactSpans([spanWith({ [MESSAGES]: "same" })], hashPolicy);
    const b = redactSpans([spanWith({ [MESSAGES]: "same" })], hashPolicy);
    expect(a[0].event.attrs[MESSAGES]).toBe(b[0].event.attrs[MESSAGES]);
    // 64 hex chars = SHA-256.
    expect(String(a[0].event.attrs[MESSAGES])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("redactSpans — action: keep (explicit operator override)", () => {
  it("preserves the content field verbatim", () => {
    const keepPolicy: RedactionPolicy = {
      contentFields: { [MESSAGES]: "keep" },
      defaultAction: "drop",
    };
    const messages = [{ role: "user", content: "kept on purpose" }];
    const out = redactSpans([spanWith({ [MESSAGES]: messages })], keepPolicy);
    expect(out[0].event.attrs[MESSAGES]).toEqual(messages);
  });
});

describe("redactSpans — immutability + non-content survival", () => {
  it("never mutates the input span array or its attrs (returns a new array)", () => {
    const input = [
      spanWith({ "gen_ai.tool.name": "write_file", [MESSAGES]: "secret" }),
    ];
    const before = JSON.parse(JSON.stringify(input));
    const out = redactSpans(input, DEFAULT_REDACTION_POLICY);
    // Input untouched.
    expect(input).toEqual(before);
    expect(input[0].event.attrs[MESSAGES]).toBe("secret");
    // New array + new span objects.
    expect(out).not.toBe(input);
    expect(out[0]).not.toBe(input[0]);
  });

  it("always preserves harness.* / gen_ai.* identifiers regardless of policy", () => {
    const identifiers = {
      "harness.event_type": "tool.call",
      "harness.principle": "plan_execute",
      "gen_ai.tool.name": "write_file",
      "gen_ai.request.model": "claude-sonnet-4",
    };
    const out = redactSpans(
      [spanWith({ ...identifiers, [MESSAGES]: "x", [TOOL_ARGS]: "y" })],
      DEFAULT_REDACTION_POLICY,
    );
    for (const [k, v] of Object.entries(identifiers)) {
      expect(out[0].event.attrs[k]).toBe(v);
    }
  });
});

/**
 * A TraceStore spy that captures the exact spans handed to writeSpans, so the
 * test can assert no content key reaches persistence (AFTER validate, BEFORE
 * write).
 */
function spyStore(): { store: TraceStore; written: HscSpan[] } {
  const written: HscSpan[] = [];
  const store = {
    async writeSpans(spans: HscSpan[]) {
      written.push(...spans);
    },
    // Unused by the receiver path under test; present to satisfy TraceStore.
    async queryTraces() {
      return [];
    },
    async getMetricsInput() {
      return { traces: [] };
    },
  } as unknown as TraceStore;
  return { store, written };
}

/** Minimal valid OTLP/JSON envelope carrying a content field on the wire. */
function otlpWithContent(): string {
  return JSON.stringify({
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: "gen_ai.agent.id", value: { stringValue: "agent-1" } }],
        },
        scopeSpans: [
          {
            scope: { name: "turn-1" },
            spans: [
              {
                traceId: "trace-1",
                spanId: "evt-1",
                name: "tool.call",
                startTimeUnixNano: "1",
                endTimeUnixNano: "2",
                attributes: [
                  { key: "harness.event_type", value: { stringValue: "tool.call" } },
                  { key: "harness.principle", value: { stringValue: "plan_execute" } },
                  { key: "gen_ai.tool.name", value: { stringValue: "write_file" } },
                  {
                    key: "gen_ai.tool.call.arguments",
                    value: { stringValue: "{\"path\":\"/secret\"}" },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
}

describe("receiver wiring — redaction runs AFTER validation, BEFORE writeSpans", () => {
  it("a content field on the wire never reaches the store under the default policy (still 200)", async () => {
    const { store, written } = spyStore();
    const app = createCollectorApp(store);

    const res = await app.request("/v1/traces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: otlpWithContent(),
    });

    // Validation passed and the request was accepted.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accepted: number };
    expect(body.accepted).toBe(1);

    // The span WAS written, but the content field was dropped before the write.
    expect(written).toHaveLength(1);
    expect(written[0].event.attrs[TOOL_ARGS]).toBeUndefined();
    // The non-content identifier survived persistence.
    expect(written[0].event.attrs["gen_ai.tool.name"]).toBe("write_file");
  });
});
