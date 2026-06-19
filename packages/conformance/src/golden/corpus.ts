/**
 * @lucid/conformance — the golden-trace corpus INDEX (Phase 6, Wave 0 contract).
 *
 * This module is a *design contract*, authored BEFORE the conformance suite
 * (06-02) materializes the trace files it points at. It enumerates the three
 * categories of golden traces (RESEARCH "Golden-Trace Corpus Strategy"):
 *
 *   1. pass        — valid HSC v0 traces (one per shape), including the hermes
 *                    reference-adapter capture (`examples/hermes-trace.json`).
 *   2. fail        — deliberately invalid traces, one per violation type, each
 *                    declaring the violation tag(s) the suite must report.
 *   3. behavioral  — abstract harness scenarios for the absence-is-signal
 *                    sequence checks (Layer 3, built in 06-02). These are NOT
 *                    full traces; they are scenario placeholders here.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ABSENCE-IS-SIGNAL (load-bearing for 06-02; D-05 / HSC spec §4):
 *
 *   The corpus index MUST be able to represent a PASS-category trace whose
 *   declared event set contains NO `verify.result` and NO `feedback.check`.
 *   A `tool.call{mutated_state:true}` with no following verification step is a
 *   VALID trace — the absence is the signal, not a failure. Conformance Layers
 *   1–2 (OTel validity, HSC extension validity) reason about each event in
 *   isolation; they MUST NOT treat the *presence* of any event type as a pass
 *   condition. Only Layer 3 (behavioral honesty, 06-02) reasons about whole
 *   sequences, and even then it asserts the adapter emitted NOTHING for the
 *   absent step (it must not fabricate a `verify.result`).
 *
 *   Concretely: `GOLDEN_CORPUS` pins `pass-honest-absence` — a pass entry whose
 *   `declaredEvents` omits both `verify.result` and `feedback.check`. The
 *   `golden-corpus.test.ts` RED test asserts at least one such entry exists, so
 *   any future edit that "tidies up" the corpus by giving every pass trace a
 *   verification step will break the build.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { EVENT_TYPES, type HscEventType } from "@lucid/hsc-schema";

/** The three golden-trace categories (RESEARCH "Golden-Trace Corpus Strategy"). */
export type GoldenCategory = "pass" | "fail" | "behavioral";

/** A corpus entry's declared verdict. `NA` is for behavioral scenarios whose
 *  verdict is asserted by the sequence scanner, not the schema validator. */
export type ExpectedVerdict = "PASS" | "FAIL" | "NA";

/**
 * The documented closed union of violation tags a `fail` entry may declare.
 * Every `expectedErrorTag` on a fail entry MUST be a member of this union; the
 * RED test rejects any tag outside it. New violation kinds require widening
 * this union deliberately (and updating the suite + docs together).
 *
 *   - wrong-principle       — harness.principle does not match the §2 binding,
 *                             OR the principle is absent where one is required.
 *   - wrong-quadrant-x      — harness.quadrant.x does not match quadrantFor().x.
 *   - wrong-quadrant-y      — harness.quadrant.y violates the §3.2 y-axis rule
 *                             (table-derived / emitter-specified / override).
 *   - fabricated-event      — an event that should not exist for the scenario
 *                             (e.g. a synthesized verify.result), OR an event
 *                             that omits/falsifies its own identity.
 *   - prohibited-inference  — harness.inferred=true on a type where inference is
 *                             prohibited (spec §5.2: anything but plan.emit /
 *                             context.load).
 *   - gen-ai-system-present — `gen_ai.system` emitted (superseded by
 *                             gen_ai.provider.name; Layer 1).
 *   - harness-under-gen-ai  — a `harness.*` attribute placed under the
 *                             `gen_ai.*` namespace (Layer 1 anti-pattern).
 */
export const VIOLATION_TAGS = [
  "wrong-principle",
  "wrong-quadrant-x",
  "wrong-quadrant-y",
  "fabricated-event",
  "prohibited-inference",
  "gen-ai-system-present",
  "harness-under-gen-ai",
] as const;

/** Union of the documented violation-tag string literals. */
export type ViolationTag = (typeof VIOLATION_TAGS)[number];

/** Runtime membership set for the violation-tag union (used by the RED test). */
export const VIOLATION_TAG_SET: ReadonlySet<string> = new Set<string>(VIOLATION_TAGS);

