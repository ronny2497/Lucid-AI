/**
 * @lucid/evolution — public entrypoint.
 *
 * The import path every downstream Phase 3 surface uses: `@lucid/evolution`.
 *
 * Wave 0 (this plan, 03-01) exports the frozen contract only:
 *   - the `change_manifest` Zod schema family + inferred types (schema.ts)
 *   - the shared types incl. `Principle` and `CandidateChangeSet` (types.ts)
 *   - the `ProposalStore` persistence seam (proposal-store.ts)
 *
 * Later plans extend this barrel with the implementation entrypoints:
 *   - `findingToChangeSets()` (the mapper) + the rule-based estimator are added
 *     by Plan 03-02
 *   - `propose(finding, diagnostic)` + `updateManifestStatus()` are added by 03-02/03-03
 *   - the `evolve.propose` HSC emitter + a default `ProposalStore` impl are added by 03-03
 *
 * ZERO BLAST RADIUS (L0): this package depends only on `@lucid/diagnostic` types,
 * `@lucid/hsc-schema`, and `zod`. There is no harness-filesystem write path anywhere.
 */

// ---- change_manifest schema family (REQ-05) --------------------------------
export {
  ChangeSetKindSchema,
  ExpectedEffectSchema,
  EstimatorTagSchema,
  ManifestStatusSchema,
  ChangeManifestSchema,
} from "./schema.js";
export type {
  ChangeSetKind,
  ExpectedEffect,
  EstimatorTag,
  ManifestStatus,
  ChangeManifest,
} from "./schema.js";

// ---- shared types ----------------------------------------------------------
export type { Principle, CandidateChangeSet } from "./types.js";

// ---- persistence seam ------------------------------------------------------
export type { ProposalStore, ProposalFilter } from "./proposal-store.js";

// ---- mapper / estimator / propose (Plan 03-02) -----------------------------
// The finding→change-set mapper, the rule-based expected_effect estimator, and
// the propose() orchestrator that assembles a schema-valid, falsifiable,
// status-"proposed" ChangeManifest. Zero blast radius: no harness write path.
export { findingToChangeSets, MAPPED_DETECTOR_IDS, MAPPING_KINDS } from "./mapper/index.js";
export type { ChangeSetRule } from "./mapper/index.js";
export { expectedEffect, HEURISTIC_DELTAS } from "./estimator/index.js";
export { propose } from "./propose.js";
export type { ProposeOptions } from "./propose.js";

// ---- HITL surface: HSC audit emit + review transition + persistence (03-03) -
// The `evolve.propose` low-cardinality HSC audit event, the L0 status-only review
// transition (accept/reject; `"applied"` is unreachable — reserved for Phase 4),
// the default file-backed `ProposalStore`, and the testable `lucid evolve`
// command functions. Zero blast radius: no harness write path anywhere.
export {
  emitEvolvePropose,
  buildEvolveProposeRecord,
  EVOLVE_PROPOSE_EVENT,
} from "./hsc-emit.js";
export type { EvolveProposeRecord } from "./hsc-emit.js";
export { updateManifestStatus } from "./review.js";
export type { ReviewStatus } from "./review.js";
export { FileProposalStore, DEFAULT_PROPOSALS_PATH } from "./file-proposal-store.js";
export {
  proposeCommand,
  reviewCommand,
  listCommand,
  renderManifestYaml,
  ADVISORY_LINE,
} from "./cli.js";
export type { CliIO, ProposeArgs, ReviewArgs, ListArgs } from "./cli.js";

// ---- Phase 4 (L1 — Auto-Apply) Wave-0 contract (REQ-05) --------------------
// The machine-parseable v2 apply contract and its supporting seams, frozen BEFORE
// any apply code exists (04-02 applicator, 04-03 guard/rollback, 04-04 orchestrator
// all build against these shapes). The privileged write path itself (`apply()`)
// is added by 04-04; this barrel exports only the frozen contract here.
export {
  ChangeManifestV2Schema,
  ChangeManifestV2DetailSchema,
  TargetFilesSchema,
  AddGateDetailSchema,
  TrimContextDetailSchema,
  EditSkillDetailSchema,
  PromptPatchDetailSchema,
  DeleteLayerDetailSchema,
} from "./schema-v2.js";
export type {
  ChangeManifestV2,
  ChangeManifestV2Detail,
  AddGateDetail,
  TrimContextDetail,
  EditSkillDetail,
  PromptPatchDetail,
  DeleteLayerDetail,
} from "./schema-v2.js";

export { migrateV1toV2 } from "./migrate.js";
export type { RepropseV2DetailFn } from "./migrate.js";

