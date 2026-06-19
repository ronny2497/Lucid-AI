/**
 * Plan 04-02 Task 1 — the other four StructuralAdapters (trim-context, edit-skill,
 * prompt-patch, delete-layer). Each is applied against a fresh temp copy of
 * harness-v37; the test asserts the expected structural surface changed, the
 * returned file list is correct, and none writes outside harnessRoot (T-04-06).
 */

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { trimContextAdapter } from "../../src/applicator/trim-context.js";
import { editSkillAdapter } from "../../src/applicator/edit-skill.js";
import { promptPatchAdapter } from "../../src/applicator/prompt-patch.js";
import { deleteLayerAdapter } from "../../src/applicator/delete-layer.js";
import type {
  DeleteLayerDetail,
  EditSkillDetail,
  PromptPatchDetail,
  TrimContextDetail,
} from "../../src/schema-v2.js";

const here = dirname(fileURLToPath(import.meta.url));
const harnessFixture = join(here, "..", "fixtures", "harness-v37");

const BUDGET = "context-policy/budget.yaml";
const SKILL = "skills/search.ts";
const PROMPT = "prompts/system.txt";

describe("per-kind StructuralAdapters", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lucid-perkind-"));
    cpSync(harnessFixture, root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("trim-context removes the named source from the budget file", () => {
    const detail: TrimContextDetail = {
      kind: "trim-context",
      removeSource: "stale-design-notes",
      targetFiles: [BUDGET],
    };
    expect(trimContextAdapter.validate(detail, root)).toEqual({ ok: true });
    const written = trimContextAdapter.apply(detail, root);
    expect(written).toEqual([BUDGET]);

    const content = readFileSync(join(root, BUDGET), "utf8");
    expect(content).not.toContain("stale-design-notes");
    // The other sources survive.
    expect(content).toContain("codebase-docs");
    expect(content).toContain("recent-conversation");
  });

  it("edit-skill annotates the named skill file", () => {
    const detail: EditSkillDetail = {
      kind: "edit-skill",
      skillId: "search",
      instruction: "clamp limit to <= 50",
      targetFiles: [SKILL],
    };
    expect(editSkillAdapter.validate(detail, root)).toEqual({ ok: true });
    const written = editSkillAdapter.apply(detail, root);
    expect(written).toEqual([SKILL]);

    const content = readFileSync(join(root, SKILL), "utf8");
    expect(content).toContain("lucid:edit-skill skill=search");
    expect(content).toContain("clamp limit to <= 50");

    // Idempotent: re-applying the same edit does not duplicate the annotation.
    editSkillAdapter.apply(detail, root);
    const after = readFileSync(join(root, SKILL), "utf8");
    expect(after.split("lucid:edit-skill skill=search").length - 1).toBe(1);
  });

  it("prompt-patch appends the structural directive to the prompt file", () => {
    const detail: PromptPatchDetail = {
      kind: "prompt-patch",
      promptId: "system",
      instruction: "always cite the source file path",
      targetFiles: [PROMPT],
    };
    expect(promptPatchAdapter.validate(detail, root)).toEqual({ ok: true });
    const written = promptPatchAdapter.apply(detail, root);
    expect(written).toEqual([PROMPT]);

    const content = readFileSync(join(root, PROMPT), "utf8");
    expect(content).toContain("lucid:prompt-patch prompt=system");
    expect(content).toContain("always cite the source file path");
  });

  it("delete-layer removes the named layer file (reversible via prior snapshot)", () => {
    const detail: DeleteLayerDetail = {
      kind: "delete-layer",
      layerId: "search",
      targetFiles: [SKILL],
    };
    expect(deleteLayerAdapter.validate(detail, root)).toEqual({ ok: true });
    expect(existsSync(join(root, SKILL))).toBe(true);

    const written = deleteLayerAdapter.apply(detail, root);
    expect(written).toEqual([SKILL]);
    expect(existsSync(join(root, SKILL))).toBe(false);

    // Idempotent: removing an already-absent layer is a no-op that still reports it.
    const again = deleteLayerAdapter.apply(detail, root);
    expect(again).toEqual([SKILL]);
  });

  it("no adapter writes outside harnessRoot (T-04-06)", () => {
    const escape = ["../../etc/passwd"];
    expect(trimContextAdapter.validate({ kind: "trim-context", removeSource: "x", targetFiles: escape }, root).ok).toBe(false);
    expect(editSkillAdapter.validate({ kind: "edit-skill", skillId: "x", instruction: "y", targetFiles: escape }, root).ok).toBe(false);
    expect(promptPatchAdapter.validate({ kind: "prompt-patch", promptId: "x", instruction: "y", targetFiles: escape }, root).ok).toBe(false);
    expect(deleteLayerAdapter.validate({ kind: "delete-layer", layerId: "x", targetFiles: escape }, root).ok).toBe(false);

    expect(() => trimContextAdapter.apply({ kind: "trim-context", removeSource: "x", targetFiles: escape }, root)).toThrow();
    expect(() => editSkillAdapter.apply({ kind: "edit-skill", skillId: "x", instruction: "y", targetFiles: escape }, root)).toThrow();
    expect(() => promptPatchAdapter.apply({ kind: "prompt-patch", promptId: "x", instruction: "y", targetFiles: escape }, root)).toThrow();
    expect(() => deleteLayerAdapter.apply({ kind: "delete-layer", layerId: "x", targetFiles: escape }, root)).toThrow();
  });
});
