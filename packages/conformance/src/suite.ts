/**
 * @lucid/conformance — the three-layer suite runner (`runConformanceSuite`).
 *
 * Chains the three independent conformance layers over a single candidate trace
 * and assembles a machine-readable, schema-valid ConformanceReport:
 *
 *   Layer 1 — otelValidity      → validateOtelEnvelope (OTLP envelope + gen_ai.*).
 *   Layer 2 — hscExtension      → validateTrace (schema + structural + predicate).
 *   Layer 3 — behavioralHonesty → checkBehavioralHonesty (absence-is-signal
 *                                  negative honesty rules).
 *
 * Two trace shapes are supported (RESEARCH: validation is offline against either
 * shape). Layer 1 is a HARD check only when the input is OTLP-shaped
 * (`resourceSpans[...]`); for a turns/events trace, Layer 1 records a single
 * advisory WARN ("not-otlp") and PASSES — the OTLP envelope rules simply do not
 * apply to that shape, and a missing envelope is not a conformance failure of a
 * turns/events trace. Layers 2 and 3 operate on the turns/events shape.
 *
 * The verdict is PASS only when ALL THREE layers pass. The assembled object is
 * parsed through ConformanceReportSchema BEFORE returning, so a returned report
 * is always schema-valid (and the PASS-implies-all-layers-pass invariant holds).
 *
 * The input trace is never mutated.
 */

import { validateTrace } from "./validate.js";
import { validateOtelEnvelope, isOtlpShape } from "./otel-envelope.js";
import { checkBehavioralHonesty } from "./behavioral.js";
import {
  ConformanceReportSchema,
  type ConformanceReport,
  type ErrorEntry,
  type LayerResult,
} from "./report.js";

/** The conformance-suite version stamped into every report (keyed alongside hscVersion). */
export const SUITE_VERSION = "0.1.0";

export interface RunSuiteOptions {
  /** The HSC spec version the report is keyed to (e.g. "v0"). */
  hscVersion: string;
  /** The conformance-suite version that produced the report. */
  suiteVersion?: string;
  /** Structural reference to the adapter under test. */
  adapter?: { name: string; hscVersion: string };
}

/**
 * Map an opaque Layer-2 (validateTrace) error into a typed ErrorEntry, deriving
 * a stable violation `code` from the error's discriminator + message. validate.ts
 * emits three error families:
 *   - AJV schema errors        → code "schema-invalid" (or "fabricated-event" when
 *                                the missing field is harness.event_type — an event
 *                                that omits its own identity, per the corpus mapping).
 *   - { structural: true }     → "fabricated-event" (a missing harness.event_type
 *                                is a malformed/identity-falsifying event shape).
 *   - { predicate: true }      → "wrong-principle" / "wrong-quadrant-x" /
 *                                "wrong-quadrant-y" classified from the message.
 */
function mapLayer2Error(raw: unknown): ErrorEntry {
  const e = (raw ?? {}) as Record<string, unknown>;
  const message =
    typeof e.message === "string" ? e.message : JSON.stringify(raw);
  const path =
    typeof e.instancePath === "string" && e.instancePath.length > 0
      ? e.instancePath
      : undefined;

  if (e.structural === true) {
    // Structural pass only checks for a present harness.event_type today; a
    // missing identity tag is the "fabricated/malformed event" violation.
    return {
      code: "fabricated-event",
      message,
      ...(path ? { path } : {}),
      layer: "hscExtension",
      severity: "error",
    };
  }

  if (e.predicate === true) {
    let code = "wrong-principle";
    if (message.includes("quadrant.x")) {
      code = "wrong-quadrant-x";
    } else if (message.includes("quadrant.y")) {
      code = "wrong-quadrant-y";
    } else if (message.includes("principle")) {
      code = "wrong-principle";
    }
    return {
      code,
      message,
      ...(path ? { path } : {}),
      layer: "hscExtension",
      severity: "error",
    };
  }

  // AJV schema error. A required-property failure on harness.event_type is the
  // identity-omission case; everything else is a generic schema violation. AJV
  // enum failures on quadrant values surface here too (e.g. "sideways").
  const params = (e.params ?? {}) as Record<string, unknown>;
  const keyword = typeof e.keyword === "string" ? e.keyword : "";
  const missingProperty =
    typeof params.missingProperty === "string" ? params.missingProperty : "";
  let code = "schema-invalid";
  if (keyword === "required" && missingProperty === "harness.event_type") {
    code = "fabricated-event";
  } else if (path && path.endsWith("quadrant.x")) {
    code = "wrong-quadrant-x";
  } else if (path && path.endsWith("quadrant.y")) {
    code = "wrong-quadrant-y";
  }
  return {
    code,
    message,
    ...(path ? { path } : {}),
    layer: "hscExtension",
    severity: "error",
  };
}

