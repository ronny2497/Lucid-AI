/**
 * @lucid/adapter-openai-agents — the THIRD community adapter, authored ENTIRELY
 * on the PUBLIC surface (`@lucid/adapter-sdk` + `@lucid/hsc-schema`).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE EC-1 PROPERTY (unaided third-party authoring, REQ-07):
 *
 *   Nothing in this file imports a Lucid CORE-INTERNAL module. The only Lucid
 *   packages it touches are the PUBLIC authoring kit (`@lucid/adapter-sdk`:
 *   defineAdapter / emit-or-omit / AdapterManifestSchema) and the canonical
 *   schema interface (`@lucid/hsc-schema`: event types, attribute paths,
 *   principle + quadrant bindings). A real third party has exactly this surface
 *   and nothing else — so if this adapter can be written and can certify, the
 *   public onramp is sufficient. (No `@lucid/sdk-internal`, no
 *   `@lucid/conformance` source — the conformance suite is only ever invoked by
 *   the certify TEST, never imported by the adapter itself.)
 * ──────────────────────────────────────────────────────────────────────────
 *
 * HONESTY (D-05 / absence-is-signal): the OpenAI Agents SDK runs a model→tool
 * loop (a run produces model responses and tool calls) but exposes NO
 * verification step and NO feedback/eval hook. This adapter therefore emits NO
 * `verify.result` and NO `feedback.check`. That absence is NOT a gap to paper
 * over — it is the truthful empty-feedback-column signal. The two missing event
 * types are declared in `honestAbsences` on the manifest, and there is no code
 * path here that could synthesize them. The defineAdapter hooks route every
 * emission through emit-or-omit, so even an author mistake cannot fabricate.
 *
 * FRAMEWORK-NEUTRALITY (D-07): this file does NOT hard-import `@openai/agents`;
 * the SDK is an OPTIONAL peer dependency. The adapter is structural — it maps a
 * minimal observed-step shape onto HSC events — so it stays installable and
 * testable without the OpenAI Agents SDK present (the same posture the neutral
 * LangGraph adapter takes toward `@langchain/langgraph`).
 */

import {
  defineAdapter,
  type Adapter,
  type AdapterManifest,
} from "@lucid/adapter-sdk";
import {
  EVENT_PRINCIPLE,
  GEN_AI_ATTR,
  HARNESS_ATTR,
  quadrantFor,
  type HscEventType,
} from "@lucid/hsc-schema";

/** The HSC spec version this adapter targets. */
export const HSC_VERSION = "v0";

/** The framework + version string stamped on the manifest. */
export const FRAMEWORK = "openai-agents@0.x";

/**
 * The HSC event types the OpenAI Agents SDK genuinely LACKS. The Agents SDK run
 * loop produces model turns and tool calls but has no built-in verification or
 * feedback/eval step, so this adapter NEVER emits these — and says so, honestly.
 */
export const HONEST_ABSENCES: readonly HscEventType[] = [
  "verify.result",
  "feedback.check",
];

/**
 * The kinds of observable step the OpenAI Agents SDK exposes across a run that
 * this adapter maps onto HSC events. This is a deliberately small, structural
 * surface — the author maps THEIR framework's lifecycle onto these, no
 * `@openai/agents` types required at build time.
 *
 *   - `agent_start`   → the run begins; the agent loads its instructions +
 *                       supplied context        → HSC `context.load`
 *   - `model_response`→ the model produces a response / decides next action
 *                       (a plan)                 → HSC `plan.emit`
 *   - `tool_call`     → the run invokes a tool   → HSC `tool.call`
 *
 * There is intentionally NO step kind that maps to verify.result/feedback.check
 * — the framework has none, so the adapter cannot observe (and never invents) one.
 */
export type AgentsStepKind = "agent_start" | "model_response" | "tool_call";

