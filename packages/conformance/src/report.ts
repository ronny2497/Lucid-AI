/**
 * @lucid/conformance — the machine-readable ConformanceReport schema (REQ-07).
 *
 * This is the self-declared, re-verifiable conformance artifact (the "badge"),
 * following the OpenID Foundation self-certification model: a JSON document, not
 * an image. It is KEYED TO AN HSC VERSION (`hscVersion`) and to the suite that
 * produced it (`suiteVersion`) so any party can re-run the suite and compare.
 *
 * Three per-layer verdicts mirror the three conformance layers (RESEARCH
 * "Three Layers"):
 *   - otelValidity       — Layer 1 (OTLP envelope, gen_ai.* rules).
 *   - hscExtension       — Layer 2 (harness.event_type / principle / quadrant).
 *   - behavioralHonesty  — Layer 3 (absence-is-signal sequence honesty).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ABSENCE-IS-SIGNAL (prohibition, load-bearing):
 *
 *   This schema describes VERDICTS, never event presence. There is intentionally
 *   NO field here that positive-requires a verification event (or any other
 *   event type) to be present for a PASS. A conformant adapter that honestly
 *   lacks a verification step produces a trace with no such event, and that
 *   trace PASSES. The `<verification>` grep gate in 06-01-PLAN.md asserts this
 *   file contains no event-presence requirement.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Cross-field integrity: a `.superRefine` REJECTS a report claiming
 * `verdict: "PASS"` while ANY layer's `pass` is false — a report cannot be green
 * overall while a sub-layer is red.
 *
 * Note on the `adapter` field: the report carries a STRUCTURAL manifest
 * reference ({ name, hscVersion }) inline rather than importing
 * `@lucid/adapter-sdk`. This keeps the dependency edge one-directional
 * (adapter-sdk → report consumers, never report → adapter-sdk) and avoids a
 * package cycle. The full AdapterManifest lives in @lucid/adapter-sdk.
 */

import { z } from "zod";

/** A single error/diagnostic produced by a conformance check. */
export const ErrorEntrySchema = z
  .object({
    /** Stable machine code for the violation (e.g. a ViolationTag or schema path). */
    code: z.string().min(1),
    /** Human-readable message. */
    message: z.string().min(1),
    /** JSON-pointer-ish path into the trace, when applicable. */
    path: z.string().optional(),
    /** Which conformance layer raised it. */
    layer: z.enum(["otelValidity", "hscExtension", "behavioralHonesty"]),
    /** MUST blocks the badge; WARN is advisory (coverage gaps etc.). */
    severity: z.enum(["error", "warn"]),
  })
  .strict();
export type ErrorEntry = z.infer<typeof ErrorEntrySchema>;

/** The verdict + counters for one conformance layer. */
export const LayerResultSchema = z
  .object({
    /** Layer verdict: true only when no `error`-severity entry was raised. */
    pass: z.boolean(),
    /** Total checks attempted in this layer. */
    checks: z.number().int().nonnegative(),
    /** Checks that passed. */
    passed: z.number().int().nonnegative(),
    /** Per-layer diagnostics. */
    errors: z.array(ErrorEntrySchema),
  })
  .strict();
export type LayerResult = z.infer<typeof LayerResultSchema>;

/** A structural reference to the adapter manifest under test (no SDK import). */
export const AdapterRefSchema = z
  .object({
    name: z.string().min(1),
    hscVersion: z.string().min(1),
  })
  .strict();
export type AdapterRef = z.infer<typeof AdapterRefSchema>;

/** The three-layer verdict block. */
export const LayersSchema = z
  .object({
    otelValidity: LayerResultSchema,
    hscExtension: LayerResultSchema,
    behavioralHonesty: LayerResultSchema,
  })
  .strict();
export type Layers = z.infer<typeof LayersSchema>;

/**
 * The machine-readable conformance report — the re-verifiable badge artifact.
 *
 * Every nested object is `.strict()` so an unknown extra key is rejected. The
 * top-level `.superRefine` enforces the PASS-implies-all-layers-pass invariant.
 */
export const ConformanceReportSchema = z
  .object({
    /** The HSC spec version this report is keyed to (e.g. "v0"). */
    hscVersion: z.string().min(1),
    /** The conformance-suite version that produced the report. */
    suiteVersion: z.string().min(1),
    /** Structural reference to the adapter under test. */
    adapter: AdapterRefSchema,
    /** Per-layer verdicts. */
    layers: LayersSchema,
    /** Top-level verdict. */
    verdict: z.enum(["PASS", "FAIL"]),
    /** Flattened error list across all layers (convenience for badge readers). */
    errors: z.array(ErrorEntrySchema),
    /** ISO 8601 timestamp the report was generated. */
    generatedAt: z.string().min(1),
  })
  .strict()
  .superRefine((report, ctx) => {
    if (report.verdict !== "PASS") {
      return;
    }
    for (const [layerName, layer] of Object.entries(report.layers)) {
      if (!layer.pass) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["verdict"],
          message: `verdict is "PASS" but layer "${layerName}" is failing — a report cannot be green overall while a layer is red`,
        });
      }
    }
  });
export type ConformanceReport = z.infer<typeof ConformanceReportSchema>;
