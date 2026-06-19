import { describe, it, expect } from "vitest";
import {
  GenAiAttrMap,
  PRICING_USD_PER_1K,
  costOf,
  successOf,
} from "../src/index.js";

describe("GenAiAttrMap (A2 provisional gen_ai.* names — isolated)", () => {
  it("maps the logical token/model names to the versioned gen_ai.* paths", () => {
    expect(GenAiAttrMap.inputTokens).toBe("gen_ai.usage.input_tokens");
    expect(GenAiAttrMap.outputTokens).toBe("gen_ai.usage.output_tokens");
    expect(GenAiAttrMap.model).toBe("gen_ai.request.model");
  });

  it("exposes the secondary logical names used by adapters/metrics", () => {
    expect(GenAiAttrMap.provider).toBe("gen_ai.provider.name");
    expect(GenAiAttrMap.toolName).toBe("gen_ai.tool.name");
    expect(GenAiAttrMap.finishReasons).toBe("gen_ai.response.finish_reasons");
  });
});

describe("costOf (never fabricate a price for an unknown model)", () => {
  it("returns null when the model is absent from the pricing table", () => {
    expect(costOf(1000, 1000, "unknown-model")).toBeNull();
  });

  it("returns a positive number for a seeded model", () => {
    const seeded = Object.keys(PRICING_USD_PER_1K)[0];
    const cost = costOf(1000, 1000, seeded);
    expect(cost).not.toBeNull();
    expect(cost as number).toBeGreaterThan(0);
  });

  it("computes input*in + output*out per 1k tokens", () => {
    // claude-sonnet-4-5: input 0.003, output 0.015 per 1k
    const cost = costOf(1000, 1000, "claude-sonnet-4-5");
    expect(cost).toBeCloseTo(0.003 + 0.015, 10);
  });
});

describe("successOf (A3 declared-then-inferred policy with successSource)", () => {
  it("returns successSource 'declared' when the harness declares success", () => {
    const trace = {
      statusCode: 2,
      attrs: { "harness.success": true },
      turns: [],
    };
    const res = successOf(trace);
    expect(res.successSource).toBe("declared");
    expect(res.success).toBe(true);
  });

  it("returns successSource 'inferred' when only a terminal status exists", () => {
    const trace = {
      statusCode: 1, // OTel OK
      attrs: {},
      turns: [],
    };
    const res = successOf(trace);
    expect(res.successSource).toBe("inferred");
    expect(typeof res.success).toBe("boolean");
  });

  it("infers failure from an error terminal status", () => {
    const trace = {
      statusCode: 2, // OTel ERROR
      attrs: {},
      turns: [],
    };
    const res = successOf(trace);
    expect(res.successSource).toBe("inferred");
    expect(res.success).toBe(false);
  });
});