/**
 * One golden-corpus entry. `traceRef` is a path RELATIVE to this `golden/`
 * directory; 06-02 drops the actual trace files under `pass/`, `fail/`, and
 * `behavioral/`. `declaredEvents` records the HSC event types the entry's trace
 * is expected to contain — it is the field the absence-is-signal invariant is
 * checked against, and it MUST NOT be used by Layers 1–2 as a pass condition.
 */
export interface GoldenEntry {
  /** Stable, human-readable id, unique within the corpus. */
  readonly id: string;
  /** Which of the three categories this entry belongs to. */
  readonly category: GoldenCategory;
  /** Path to the trace file, relative to `packages/conformance/src/golden/`. */
  readonly traceRef: string;
  /** One-line description of what the entry exercises. */
  readonly description: string;
  /** Expected top-level verdict for this entry. */
  readonly expectedVerdict: ExpectedVerdict;
  /**
   * The violation tags a `fail` entry is expected to surface. MUST be empty for
   * `pass`/`behavioral` entries and non-empty for `fail` entries (RED test).
   */
  readonly expectedErrorTags: readonly ViolationTag[];
  /**
   * The HSC event types the entry's trace is expected to declare. For the
   * absence-is-signal invariant: a `pass` entry whose `declaredEvents` omits
   * BOTH `verify.result` and `feedback.check` must remain representable.
   */
  readonly declaredEvents: readonly HscEventType[];
}

/**
 * The seed corpus index. 06-02 materializes the referenced trace files; the
 * existing Phase 0 fail fixtures live under `packages/conformance/test/fixtures`
 * and are mirrored here into `fail/` with violation-tag mappings.
 */
