/**
 * Tests for the trajectory exporter (05-02, REQ-05).
 *
 * Pins the ON-POLICY boundary (RESEARCH Pitfall 1, threat T-05-06): the exporter
 * serializes PROMPTS ONLY — a stored model completion/response/output attr must
 * NEVER leak into a `PromptRecord` or its serialized form. Also pins: the
 * `sha256:` prompt_hash, the harness_version + provenance flow, the abstract
 * `TraceQuery` read seam, the empty-result case, and the JSONL serialization.
 */

import { describe, it, expect } from "vitest";
import type { TraceFilter, TraceQuery } from "@lucid/diagnostic";
import {
  exportTrajectories,
  serializeToJsonl,
  PROMPT_HASH_PREFIX,
  type PromptRecord,
} from "../../src/l2/trajectory-exporter.js";

/** The model-output text that must NEVER appear in any exported prompt. */
const LEAKED_COMPLETION = "STORED_MODEL_COMPLETION_DO_NOT_LEAK";

/**
 * Build a HarnessTrace-shaped object carrying a `context.load` event with a
 * context payload attr AND a model-output-ish attr that must be skipped.
 */
function syntheticTrace(traceId: string, agentId: string, contextText: string) {
  return {
    hscVersion: "v1",
    traceId,
    agentId,
    harnessVersion: "v42",
    startTime: 1,
    endTime: 2,
    statusCode: 0,
    attrs: {},
    turns: [
      {
        turnId: `${traceId}-turn-0`,
        events: [
          {
            eventId: `${traceId}-e0`,
            traceId,
            parentId: null,
            eventType: "context.load",
            principle: "context",
            quadrantX: "feedforward",
            quadrantY: "computational",
            startTime: 1,
            endTime: 1,
            statusCode: 0,
            attrs: {
              // The context payload the prompt is reconstructed from.
              "context.text": contextText,
              // A model-output attr that MUST NOT be pulled into the prompt.
              "gen_ai.completion": LEAKED_COMPLETION,
              "gen_ai.response.text": LEAKED_COMPLETION,
            },
          },
        ],
      },
    ],
  };
}

/** An in-memory TraceQuery stub mirroring the Phase 2 diff() test pattern. */
function stubQuery(traces: unknown[]): TraceQuery {
  return {
    async queryTraces(_filter: TraceFilter): Promise<never[]> {
      // Cast through unknown: stub returns synthetic HarnessTrace-shaped objects.
      return traces as never[];
    },
  };
}

describe("exportTrajectories", () => {
  it("turns two synthetic traces into two prompts-only PromptRecords", async () => {
    const query = stubQuery([
      syntheticTrace("trace-a", "agent-1", "Write the file then verify."),
      syntheticTrace("trace-b", "agent-1", "Plan before mutating state."),
    ]);

    const records = await exportTrajectories(query, { agentId: "agent-1" });

    expect(records).toHaveLength(2);
    for (const rec of records) {
      expect(rec.prompt_hash.startsWith(PROMPT_HASH_PREFIX)).toBe(true);
      // sha256: + 64 lowercase hex chars.
      expect(rec.prompt_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(rec.prompt.length).toBeGreaterThan(0);
      expect(rec.harness_version).toBe("v42");
      expect(rec.agent_id).toBe("agent-1");
      expect(rec.trace_id.length).toBeGreaterThan(0);
    }
    expect(records[0].trace_id).toBe("trace-a");
    expect(records[1].trace_id).toBe("trace-b");
  });

  it("ON-POLICY: never serializes a stored completion (no completion field, no leak)", async () => {
    const query = stubQuery([syntheticTrace("trace-a", "agent-1", "Do the thing.")]);

    const records = await exportTrajectories(query, {});
    const rec = records[0] as PromptRecord & Record<string, unknown>;

    // No completion/response/output field on the record.
    expect(rec.completion).toBeUndefined();
    expect(rec.response).toBeUndefined();
    expect(rec.output).toBeUndefined();
    expect(rec.output_text).toBeUndefined();

    // The model-output value never appears in the reconstructed prompt...
    expect(rec.prompt.includes(LEAKED_COMPLETION)).toBe(false);
    // ...nor anywhere in the serialized record.
    expect(JSON.stringify(rec).includes(LEAKED_COMPLETION)).toBe(false);
  });

  it("produces a deterministic prompt_hash for the same prompt string", async () => {
    const q1 = stubQuery([syntheticTrace("t1", "a", "identical context")]);
    const q2 = stubQuery([syntheticTrace("t2", "a", "identical context")]);
    const [r1] = await exportTrajectories(q1, {});
    const [r2] = await exportTrajectories(q2, {});
    expect(r1.prompt).toBe(r2.prompt);
    expect(r1.prompt_hash).toBe(r2.prompt_hash);
  });

  it("returns [] for an empty query result (no throw)", async () => {
    const records = await exportTrajectories(stubQuery([]), {});
    expect(records).toEqual([]);
  });

  it("serializeToJsonl emits one parseable prompts-only object per line", async () => {
    const query = stubQuery([
      syntheticTrace("trace-a", "agent-1", "First prompt."),
      syntheticTrace("trace-b", "agent-1", "Second prompt."),
    ]);
    const records = await exportTrajectories(query, {});
    const jsonl = serializeToJsonl(records);
    const lines = jsonl.split("\n");

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const obj = JSON.parse(line) as Record<string, unknown>;
      expect(typeof obj.prompt_hash).toBe("string");
      expect(typeof obj.prompt).toBe("string");
      expect(obj.completion).toBeUndefined();
      expect(line.includes(LEAKED_COMPLETION)).toBe(false);
    }
  });

  it("serializeToJsonl returns an empty string for no records", () => {
    expect(serializeToJsonl([])).toBe("");
  });
});
