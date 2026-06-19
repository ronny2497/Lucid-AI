import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  validateOtelEnvelope,
  isOtlpShape,
  PINNED_OPERATION_NAMES,
} from "../src/otel-envelope.js";

/**
 * Layer 1 (OTel-envelope validity) RED → GREEN coverage.
 *
 * Asserts the OTLP/JSON shape walk and the three otel-mapping.md attribute
 * rules: gen_ai.system deprecation, the two-namespace rule, and the pinned
 * gen_ai.operation.name set. Crucially, NONE of these rules reasons about event
 * PRESENCE (absence-is-signal): a span carrying no verification concept is fine.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const otlpExample = join(repoRoot, "examples", "hermes-trace.otlp.json");
const goldenFail = (name: string) =>
  JSON.parse(
    readFileSync(join(here, "..", "src", "golden", "fail", name), "utf8"),
  );

function codes(errors: { code: string }[]): string[] {
  return errors.map((e) => e.code);
}

describe("validateOtelEnvelope — well-formed OTLP", () => {
  it("a well-formed OTLP/JSON trace (hermes OTLP example) passes Layer 1 with no errors", () => {
    const trace = JSON.parse(readFileSync(otlpExample, "utf8"));
    const result = validateOtelEnvelope(trace);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("isOtlpShape recognizes the OTLP envelope and rejects the turns/events shape", () => {
    const otlp = JSON.parse(readFileSync(otlpExample, "utf8"));
    expect(isOtlpShape(otlp)).toBe(true);
    expect(isOtlpShape({ turns: [] })).toBe(false);
    expect(isOtlpShape(null)).toBe(false);
  });
});

describe("validateOtelEnvelope — broken envelope nesting", () => {
  it("flags a trace missing the resourceSpans array with a path-bearing error", () => {
    const result = validateOtelEnvelope({ notSpans: [] });
    expect(result.valid).toBe(false);
    expect(codes(result.errors)).toContain("otel-envelope");
    expect(result.errors[0].path).toBe("/resourceSpans");
    expect(result.errors[0].layer).toBe("otelValidity");
  });

  it("flags missing scopeSpans / spans nesting with a path-bearing error", () => {
    const missingScope = validateOtelEnvelope({ resourceSpans: [{}] });
    expect(missingScope.valid).toBe(false);
    expect(missingScope.errors[0].path).toBe("/resourceSpans/0/scopeSpans");

    const missingSpans = validateOtelEnvelope({
      resourceSpans: [{ scopeSpans: [{}] }],
    });
    expect(missingSpans.valid).toBe(false);
    expect(missingSpans.errors[0].path).toBe(
      "/resourceSpans/0/scopeSpans/0/spans",
    );
  });
});

describe("validateOtelEnvelope — gen_ai.system deprecation", () => {
  it("flags a span carrying gen_ai.system (deprecated, superseded by gen_ai.provider.name)", () => {
    const result = validateOtelEnvelope(goldenFail("gen-ai-system-present.json"));
    expect(result.valid).toBe(false);
    expect(codes(result.errors)).toContain("gen-ai-system-present");
  });
});

describe("validateOtelEnvelope — two-namespace rule", () => {
  it("flags a harness concept placed under the gen_ai.* namespace", () => {
    const result = validateOtelEnvelope(goldenFail("harness-under-gen-ai.json"));
    expect(result.valid).toBe(false);
    expect(codes(result.errors)).toContain("harness-under-gen-ai");
  });
});

describe("validateOtelEnvelope — pinned gen_ai.operation.name set", () => {
  it("the pinned set is exactly {execute_tool, invoke_agent, chat}", () => {
    expect([...PINNED_OPERATION_NAMES].sort()).toEqual(
      ["chat", "execute_tool", "invoke_agent"].sort(),
    );
  });

  it("flags a gen_ai.operation.name outside the pinned set", () => {
    const trace = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  name: "bogus op",
                  attributes: [
                    {
                      key: "gen_ai.operation.name",
                      value: { stringValue: "context_load" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = validateOtelEnvelope(trace);
    expect(result.valid).toBe(false);
    expect(codes(result.errors)).toContain("wrong-operation-name");
  });

  it("accepts each pinned operation.name value", () => {
    for (const op of PINNED_OPERATION_NAMES) {
      const trace = {
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    name: `op ${op}`,
                    attributes: [
                      { key: "gen_ai.operation.name", value: { stringValue: op } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };
      expect(validateOtelEnvelope(trace).valid).toBe(true);
    }
  });
});

describe("validateOtelEnvelope — never mutates input", () => {
  it("leaves the input trace deeply unchanged", () => {
    const trace = JSON.parse(readFileSync(otlpExample, "utf8"));
    const before = JSON.stringify(trace);
    validateOtelEnvelope(trace);
    expect(JSON.stringify(trace)).toBe(before);
  });
});