export const GOLDEN_CORPUS: readonly GoldenEntry[] = [
  // ── pass ──────────────────────────────────────────────────────────────
  {
    id: "pass-hermes-reference",
    category: "pass",
    traceRef: "pass/hermes-trace.json",
    description:
      "The Phase 0 hermes reference-adapter capture (mirror of examples/hermes-trace.json).",
    expectedVerdict: "PASS",
    expectedErrorTags: [],
    // Honest absence already: the hermes capture has NO verify.result /
    // feedback.check. It is the canonical absence-is-signal pass case.
    declaredEvents: ["context.load", "plan.emit", "tool.call"],
  },
  {
    id: "pass-honest-absence",
    category: "pass",
    traceRef: "pass/honest-absence.json",
    description:
      "A mutating tool.call with NO following verify.result/feedback.check — the absence-is-signal PASS case (D-05). MUST remain representable.",
    expectedVerdict: "PASS",
    expectedErrorTags: [],
    // Intentionally omits verify.result AND feedback.check.
    declaredEvents: ["context.load", "plan.emit", "tool.call"],
  },
  {
    id: "pass-full-lifecycle",
    category: "pass",
    traceRef: "pass/full-lifecycle.json",
    description:
      "A valid trace exercising the full lifecycle INCLUDING a verify.result + feedback.check (the present-verification counterpart to pass-honest-absence).",
    expectedVerdict: "PASS",
    expectedErrorTags: [],
    declaredEvents: [
      "context.load",
      "plan.emit",
      "task.slice",
      "tool.call",
      "feedback.check",
      "verify.result",
      "doc.encode",
    ],
  },

  // ── fail (mirrors of the Phase 0 fixtures + the launch violation set) ──
  {
    id: "fail-bad-quadrant",
    category: "fail",
    traceRef: "fail/bad-quadrant.json",
    description: "context.load tagged harness.quadrant.x = 'sideways' (not a valid axis value).",
    expectedVerdict: "FAIL",
    expectedErrorTags: ["wrong-quadrant-x"],
    declaredEvents: ["context.load"],
  },
  {
    id: "fail-wrong-principle",
    category: "fail",
    traceRef: "fail/wrong-principle.json",
    description: "tool.call tagged harness.principle = 'one_at_a_time' (the §2 binding is 'plan_execute').",
    expectedVerdict: "FAIL",
    expectedErrorTags: ["wrong-principle"],
    declaredEvents: ["tool.call"],
  },
  {
    id: "fail-wrong-quadrant-y",
    category: "fail",
    traceRef: "fail/wrong-quadrant-predicate.json",
    description: "context.load tagged harness.quadrant.y = 'inferential' (the table value is 'computational').",
    expectedVerdict: "FAIL",
    expectedErrorTags: ["wrong-quadrant-y"],
    declaredEvents: ["context.load"],
  },
  {
    id: "fail-missing-principle",
    category: "fail",
    traceRef: "fail/missing-principle.json",
    description:
      "context.load with NO harness.principle — an absent required principle is a principle-binding violation.",
    expectedVerdict: "FAIL",
    expectedErrorTags: ["wrong-principle"],
    declaredEvents: ["context.load"],
  },
  {
    id: "fail-feedback-check-missing-y",
    category: "fail",
    traceRef: "fail/feedback-check-missing-y.json",
    description:
      "feedback.check with no emitter-specified harness.quadrant.y (§3.2.1 requires the emitter to set it).",
    expectedVerdict: "FAIL",
    expectedErrorTags: ["wrong-quadrant-y"],
    declaredEvents: ["feedback.check"],
  },
  {
    id: "fail-missing-event-type",
    category: "fail",
    traceRef: "fail/missing-event-type.json",
    description:
      "An event that omits harness.event_type entirely — it falsifies/omits its own identity (a malformed/fabricated event shape).",
    expectedVerdict: "FAIL",
    expectedErrorTags: ["fabricated-event"],
    declaredEvents: [],
  },
  {
    id: "fail-prohibited-inference",
    category: "fail",
    traceRef: "fail/prohibited-inference.json",
    description:
      "harness.inferred = true on tool.call — inference is permitted ONLY on plan.emit / context.load (spec §5.2). Materialized by 06-02.",
    expectedVerdict: "FAIL",
    expectedErrorTags: ["prohibited-inference"],
    declaredEvents: ["tool.call"],
  },
  {
    id: "fail-gen-ai-system-present",
    category: "fail",
    traceRef: "fail/gen-ai-system-present.json",
    description:
      "Trace emits the deprecated `gen_ai.system` attribute (superseded by gen_ai.provider.name; Layer 1). Materialized by 06-02.",
    expectedVerdict: "FAIL",
    expectedErrorTags: ["gen-ai-system-present"],
    declaredEvents: ["context.load"],
  },
  {
    id: "fail-harness-under-gen-ai",
    category: "fail",
    traceRef: "fail/harness-under-gen-ai.json",
    description:
      "A harness.* attribute nested under the gen_ai.* namespace (Layer 1 anti-pattern). Materialized by 06-02.",
    expectedVerdict: "FAIL",
    expectedErrorTags: ["harness-under-gen-ai"],
    declaredEvents: ["tool.call"],
  },
  {
    id: "fail-fabricated-verify-result",
    category: "fail",
    traceRef: "fail/fabricated-verify-result.json",
    description:
      "A verify.result synthesized to 'fill in' an absent verification — fabricating an absence is prohibited (RESEARCH Anti-Pattern). Materialized by 06-02.",
    expectedVerdict: "FAIL",
    expectedErrorTags: ["fabricated-event"],
    declaredEvents: ["tool.call", "verify.result"],
  },

  // ── behavioral (abstract scenarios; verdict asserted by Layer 3 in 06-02) ─
  {
    id: "behavioral-absence-preserved",
    category: "behavioral",
    traceRef: "behavioral/absence-preserved.json",
    description:
      "Scenario: a mutating tool.call followed by NO verification step. The adapter under test MUST emit nothing for verify.result/feedback.check (it must not fabricate the absent step).",
    expectedVerdict: "NA",
    expectedErrorTags: [],
    declaredEvents: ["tool.call"],
  },
  {
    id: "behavioral-no-inferred-evolve",
    category: "behavioral",
    traceRef: "behavioral/no-inferred-evolve.json",
    description:
      "Scenario: the adapter MUST NOT emit evolve.propose / evolve.apply as inferred events (spec §5.2 prohibited).",
    expectedVerdict: "NA",
    expectedErrorTags: [],
    declaredEvents: ["evolve.propose", "evolve.apply"],
  },
] as const;

/** Convenience: the canonical HSC event-type set, re-exported for the RED test. */
export const HSC_EVENT_TYPE_SET: ReadonlySet<string> = new Set<string>(
  EVENT_TYPES as readonly string[],
);
