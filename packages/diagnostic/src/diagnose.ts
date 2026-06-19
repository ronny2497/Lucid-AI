/**
 * @lucid/diagnostic — the `diagnose()` orchestrator (REQ-04; Phase 2 exit gate).
 *
 * `diagnose(trace, config?)` is the single callable that turns a Harness Trace into
 * a `DiagnosticResult`: a per-principle scorecard, the feedforward/feedback ×
 * computational/inferential 2×2 plot, and a ranked list of named findings with
 * concrete remediations. It is a PURE read-model: it never mutates the input trace
 * or any store. With the LLM-judge layer off (the default — PRD §10), it is fully
 * deterministic: two runs on the same trace produce identical output (modulo the
 * `generatedAt` timestamp).
 *
 * Pipeline (RESEARCH "Full detector run"):
 *   1. validate + normalize input (loadTrace → canonical structured HarnessTrace)
 *   2. run every enabled rule detector from `detectorRegistry` → DetectorHit[]
 *   3. scorePrinciples(trace, hits) → PrincipleScore[]   (coverage-weighted scorecard)
 *   4. buildPlot(trace) → Plot2x2                        (2×2 + empty-column detection)
 *   5. buildFindings(hits, scores, plot, trace) → Finding[] (ranked, named, F1..Fn)
 *   6. assemble + validate the DiagnosticResult against the frozen schema
 *
 * ## Input validation (threat T-02-08)
 *
 * The trace is attacker-influenceable input. `diagnose` validates it against the
 * Phase 0 `harnessTraceSchema` (the canonical HSC JSON Schema, via ajv) BEFORE any
 * detector runs, and rejects a malformed/structurally-invalid trace rather than
 * scoring it. The Phase 1 store's already-structured trace shape (which does not use
 * the flat dotted layout) is accepted via a structural guard.
 *
 * ## Determinism (threat T-02-10)
 *
 * LLM-judge detectors are `defaultEnabled: false`; the rule-based path is the only
 * one wired here and produces deterministic output. The LLM-judge refinement hook is
 * a documented seam (it would refine a score WITHIN the band a rule established and
 * never override a rule finding — RESEARCH Anti-Pattern); when enabled it routes
 * through Phase 1's provider abstraction, never raw fetch.
 */

// The HSC JSON Schema declares the draft 2020-12 dialect, so the 2020 ajv build
// (not the default draft-07 build) is required to compile it.
import * as Ajv2020Module from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv/dist/2020.js";
import * as addFormatsModule from "ajv-formats";
import { harnessTraceSchema } from "@lucid/hsc-schema";
// `ajv/dist/2020` and `ajv-formats` are CommonJS; under NodeNext the runtime
// value is on `.default` for esbuild/Node but tsc sees the namespace — unwrap.
const Ajv2020 = ((Ajv2020Module as { default?: unknown }).default ??
  Ajv2020Module) as typeof import("ajv/dist/2020.js").default;
const addFormats = ((addFormatsModule as { default?: unknown }).default ??
  addFormatsModule) as typeof import("ajv-formats")["default"];
import type { DetectorHit, DiagnosticConfig, HarnessTrace } from "./types.js";
import { detectorRegistry } from "./detectors/index.js";
import { scorePrinciples } from "./scorers/index.js";
import { buildPlot } from "./plotter/index.js";
import { buildFindings } from "./findings/index.js";
import { DiagnosticResultSchema, type DiagnosticResult } from "./schema.js";
import { loadTrace } from "./loader.js";

// Compile the Phase 0 HSC JSON Schema once (ajv is reused across calls).
const ajv = new Ajv2020({ allErrors: false, strict: false });
addFormats(ajv);
const validateFlatTrace: ValidateFunction = ajv.compile(harnessTraceSchema);

/** True when the input presents the flat OTLP layout (trace_id / turn_id keys). */
function isFlatShape(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const o = input as Record<string, unknown>;
  return "trace_id" in o || "hsc_version" in o;
}

/** Structural guard for the already-structured store/runtime trace shape. */
function isStructuredTrace(input: unknown): input is HarnessTrace {
  if (!input || typeof input !== "object") return false;
  const o = input as Record<string, unknown>;
  return typeof o["traceId"] === "string" && Array.isArray(o["turns"]);
}

/**
 * Validate an incoming trace and reject malformed input (T-02-08). Flat-shaped
 * traces are validated against the canonical HSC JSON Schema; the Phase 1 store's
 * structured trace passes a lighter structural guard.
 */
function assertValidTrace(input: unknown): void {
  if (isFlatShape(input)) {
    if (!validateFlatTrace(input)) {
      const first = validateFlatTrace.errors?.[0];
      const detail = first ? `${first.instancePath || "(root)"} ${first.message}` : "unknown error";
      throw new TypeError(`diagnose: malformed trace — ${detail}`);
    }
    return;
  }
  if (isStructuredTrace(input)) return;
  throw new TypeError(
    "diagnose: malformed trace — expected a flat HSC trace (trace_id + turns) or a structured HarnessTrace (traceId + turns)",
  );
}

/**
 * Diagnose a Harness Trace: run the detector registry, score every principle, build
 * the 2×2 plot, assemble ranked findings, and return a schema-valid `DiagnosticResult`.
 *
 * @param trace a flat HSC trace (the golden-fixture / Phase 0 producer shape) or an
 *   already-structured `HarnessTrace` (the Phase 1 store shape).
 * @param config optional per-run knobs (enable LLM-judge, restrict detector ids,
 *   override inferred-evidence confidence).
 * @returns a `DiagnosticResult` validating against `DiagnosticResultSchema`.
 */
export function diagnose(trace: unknown, config: DiagnosticConfig = {}): DiagnosticResult {
  // 1. Validate untrusted input, then normalize to the canonical structured trace.
  assertValidTrace(trace);
  const normalized: HarnessTrace = loadTrace(trace);

  const llmJudgeEnabled = config.llmJudgeEnabled === true;
  const restrictTo = config.detectorIds ? new Set(config.detectorIds) : null;

  // 2. Run every enabled detector. LLM-judge detectors stay off unless explicitly
  //    enabled; rule detectors run when defaultEnabled and not excluded by config.
  const detectorOptions = {
    llmJudgeEnabled,
    inferredConfidence: config.inferredConfidence,
  };
  const allHits: DetectorHit[] = [];
  for (const detector of detectorRegistry) {
    if (restrictTo && !restrictTo.has(detector.id)) continue;
    const enabled =
      detector.kind === "llm-judge" ? llmJudgeEnabled : detector.defaultEnabled;
    if (!enabled) continue;
    allHits.push(...detector.run(normalized, detectorOptions));
  }

  // 3–5. Score, plot, build findings (each is a pure read over the normalized trace).
  const principles = scorePrinciples(normalized, allHits);
  const plot2x2 = buildPlot(normalized);
  const findings = buildFindings(allHits, principles, plot2x2, normalized);

  // 6. Assemble + validate the result against the frozen output contract.
  const result: DiagnosticResult = {
    traceId: normalized.traceId,
    agentId: normalized.agentId,
    ...(normalized.harnessVersion ? { harness_version: normalized.harnessVersion } : {}),
    principles,
    findings,
    plot2x2,
    generatedAt: new Date().toISOString(),
    llmJudgeEnabled,
  };
  return DiagnosticResultSchema.parse(result);
}