export { AutonomyConfigSchema, GuardConfigSchema } from "./apply-config.js";
export type { AutonomyConfig, GuardConfig } from "./apply-config.js";

export {
  ApplyRecordSchema,
  GuardVerdictSchema,
  RollbackStatusSchema,
  FileApplyStore,
  DEFAULT_APPLY_RECORDS_PATH,
} from "./apply-store.js";
export type {
  ApplyRecord,
  ApplyStore,
  ApplyRecordFilter,
  GuardVerdict,
  RollbackStatus,
} from "./apply-store.js";

export { FileVersionRegistry } from "./version-registry.js";
export type {
  HarnessVersionRegistry,
  VersionSnapshot,
  SnapshotFile,
} from "./version-registry.js";

// ---- Phase 4 (L1 — Auto-Apply) implementation surface (REQ-05) -------------
// 04-02/04-03 deliberately did NOT touch this barrel; their public surface is
// gathered HERE alongside the 04-04 orchestrator + CLI. STRUCTURAL-ONLY: every
// export below operates on harness structural surfaces only — no weight / GRPO /
// TrainerPlugin path anywhere (ADR-0004 L1 boundary).

// The Change Applicator (04-02): atomic apply + the closed-taxonomy dispatcher.
export {
  applyManifest,
  resolveAdapter,
  addGateAdapter,
  trimContextAdapter,
  editSkillAdapter,
  promptPatchAdapter,
  deleteLayerAdapter,
} from "./applicator/index.js";
export type {
  ApplyResult,
  StructuralAdapter,
  ValidationResult,
} from "./applicator/index.js";

// The deterministic approval gate (04-02): the mandatory pass-through before any write.
export { checkApprovalPolicy } from "./gate.js";
export type { PolicyResult } from "./gate.js";

// The fixed-sample A/B regression guard (04-03): the falsifiability layer.
export { runRegressionGuard, extractScore } from "./guard.js";
export type {
  GuardVerdict as RegressionGuardVerdict,
  DiagnoseFn,
  TraceQuery as GuardTraceQuery,
  GuardTraceFilter,
  CohortTrace,
} from "./guard.js";

// The guaranteed-revert + guaranteed-audit rollback controller (04-03).
export { rollbackController } from "./rollback.js";
export type { RollbackControllerArgs } from "./rollback.js";

// The `evolve.apply` HSC audit emitter (04-03).
export {
  buildEvolveApplyRecord,
  emitEvolveApply,
  recomputeApplyContentHash,
  EVOLVE_APPLY_EVENT,
} from "./hsc-emit-apply.js";
export type {
  EvolveApplyRecord,
  EvolveApplyInput,
  EvolveApplyAttrs,
} from "./hsc-emit-apply.js";

// The closed L1 control loop (04-04): gate -> apply -> guard -> promote|rollback ->
// emit -> record, idempotent by manifest id.
export { apply } from "./apply.js";
export type { ApplyOutcome, ApplyDeps } from "./apply.js";

// The `lucid evolve apply/rollback/audit` testable command surface (04-04).
export { applyCommand, rollbackCommand, auditCommand } from "./cli-apply.js";
export type {
  ApplyCliDeps,
  ApplyCommandArgs,
  RollbackCommandArgs,
  AuditCommandArgs,
} from "./cli-apply.js";

// Convenience re-export of the real `diagnose` so the collector's argv path can wire
// the guard's `diagnoseFn` without taking a direct `@lucid/diagnostic` dependency
// (evolution already depends on it). The guard runs `diagnose` PER TRACE; it is a pure
// read-model and is the only collaborator the integration test mocks. Structural-only:
// `diagnose` never mutates a trace or any store.
export { diagnose } from "@lucid/diagnostic";
export type { DiagnosticResult } from "@lucid/diagnostic";

// ---- L2 weight-level GRPO (Phase 5) Wave-0 contract (REQ-05) ----------------
// The swappable `TrainerPlugin` boundary frozen BEFORE any trainer wiring exists:
// the TS→Python job-handoff spec, the prompts-only reward dataset (on-policy,
// reward-in-TS), the Python→TS result manifest, the language-agnostic interface,
// and the pure-TS `MockTrainerPlugin` CI path. 05-02 (exporter/reward), 05-03
// (gate), and 05-04 (orchestrator/CLI/sidecar) all build against these shapes.
// NO-PYTHON-CORE-DEP: nothing under src/l2/ imports Python or spawns a subprocess.
export {
  TrainerPluginSpecSchema,
  GrpoConfigSchema,
  PeftConfigSchema,
  AbsolutePathSchema,
} from "./l2/schemas/trainer-plugin-spec.js";
export type {
  TrainerPluginSpec,
  GrpoConfig,
  PeftConfig,
} from "./l2/schemas/trainer-plugin-spec.js";