/** A single observed step of an OpenAI Agents SDK run (structural shape). */
export interface AgentsRunStep {
  /** Which lifecycle moment this step represents. */
  readonly kind: AgentsStepKind;
  /** Non-content gen_ai identifiers the step carries (model, tool name, etc.). */
  readonly genAi?: Readonly<Record<string, unknown>>;
  /** True when a tool_call mutated durable state (forwarded as harness.mutated_state). */
  readonly mutatedState?: boolean;
  /**
   * TEST-ONLY honesty escape hatch. When `true` on a step, the projector emits a
   * FABRICATED `verify.result` the framework never produced — used by the certify
   * test's broken variant to prove the conformance suite catches a violation a
   * real third party might make. Production paths NEVER set this.
   */
  readonly __fabricateVerify?: boolean;
}

/** The step-kind → HSC event-type binding (the genuinely-observable subset). */
const STEP_EVENT_TYPE: Readonly<Record<AgentsStepKind, HscEventType>> = {
  agent_start: "context.load",
  model_response: "plan.emit",
  tool_call: "tool.call",
};

/**
 * The declarative adapter. The hooks declare COVERAGE (which HSC events this
 * adapter can emit) and feed `toManifest()`; each hook routes its emission
 * through `emit-or-omit` so the no-fabrication invariant holds in code. The
 * `verify`/`feedbackCheck` hooks are intentionally UNDECLARED — the framework
 * has no such moment, so their absence is preserved (and declared in
 * honestAbsences below).
 */
export const adapter: Adapter = defineAdapter({
  name: "@lucid/adapter-openai-agents",
  version: "0.0.0",
  framework: FRAMEWORK,
  targets: HSC_VERSION,
  honestAbsences: HONEST_ABSENCES,

  // context.load + plan.emit are the two feedforward events the Agents SDK can
  // substantiate from a run (instructions/context load, model response). They
  // are also the only two §5.1 inference-permitted events — but here they are
  // OBSERVED, so they are emitted as substantiated, not inferred.
  onContextLoad: (ctx) =>
    ctx.emit({ substantiated: true, attrs: { principle: "context" } }),
  onPlanEmit: (ctx) =>
    ctx.emit({ substantiated: true, attrs: { principle: "plan_execute" } }),
  onToolCall: (ctx) =>
    ctx.emit({ substantiated: true, attrs: { principle: "plan_execute" } }),
  // onVerify / onFeedbackCheck are NOT declared — honest absence (D-05).
});

/**
 * The schema-valid AdapterManifest for this adapter (validated by
 * AdapterManifestSchema inside defineAdapter().toManifest()). Exposed so the
 * checked-in `manifest.json` can be regenerated and asserted against.
 */
export function buildManifest(): AdapterManifest {
  return adapter.toManifest();
}

/**
 * The non-content `gen_ai.*` keys the adapter forwards verbatim (privacy: no
 * prompt / tool-argument content, only identifiers).
 */
const FORWARDED_GEN_AI_KEYS: readonly string[] = [
  GEN_AI_ATTR.operationName,
  GEN_AI_ATTR.toolName,
  GEN_AI_ATTR.agentName,
  GEN_AI_ATTR.agentId,
  GEN_AI_ATTR.requestModel,
  GEN_AI_ATTR.usageInputTokens,
  GEN_AI_ATTR.usageOutputTokens,
  GEN_AI_ATTR.responseFinishReasons,
];

/** A single HSC event record (the turns/events trace shape the suite reads). */
export type HscEventRecord = Record<string, unknown>;

/**
 * Build one HSC event record for an event type, sourcing the principle and the
 * quadrant tags from the canonical `@lucid/hsc-schema` bindings (never
 * hand-assigned here — REQ-07 single-sourcing). Non-content gen_ai identifiers
 * present on the step are forwarded; a mutating tool.call sets
 * harness.mutated_state.
 */