function layerResultFrom(errors: ErrorEntry[], totalChecks: number): LayerResult {
  const errorCount = errors.filter((e) => e.severity === "error").length;
  return {
    pass: errorCount === 0,
    checks: totalChecks,
    passed: Math.max(0, totalChecks - errorCount),
    errors,
  };
}

/**
 * Run the three-layer conformance suite over a single trace and return a
 * schema-valid ConformanceReport. Throws only if the assembled report fails to
 * parse (a programming error in the suite, never a property of the input trace).
 */
export function runConformanceSuite(
  trace: unknown,
  opts: RunSuiteOptions,
): ConformanceReport {
  const suiteVersion = opts.suiteVersion ?? SUITE_VERSION;
  const adapter = opts.adapter ?? { name: "unknown", hscVersion: opts.hscVersion };

  // ── Layer 1: OTel envelope validity ───────────────────────────────────────
  let otelLayer: LayerResult;
  if (isOtlpShape(trace)) {
    const r = validateOtelEnvelope(trace);
    // checks: one per emitted error + the structural walk itself (>=1).
    otelLayer = layerResultFrom(r.errors, Math.max(1, r.errors.length));
  } else {
    // turns/events shape: the OTLP envelope rules do not apply. Record an
    // advisory WARN and PASS — a missing envelope is not a failure here.
    const note: ErrorEntry = {
      code: "not-otlp",
      message:
        "trace is not in the OTLP/JSON envelope shape; Layer 1 (OTel envelope) is advisory for this trace",
      layer: "otelValidity",
      severity: "warn",
    };
    otelLayer = layerResultFrom([note], 1);
  }

  // ── Layer 2: HSC extension validity (existing validateTrace, unchanged) ────
  const l2 = validateTrace(trace);
  const l2Errors = l2.errors.map(mapLayer2Error);
  const hscLayer = layerResultFrom(l2Errors, Math.max(1, l2.errors.length));

  // ── Layer 3: behavioral honesty ────────────────────────────────────────────
  const l3 = checkBehavioralHonesty(trace);
  const behavioralLayer = layerResultFrom(
    l3.violations,
    Math.max(1, l3.violations.length),
  );

  const layers = {
    otelValidity: otelLayer,
    hscExtension: hscLayer,
    behavioralHonesty: behavioralLayer,
  };

  // Aggregate all errors (the flattened convenience list for badge readers).
  const errors: ErrorEntry[] = [
    ...otelLayer.errors,
    ...hscLayer.errors,
    ...behavioralLayer.errors,
  ];

  const verdict: "PASS" | "FAIL" =
    otelLayer.pass && hscLayer.pass && behavioralLayer.pass ? "PASS" : "FAIL";

  const report = {
    hscVersion: opts.hscVersion,
    suiteVersion,
    adapter,
    layers,
    verdict,
    errors,
    generatedAt: new Date().toISOString(),
  };

  // Parse before returning: a returned report is ALWAYS schema-valid.
  return ConformanceReportSchema.parse(report);
}
