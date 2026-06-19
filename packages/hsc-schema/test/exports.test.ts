import { describe, it, expect } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  EVENT_TYPES,
  PRINCIPLES,
  HARNESS_ATTR,
  GEN_AI_ATTR,
  harnessTraceSchema,
  quadrantFor,
  EMITTER_SPECIFIED_Y,
} from "../src/index.js";

describe("package exports — canonical interface", () => {
  it("re-exports EVENT_TYPES with the D-04 lifecycle/evolve event-type strings (incl. the Phase 5 L2 events)", () => {
    expect(EVENT_TYPES).toEqual([
      "context.load",
      "plan.emit",
      "task.slice",
      "tool.call",
      "feedback.check",
      "verify.result",
      "doc.encode",
      "evolve.propose",
      "evolve.apply",
      "evolve.train",
      "evolve.promote",
      "error",
    ]);
  });

  it("registers the two Phase 5 L2 audit event types while preserving the original ten", () => {
    expect(EVENT_TYPES).toContain("evolve.train");
    expect(EVENT_TYPES).toContain("evolve.promote");
    for (const original of [
      "context.load",
      "plan.emit",
      "task.slice",
      "tool.call",
      "feedback.check",
      "verify.result",
      "doc.encode",
      "evolve.propose",
      "evolve.apply",
      "error",
    ]) {
      expect(EVENT_TYPES).toContain(original);
    }
  });

  it("re-exports PRINCIPLES with the 5 principle strings", () => {
    expect(PRINCIPLES).toEqual([
      "context",
      "plan_execute",
      "feedback",
      "one_at_a_time",
      "codebase_docs",
    ]);
  });

  it("re-exports HARNESS_ATTR mapping logical names to harness.* paths", () => {
    expect(HARNESS_ATTR.eventType).toBe("harness.event_type");
    expect(HARNESS_ATTR.principle).toBe("harness.principle");
    expect(HARNESS_ATTR.quadrantX).toBe("harness.quadrant.x");
    expect(HARNESS_ATTR.quadrantY).toBe("harness.quadrant.y");
    expect(HARNESS_ATTR.version).toBe("harness.version");
    expect(HARNESS_ATTR.mutatedState).toBe("harness.mutated_state");
    expect(HARNESS_ATTR.changeManifestId).toBe("harness.change_manifest_id");
    expect(HARNESS_ATTR.inferred).toBe("harness.inferred");
    // No harness.* path leaks into the gen_ai.* namespace.
    for (const path of Object.values(HARNESS_ATTR)) {
      expect(path.startsWith("harness.")).toBe(true);
      expect(path.startsWith("gen_ai.")).toBe(false);
    }
  });

  it("re-exports GEN_AI_ATTR with the 9 reused OTel paths", () => {
    expect(Object.values(GEN_AI_ATTR).sort()).toEqual(
      [
        "gen_ai.operation.name",
        "gen_ai.provider.name",
        "gen_ai.agent.name",
        "gen_ai.agent.id",
        "gen_ai.request.model",
        "gen_ai.usage.input_tokens",
        "gen_ai.usage.output_tokens",
        "gen_ai.tool.name",
        "gen_ai.response.finish_reasons",
      ].sort()
    );
    // Every reused path stays in the gen_ai.* namespace.
    for (const path of Object.values(GEN_AI_ATTR)) {
      expect(path.startsWith("gen_ai.")).toBe(true);
    }
  });

  it("re-exports quadrantFor and EMITTER_SPECIFIED_Y", () => {
    expect(typeof quadrantFor).toBe("function");
    expect(EMITTER_SPECIFIED_Y instanceof Set).toBe(true);
  });
});

describe("harnessTraceSchema — JSON Schema 2020-12 compiles under AJV strict", () => {
  it("is the draft 2020-12 HarnessTrace root schema", () => {
    expect(harnessTraceSchema.$schema).toBe(
      "https://json-schema.org/draft/2020-12/schema"
    );
    expect(harnessTraceSchema.$id).toBe("https://lucid.dev/schema/v0/HarnessTrace");
  });

  it("compiles under AJV { strict: true } without throwing", () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    expect(() => ajv.compile(harnessTraceSchema)).not.toThrow();
  });

  it("accepts a minimal valid trace and rejects unknown event types/principles", () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(harnessTraceSchema);

    const validTrace = {
      hsc_version: "v0",
      trace_id: "abc123",
      turns: [
        {
          turn_id: "t1",
          events: [
            {
              span_id: "s1",
              "harness.event_type": "tool.call",
              "harness.principle": "plan_execute",
            },
          ],
        },
      ],
    };
    expect(validate(validTrace)).toBe(true);

    const badEventType = structuredClone(validTrace);
    badEventType.turns[0].events[0]["harness.event_type"] = "not.a.real.event";
    expect(validate(badEventType)).toBe(false);

    const badPrinciple = structuredClone(validTrace);
    badPrinciple.turns[0].events[0]["harness.principle"] = "not_a_principle";
    expect(validate(badPrinciple)).toBe(false);
  });

  it("preserves honest absence: tool.call{mutated_state:true} with no verify.result is valid", () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(harnessTraceSchema);

    const trace = {
      hsc_version: "v0",
      trace_id: "abc123",
      turns: [
        {
          turn_id: "t1",
          events: [
            {
              span_id: "s1",
              "harness.event_type": "tool.call",
              "harness.principle": "plan_execute",
              "harness.mutated_state": true,
            },
          ],
        },
      ],
    };
    expect(validate(trace)).toBe(true);
  });
});