export { ResultManifestSchema, MetricsSchema } from "./l2/schemas/result-manifest.js";
export type { ResultManifest, Metrics } from "./l2/schemas/result-manifest.js";

export {
  RewardDatasetSchema,
  RewardEntrySchema,
  RewardCompositionSchema,
  PROMPT_HASH_PREFIX,
} from "./l2/schemas/reward-dataset.js";
export type {
  RewardDataset,
  RewardEntry,
  RewardComposition,
} from "./l2/schemas/reward-dataset.js";

export type { TrainerPlugin } from "./l2/trainer-plugin.js";
export { MockTrainerPlugin } from "./l2/mock-trainer-plugin.js";

// ---- L2 training-signal pipeline (Plan 05-02, REQ-05) ----------------------
// The two pure-TS halves of the GRPO training signal:
//   - the trajectory exporter (stored traces → prompts-only PromptRecord[], read
//     through the abstract TraceQuery seam, ON-POLICY — never a stored completion);
//   - the reward computer (Phase 2 DiagnosticResult → coverage-aware scalar reward,
//     null/zero-coverage EXCLUDED, all-null DROPPED, zero-variance advisory) that
//     assembles a schema-valid `reward_source "diagnostic"` RewardDataset.
// NO-PYTHON-CORE-DEP: pure-TS over `node:crypto` + Phase 2 types; reward-in-TS (ADR-0004).
// (PROMPT_HASH_PREFIX is already exported above from ./l2/schemas/reward-dataset.js —
//  the exporter re-uses that same literal; not re-exported here to avoid a name clash.)
export { exportTrajectories, serializeToJsonl } from "./l2/trajectory-exporter.js";
export type { PromptRecord, ExportOptions } from "./l2/trajectory-exporter.js";

export { computeRewards, buildRewardDataset, canonicalPromptHash, LOW_VARIANCE_EPS } from "./l2/reward-computer.js";
export type { RewardWeights, RewardCoverageStats } from "./l2/reward-computer.js";

// ---- L2 promotion gate (Plan 05-03, re-exported here per the 05-04 deferral) ----
// 05-03 deliberately did NOT touch this barrel (so 05-02/05-03 stayed file-disjoint
// and ran in parallel in Wave 2); their public surface is gathered HERE alongside
// the 05-04 orchestrator/CLI so `@lucid/collector` can import them from the package
// root. OPAQUE-ARTIFACT / NO-PYTHON-CORE-DEP: the gate treats artifact_path as an
// opaque string, loads no weights, and spawns no subprocess (ADR-0004).
export { SuccessEvaluator, loadHoldout, noopScorer } from "./l2/evaluator.js";
export type { Evaluator, HoldoutEntry, EntryScorer } from "./l2/evaluator.js";

export {
  evaluateCandidate,
  promoteCandidate,
  discardCandidate,
  PromoteGateConfigSchema,
  EVOLVE_PROMOTE_EVENT,
} from "./l2/promotion-gate.js";
export type {
  GateResult,
  EmitSink,
  EmittedEvolvePromote,
  PromoteGateConfig,
} from "./l2/promotion-gate.js";

export { buildCandidateProvenance } from "./l2/candidate-provenance.js";
export type { CandidateProvenance, ProvenanceGate } from "./l2/candidate-provenance.js";

// ---- L2 closed loop: config + trainer + orchestrator (Plan 05-04, REQ-05) -------
// The L2 config surface (trainer-null-unless-L2 boundary, ADR-0004), the ONLY lazy
// subprocess spawn (FilesystemTrainerPlugin — reached only at autonomy:L2), and the
// closed `runL2` loop (export→reward→handoff→gate→promote|discard→emit). With the
// MockTrainerPlugin the whole loop runs on a CPU CI box with NO Python.
export { L2ConfigSchema, RewardConfigSchema, TrainerRefSchema } from "./l2/l2-config.js";
export type { L2Config, RewardConfig, TrainerRef } from "./l2/l2-config.js";

export { FilesystemTrainerPlugin } from "./l2/filesystem-trainer-plugin.js";
export type { FilesystemTrainerPluginOptions } from "./l2/filesystem-trainer-plugin.js";

export { runL2, EVOLVE_TRAIN_EVENT } from "./l2/l2-orchestrator.js";
export type {
  L2Deps,
  L2RunResult,
  L2RunOptions,
  EmittedEvolveTrain,
  TrainEmitSink,
} from "./l2/l2-orchestrator.js";
