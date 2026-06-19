/**
 * @lucid/evolution — the `ProposalStore` persistence seam.
 *
 * This is the `evolve.propose` persistence interface that DECOUPLES Phase 3 from
 * any concrete Phase 1 store. It is the same decoupling discipline Phase 2 used
 * with its abstract `TraceQuery` interface (no concrete store import) — and it is
 * deliberately SEPARATE from `TraceStore`: a proposal is a distinct artifact from
 * a trace.
 *
 * Why a dedicated seam (B5): Phase 1's store today exposes only `queryTraces` /
 * `getTrace`, NOT an `event.name`-filtered log query (RESEARCH Pitfall 3). So
 * `lucid evolve list --status proposed` has no efficient query path against the
 * trace store as-is. Plan 03-03 therefore ships a default file/in-memory
 * `ProposalStore` implementation against THIS interface; Phase 1 may later satisfy
 * it natively. Nothing in Phase 3 imports a concrete store here — only the type.
 *
 * ZERO BLAST RADIUS (L0): this is a pure TypeScript interface. It declares no
 * harness-filesystem write path. The only write a Phase 3 implementation performs
 * is to the proposal store (an audit-trail artifact), never to a harness
 * config/skill/prompt file — that write path is Phase 4. (threat T-03-03)
 */

import type { ChangeManifest, ManifestStatus } from "./schema.js";

/** Filter for {@link ProposalStore.listProposals}. All fields are optional (AND-combined). */
export interface ProposalFilter {
  /** Restrict to proposals whose `target` agent matches this agent id. */
  agentId?: string;
  /** Restrict to proposals in this lifecycle status. */
  status?: ManifestStatus;
}

/**
 * The persistence seam for `change_manifest` proposals (the `evolve.propose` artifact).
 *
 * Implementations MUST persist the manifest verbatim (it is the audit-trail body)
 * and MUST NOT mutate any harness file — at L0 the only side effect is storing the
 * proposal record. A concrete file/in-memory implementation ships in 03-03.
 */
export interface ProposalStore {
  /** Persist a proposal. Idempotent on `manifest.id` is an implementation choice. */
  saveProposal(manifest: ChangeManifest): Promise<void>;

  /** List proposals matching the filter (e.g. all `proposed` for one agent). */
  listProposals(filter: ProposalFilter): Promise<ChangeManifest[]>;

  /** Fetch a single proposal by its `cm-{id}`, or `null` if absent. */
  getProposal(id: string): Promise<ChangeManifest | null>;
}
