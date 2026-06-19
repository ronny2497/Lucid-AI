/**
 * @lucid/evolution — `FileProposalStore`: the default `ProposalStore` implementation.
 *
 * Phase 1's trace store exposes only `queryTraces`/`getTrace`, NOT an `event.name`-
 * filtered log query (B5, RESEARCH Pitfall 3) — so `lucid evolve list --status
 * proposed` has no efficient query path against the trace store as-is. Phase 3
 * therefore ships this file-backed implementation of the 03-01 `ProposalStore` seam:
 * a local JSON file that is the queryable proposal index, COMPLEMENTARY to the
 * append-only `evolve.propose` HSC audit event (the two are not redundant — the
 * event is the audit record, this file is the listable index). Phase 1 may later
 * satisfy `ProposalStore` natively; nothing here couples to a concrete store.
 *
 * STORAGE FORMAT: a single JSON file holding `{ "proposals": ChangeManifest[] }`.
 * `saveProposal` UPSERTS by `id` (idempotent on the deterministic `cm-{id}`), so
 * re-proposing the same finding and then accepting it updates one record in place.
 *
 * ZERO BLAST RADIUS (L0): the ONLY filesystem write is to the proposal JSON file
 * (an audit/index artifact). There is NO write path to any harness config, prompt,
 * skill, or context file — that write path is Phase 4. (threat T-03-03 / T-03-10)
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { ChangeManifestSchema, type ChangeManifest } from "./schema.js";
import type { ProposalStore, ProposalFilter } from "./proposal-store.js";

/** The default proposal-index path, alongside the trace store (never a harness path). */
export const DEFAULT_PROPOSALS_PATH = "lucid-proposals.json";

/** The on-disk file shape — a versioned envelope around the proposal list. */
interface ProposalsFile {
  proposals: ChangeManifest[];
}

/**
 * A file-backed `ProposalStore`. Construct with an explicit path or rely on the
 * `DEFAULT_PROPOSALS_PATH` default. The file is created lazily on first save.
 */
export class FileProposalStore implements ProposalStore {
  private readonly path: string;

  constructor(path: string = DEFAULT_PROPOSALS_PATH) {
    this.path = path;
  }

  /** Read + parse the proposal file, returning all stored (schema-valid) manifests. */
  private readAll(): ChangeManifest[] {
    if (!existsSync(this.path)) return [];
    const raw = readFileSync(this.path, "utf8").trim();
    if (raw === "") return [];
    const parsed = JSON.parse(raw) as ProposalsFile;
    const list = Array.isArray(parsed?.proposals) ? parsed.proposals : [];
    // Re-validate each record so a corrupted index can never yield invalid manifests.
    return list.map((m) => ChangeManifestSchema.parse(m));
  }

  /** Serialise + write the proposal list back to disk (pretty-printed for review). */
  private writeAll(proposals: ChangeManifest[]): void {
    const file: ProposalsFile = { proposals };
    writeFileSync(this.path, JSON.stringify(file, null, 2) + "\n", "utf8");
  }

  /**
   * Persist a proposal. UPSERTS by `manifest.id` — re-saving an existing id (e.g.
   * after `updateManifestStatus`) replaces that record in place rather than
   * appending a duplicate. The manifest is validated before it is stored.
   */
  async saveProposal(manifest: ChangeManifest): Promise<void> {
    const validated = ChangeManifestSchema.parse(manifest);
    const proposals = this.readAll();
    const idx = proposals.findIndex((p) => p.id === validated.id);
    if (idx >= 0) {
      proposals[idx] = validated;
    } else {
      proposals.push(validated);
    }
    this.writeAll(proposals);
  }

  /**
   * List proposals matching the filter. `agentId` matches the manifest `target`'s
   * agent component (`"agent-id@harness-version"`); `status` matches the lifecycle
   * status. Filters are AND-combined; an empty filter returns all proposals.
   */
  async listProposals(filter: ProposalFilter = {}): Promise<ChangeManifest[]> {
    return this.readAll().filter((m) => {
      if (filter.status !== undefined && m.status !== filter.status) return false;
      if (filter.agentId !== undefined) {
        const agentOfTarget = m.target.split("@")[0];
        if (agentOfTarget !== filter.agentId) return false;
      }
      return true;
    });
  }

  /** Fetch a single proposal by `cm-{id}`, or `null` if absent. */
  async getProposal(id: string): Promise<ChangeManifest | null> {
    return this.readAll().find((m) => m.id === id) ?? null;
  }
}
