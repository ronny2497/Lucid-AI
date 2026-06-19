import { describe, expect, it } from "vitest";

import { AdapterManifestSchema } from "../src/manifest.js";

/**
 * RED scaffold for the AdapterManifest schema (REQ-07 authoring contract).
 *
 * Pins: a well-formed manifest parses; eventCoverage entries must be members of
 * EVENT_TYPES; an empty name is rejected; conformanceReport must be a URL when
 * present; unknown keys are rejected; coverage/honestAbsences overlap is
 * rejected.
 */

function baseManifest() {
  return {
    name: "langgraph-adapter",
    version: "0.1.0",
    hscVersion: "v0",
    framework: "langgraph@0.2",
    eventCoverage: ["context.load", "plan.emit", "tool.call"],
    // The framework has no native verification hook → honest absence.
    honestAbsences: ["verify.result", "feedback.check"],
  };
}

describe("AdapterManifestSchema", () => {
  it("parses a well-formed manifest", () => {
    const parsed = AdapterManifestSchema.safeParse(baseManifest());
    expect(parsed.success).toBe(true);
  });

  it("parses a manifest with an optional conformanceReport URL", () => {
    const m = { ...baseManifest(), conformanceReport: "https://example.com/report.json" };
    expect(AdapterManifestSchema.safeParse(m).success).toBe(true);
  });

  it("REJECTS an eventCoverage entry that is not a member of EVENT_TYPES", () => {
    const m = { ...baseManifest(), eventCoverage: ["context.load", "not.an.event"] };
    expect(AdapterManifestSchema.safeParse(m).success).toBe(false);
  });

  it("REJECTS an empty name", () => {
    const m = { ...baseManifest(), name: "" };
    expect(AdapterManifestSchema.safeParse(m).success).toBe(false);
  });

  it("REJECTS a non-URL conformanceReport", () => {
    const m = { ...baseManifest(), conformanceReport: "not-a-url" };
    expect(AdapterManifestSchema.safeParse(m).success).toBe(false);
  });

  it("REJECTS an unknown extra key (strict)", () => {
    const m = { ...baseManifest(), vendor: "acme" };
    expect(AdapterManifestSchema.safeParse(m).success).toBe(false);
  });

  it("REJECTS overlap between eventCoverage and honestAbsences", () => {
    const m = {
      ...baseManifest(),
      eventCoverage: ["context.load", "verify.result"],
      honestAbsences: ["verify.result"],
    };
    expect(AdapterManifestSchema.safeParse(m).success).toBe(false);
  });

  it("REJECTS a honestAbsences entry that is not a member of EVENT_TYPES", () => {
    const m = { ...baseManifest(), honestAbsences: ["totally.fake"] };
    expect(AdapterManifestSchema.safeParse(m).success).toBe(false);
  });
});
