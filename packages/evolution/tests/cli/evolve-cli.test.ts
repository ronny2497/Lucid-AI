/**
 * `lucid evolve` command surface — propose / review / list (plan 03-03, Task 2).
 *
 * Uses a fake CliIO, an in-memory ProposalStore, and a capturing HSC sink, so the
 * command bodies test without a process, an argv parser, or a real store.
 *
 * Asserts:
 *   - propose renders the manifest WITH the advisory line, emits the evolve.propose
 *     event, and persists;
 *   - W4 (not-found path): propose with an unknown --finding id prints to io.err,
 *     returns 1, and emits/persists NOTHING — mirroring review's unknown-id path;
 *   - review --accept sets status "accepted", persists, writes no harness file;
 *   - review on an unknown id returns 1;
 *   - list filters by status;
 *   - the L0 boundary: no command path produces a status of "applied".
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  proposeCommand,
  reviewCommand,
  listCommand,
  ADVISORY_LINE,
  type CliIO,
  type EvolveProposeRecord,
} from "../../src/index.js";
import type { ChangeManifest } from "../../src/index.js";
import type { ProposalStore, ProposalFilter } from "../../src/proposal-store.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures");

/** Write the golden DiagnosticResult fixture to a temp file for the --from path. */
function tempDiagnosticPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "lucid-evolve-cli-"));
  const src = readFileSync(join(fixtures, "golden-diagnostic-empty-feedback.json"), "utf8");
  const path = join(dir, "diagnostic.json");
  writeFileSync(path, src, "utf8");
  return path;
}

/** A minimal in-memory ProposalStore (NO filesystem, NO harness write path). */
class MemoryProposalStore implements ProposalStore {
  readonly proposals = new Map<string, ChangeManifest>();
  async saveProposal(manifest: ChangeManifest): Promise<void> {
    this.proposals.set(manifest.id, manifest);
  }
  async listProposals(filter: ProposalFilter = {}): Promise<ChangeManifest[]> {
    return [...this.proposals.values()].filter((m) => {
      if (filter.status !== undefined && m.status !== filter.status) return false;
      if (filter.agentId !== undefined && m.target.split("@")[0] !== filter.agentId) return false;
      return true;
    });
  }
  async getProposal(id: string): Promise<ChangeManifest | null> {
    return this.proposals.get(id) ?? null;
  }
}

function makeIO(): { io: CliIO; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

describe("lucid evolve propose", () => {
  let store: MemoryProposalStore;
  let emitted: EvolveProposeRecord[];
  let diagnosticPath: string;

  beforeEach(() => {
    store = new MemoryProposalStore();
    emitted = [];
    diagnosticPath = tempDiagnosticPath();
  });

  it("renders the manifest WITH the advisory line, emits the event, and persists", async () => {
    const { io, out } = makeIO();
    const code = await proposeCommand(io, store, (r) => emitted.push(r), {
      finding: "F1",
      from: diagnosticPath,
    });

    expect(code).toBe(0);
    const render = out.join("\n");
    expect(render).toContain("change: add-gate");
    expect(render).toContain(ADVISORY_LINE);
    // Emitted exactly one evolve.propose audit event.
    expect(emitted).toHaveLength(1);
    expect(emitted[0].event.name).toBe("evolve.propose");
    // Persisted exactly one proposal, status "proposed" (NOT applied — L0).
    expect(store.proposals.size).toBe(1);
    const saved = [...store.proposals.values()][0];
    expect(saved.status).toBe("proposed");
    expect(saved.status).not.toBe("applied");
  });

  it("W4: unknown --finding id prints to io.err, returns 1, emits/persists nothing", async () => {
    const { io, out, err } = makeIO();
    const code = await proposeCommand(io, store, (r) => emitted.push(r), {
      finding: "F999",
      from: diagnosticPath,
    });

    expect(code).toBe(1);
    expect(err.join("\n")).toContain("finding not found: F999");
    expect(out).toHaveLength(0);
    expect(emitted).toHaveLength(0);
    expect(store.proposals.size).toBe(0);
  });
});

describe("lucid evolve review", () => {
  let store: MemoryProposalStore;
  let diagnosticPath: string;

  async function seedProposal(): Promise<string> {
    const emitted: EvolveProposeRecord[] = [];
    const { io } = makeIO();
    await proposeCommand(io, store, (r) => emitted.push(r), {
      finding: "F1",
      from: diagnosticPath,
    });
    return [...store.proposals.keys()][0];
  }

  beforeEach(() => {
    store = new MemoryProposalStore();
    diagnosticPath = tempDiagnosticPath();
  });

  it("--accept sets status 'accepted', persists, and writes no harness file", async () => {
    const id = await seedProposal();
    const { io, out } = makeIO();
    const code = await reviewCommand(io, store, id, { accept: true, note: "looks good" });

    expect(code).toBe(0);
    const saved = await store.getProposal(id);
    expect(saved?.status).toBe("accepted");
    expect(saved?.review_note).toBe("looks good");
    // L0: never "applied".
    expect(saved?.status).not.toBe("applied");
    expect(out.join("\n")).toContain(ADVISORY_LINE);
  });

  it("--reject sets status 'rejected'", async () => {
    const id = await seedProposal();
    const { io } = makeIO();
    const code = await reviewCommand(io, store, id, { reject: true });
    expect(code).toBe(0);
    expect((await store.getProposal(id))?.status).toBe("rejected");
  });

  it("returns 1 on an unknown manifest id", async () => {
    const { io, err } = makeIO();
    const code = await reviewCommand(io, store, "cm-does-not-exist", { accept: true });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("proposal not found: cm-does-not-exist");
  });

  it("returns 1 when neither --accept nor --reject is given", async () => {
    const id = await seedProposal();
    const { io, err } = makeIO();
    const code = await reviewCommand(io, store, id, {});
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("--accept or --reject");
  });
});

describe("lucid evolve list", () => {
  let store: MemoryProposalStore;
  let diagnosticPath: string;

  beforeEach(async () => {
    store = new MemoryProposalStore();
    diagnosticPath = tempDiagnosticPath();
  });

  it("filters by status and prints '(no proposals)' when empty", async () => {
    // Empty store first.
    const empty = makeIO();
    expect(await listCommand(empty.io, store, { status: "proposed" })).toBe(0);
    expect(empty.out.join("\n")).toContain("(no proposals)");

    // Seed one proposed proposal.
    const emitted: EvolveProposeRecord[] = [];
    const seedIO = makeIO();
    await proposeCommand(seedIO.io, store, (r) => emitted.push(r), {
      finding: "F1",
      from: diagnosticPath,
    });

    // list --status proposed → 1 row; list --status accepted → none.
    const proposedList = makeIO();
    await listCommand(proposedList.io, store, { status: "proposed" });
    expect(proposedList.out.join("\n")).toContain("change=add-gate");
    expect(proposedList.out.join("\n")).toContain("status=proposed");

    const acceptedList = makeIO();
    await listCommand(acceptedList.io, store, { status: "accepted" });
    expect(acceptedList.out.join("\n")).toContain("(no proposals)");
  });
});