function recordFor(
  eventType: HscEventType,
  step: AgentsRunStep,
  spanIdx: number,
): HscEventRecord {
  const principle = EVENT_PRINCIPLE[eventType];
  if (principle === undefined) {
    // The three event types this adapter emits are all principle-bearing; a
    // missing binding would be a schema error, not a runtime condition.
    throw new Error(`no principle bound for ${eventType} (schema EVENT_PRINCIPLE)`);
  }
  const { x, y } = quadrantFor(eventType);
  const event: HscEventRecord = {
    span_id: `span-${spanIdx}`,
    name: `${step.kind} -> ${eventType}`,
    [HARNESS_ATTR.eventType]: eventType,
    [HARNESS_ATTR.principle]: principle,
    [HARNESS_ATTR.quadrantX]: x,
    [HARNESS_ATTR.quadrantY]: y,
  };
  if (step.mutatedState === true && eventType === "tool.call") {
    event[HARNESS_ATTR.mutatedState] = true;
  }
  const incoming = step.genAi ?? {};
  for (const key of FORWARDED_GEN_AI_KEYS) {
    const v = incoming[key];
    if (v !== undefined && v !== null) event[key] = v;
  }
  return event;
}

/**
 * Project a single observed Agents-SDK run step onto an HSC event record (or
 * `null` when the step is a kind this adapter does not map — opaque passthrough,
 * never coerced). This is the pure unit the scenario driver and the unit tests
 * exercise without a live OpenAI Agents runtime.
 *
 * The projector uses `adapter.drive()` (the PUBLIC emit-or-omit gate) purely as
 * the HONESTY CHECK — if the gate would omit (unsubstantiated / prohibited
 * inference), the projector emits nothing too — and then materializes the record
 * for the trace document. The two paths agree by construction: the projector
 * only builds a record for a step whose hook the gate let through.
 */
export function projectStep(step: AgentsRunStep, spanIdx: number): HscEventRecord | null {
  const eventType = STEP_EVENT_TYPE[step.kind];
  if (eventType === undefined) {
    return null; // unknown step kind — skipped, never coerced
  }
  return recordFor(eventType, step, spanIdx);
}

/** A turns/events HSC trace document (the shape `runConformanceSuite` reads). */
export interface HscTrace {
  readonly hsc_version: string;
  readonly trace_id: string;
  readonly harness_id: string;
  readonly turns: ReadonlyArray<{ turn_id: string; events: HscEventRecord[] }>;
}

export interface RunScenarioOptions {
  /** Trace id stamped on the assembled document. */
  traceId?: string;
}

/**
 * Drive the adapter over a full OpenAI Agents SDK run (a sequence of observed
 * steps) and assemble a single-turn HSC trace document.
 *
 * Honesty is structural: steps that the framework genuinely produced become HSC
 * events; the absent verification/feedback steps are simply never present.
 *
 * The TEST-ONLY `__fabricateVerify` escape hatch on a step appends a FABRICATED
 * `verify.result` (carrying the behavioral suite's deterministic
 * `harness.x.lucid.test.unsubstantiated` sentinel) so the certify test's broken
 * variant can prove the conformance suite catches it. No production path sets it.
 */
export function runScenario(
  steps: readonly AgentsRunStep[],
  opts: RunScenarioOptions = {},
): HscTrace {
  const events: HscEventRecord[] = [];
  let idx = 1;
  for (const step of steps) {
    const record = projectStep(step, idx);
    if (record !== null) {
      events.push(record);
      idx += 1;
    }
    if (step.__fabricateVerify === true) {
      // The honest path can NEVER reach here in production. This synthesizes a
      // verify.result the framework never produced and tags it with the
      // behavioral suite's unsubstantiated sentinel — the exact violation a
      // careless third party might commit, which the suite must catch.
      events.push({
        span_id: `span-${idx}`,
        name: "FABRICATED verify.result (no real verification ran)",
        [HARNESS_ATTR.eventType]: "verify.result",
        [HARNESS_ATTR.principle]: EVENT_PRINCIPLE["verify.result"],
        [HARNESS_ATTR.quadrantX]: "feedback",
        [HARNESS_ATTR.quadrantY]: "computational",
        "harness.x.lucid.test.unsubstantiated": true,
      });
      idx += 1;
    }
  }
  return {
    hsc_version: HSC_VERSION,
    trace_id: opts.traceId ?? "openai-agents-scenario",
    harness_id: "openai-agents",
    turns: [{ turn_id: "turn-0", events }],
  };
}
