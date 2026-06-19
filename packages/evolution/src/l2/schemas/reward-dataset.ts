/**
 * `RewardDataset` — the TS→Python reward file (REQ-05, Phase 5 L2).
 *
 * This is the data half of the job handoff: the prompts the sidecar will generate
 * fresh completions for, plus the per-prompt scalar baseline reward TS computed
 * from the Phase 2 `DiagnosticResult`. Two HARD boundaries are enforced here:
 *
 *   1. ON-POLICY, PROMPTS ONLY (threat T-05-01, RESEARCH Pitfall 1): every
 *      `RewardEntry` is `.strict()`, which REJECTS any stray key — in particular a
 *      `completion`/`response`/`output_text` field. Stored production completion
 *      text is NEVER fed to the trainer as a GRPO completion; completions are
 *      generated fresh by the sidecar at train time. Feeding stored completions
 *      would be off-policy and would poison the gradient.
 *
 *   2. REWARD-IN-TS (threat T-05-04, ADR-0004): `reward_source` is the literal
 *      `"diagnostic"`. The schema carries NO field instructing Python to compute
 *      or re-derive quality — Python receives scalars only and does gradient math.
 *
 * The `reward_composition` and `principle_breakdown` keys are DERIVED from the
 * canonical `PRINCIPLES` tuple (`@lucid/hsc-schema`), not hardcoded, so a Phase 0
 * principle rename propagates automatically and the keys can never drift from the
 * five `DiagnosticResult.principles[].principle` names.
 *
 * --- prompt_hash construction (W3 — cross-language contract) ---
 * Each entry is keyed by `prompt_hash`, constructed identically in TS (05-02) and
 * Python (05-04) so the two languages agree on which reward belongs to which
 * prompt:
 *
 *     prompt_hash = "sha256:" + hex( sha256( utf8_bytes(prompt) ) )
 *
 * Precisely:
 *   - the digest is SHA-256 of the prompt string encoded as UTF-8 (no BOM, no
 *     trailing newline added — the exact `prompt` string bytes, unmodified),
 *   - rendered as lowercase hex,
 *   - prefixed with the literal ASCII string `"sha256:"`.
 * In TS: `"sha256:" + createHash("sha256").update(prompt, "utf8").digest("hex")`.
 * In Python: `"sha256:" + hashlib.sha256(prompt.encode("utf-8")).hexdigest()`.
 * 05-02/05-04 will add a shared prompt→expected-hash fixture pinning this.
 *
 * NO-PYTHON-CORE-DEP: this module imports only `zod` and `@lucid/hsc-schema`.
 */

import { z } from "zod";
import { PRINCIPLES } from "@lucid/hsc-schema";

/** The literal prefix every `prompt_hash` carries (W3 cross-language contract). */
export const PROMPT_HASH_PREFIX = "sha256:" as const;

/**
 * Per-principle reward breakdown / composition shape, built from the `PRINCIPLES`
 * tuple so the keys are exactly the canonical five principle names. `.strict()`
 * (applied at the object site below) REJECTS any non-principle key.
 */
const principleShape = Object.fromEntries(
  PRINCIPLES.map((principle) => [principle, z.number().optional()]),
) as Record<(typeof PRINCIPLES)[number], z.ZodOptional<z.ZodNumber>>;

/**
 * The reward composition: a principle→weight map describing how the scalar
 * baseline reward was composed from the per-principle diagnostic scores. `.strict()`
 * rejects a non-principle weight key.
 */
export const RewardCompositionSchema = z.object({ ...principleShape }).strict();
export type RewardComposition = z.infer<typeof RewardCompositionSchema>;

/**
 * A single training prompt with its TS-computed scalar reward. `.strict()` is the
 * on-policy guard: a stray `completion`/`response`/`output_text` key is REJECTED
 * because stored completions must never reach the trainer (T-05-01).
 */
export const RewardEntrySchema = z
  .object({
    /** "sha256:" + hex(sha256(utf8(prompt))) — see module header (W3). */
    prompt_hash: z.string().min(1),
    prompt: z.string().min(1),
    baseline_reward: z.number(),
    principle_breakdown: z.object({ ...principleShape }).strict(),
  })
  .strict();
export type RewardEntry = z.infer<typeof RewardEntrySchema>;

/**
 * The reward file written by TS and read by the trainer plugin. `reward_source`
 * is pinned to `"diagnostic"` (reward-in-TS); `entries[]` are prompts only.
 */
export const RewardDatasetSchema = z.object({
  version: z.string().min(1),
  job_id: z.string().min(1),
  reward_source: z.literal("diagnostic"),
  reward_composition: RewardCompositionSchema,
  entries: z.array(RewardEntrySchema),
});

export type RewardDataset = z.infer<typeof RewardDatasetSchema>;
