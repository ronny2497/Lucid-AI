/**
 * scaffoldAdapter() — the `adapter init` file emitter (REQ-07 onramp).
 *
 * Deterministically writes a runnable adapter package skeleton from EMBEDDED
 * templates (no yeoman/plop generator dependency — RESEARCH "Don't Hand-Roll"):
 *
 *   - `adapter.ts`     — a defineAdapter skeleton with placeholder hooks.
 *   - `manifest.json`  — an AdapterManifestSchema-valid manifest.
 *   - `<name>.fixture.json` — a conformance fixture (a valid honest-absence HSC
 *                        trace) so a freshly scaffolded adapter is immediately
 *                        conformance-runnable.
 *
 * Hardening:
 *   T-06-08 (path traversal): `targetDir` is resolved through the SAME double
 *     containment guard used by packages/conformance/src/cli.ts (resolveInRoot —
 *     lexical + realpath). Any path escaping the root is rejected BEFORE any
 *     write. The guard is replicated here (not imported) to avoid a runtime
 *     dependency on the conformance package; it is the identical algorithm and
 *     cites that source.
 *   T-06-09 (clobber): an existing target file is NEVER overwritten unless
 *     `force:true` is passed.
 *
 * Honesty: the rendered manifest is parsed through AdapterManifestSchema after
 * writing nothing-yet — if it is invalid the scaffold throws and writes NOTHING,
 * so it can never emit a malformed manifest. The fixture omits verify.result /
 * feedback.check (absence is signal, D-05): the skeleton starts honest.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AdapterManifestSchema } from "./manifest.js";

/** Options for {@link scaffoldAdapter}. */
export interface ScaffoldOptions {
  /** Adapter package name (manifest `name`, template token {{NAME}}). */
  name: string;
  /** Framework + version the adapter bridges ({{FRAMEWORK}}). */
  framework: string;
  /** The HSC version the adapter targets, e.g. "v0" ({{HSC_VERSION}}). */
  hscVersion: string;
  /** Directory (relative to `root`, or absolute) to scaffold into. */
  targetDir: string;
  /** Containment root the targetDir must resolve inside (defaults to cwd). */
  root?: string;
  /** Overwrite existing files when true (default false → no clobber, T-06-09). */
  force?: boolean;
}

/** Absolute paths of the three files {@link scaffoldAdapter} writes. */
export interface ScaffoldResult {
  files: {
    /** The rendered adapter.ts source. */
    adapter: string;
    /** The rendered manifest.json. */
    manifest: string;
    /** The rendered conformance fixture trace. */
    fixture: string;
  };
}

/**
 * Resolve a user-supplied directory against `root` and reject any path that
 * escapes it. Replicates conformance/src/cli.ts `resolveInRoot` (cited): lexical
 * containment on the `..`-normalized absolute path (works for not-yet-existing
 * paths) PLUS a realpath check (defeats symlink escapes). Both candidate and
 * root are realpath'd before comparison so a symlinked root (or macOS
 * /tmp -> /private/tmp) does not yield a false escape verdict.
 */
function resolveInRoot(targetDir: string, root: string): string {
  const rootAbs = resolve(root);
  const abs = isAbsolute(targetDir) ? resolve(targetDir) : resolve(rootAbs, targetDir);

  // (1) Lexical containment — works even when the target does not exist yet.
  const rel = relative(rootAbs, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`target directory escapes root: ${targetDir}`);
  }

  // (2) Real-path containment — defeats symlink escapes. If the candidate does
  // not exist yet, keep the lexical absolute path (we are about to create it).
  let real: string;
  try {
    real = realpathSync(abs);
  } catch {
    return abs;
  }
  let realRoot: string;
  try {
    realRoot = realpathSync(rootAbs);
  } catch {
    realRoot = rootAbs;
  }
  const realRel = relative(realRoot, real);
  if (realRel === "" || realRel.startsWith("..") || isAbsolute(realRel)) {
    throw new Error(`target directory escapes root: ${targetDir}`);
  }
  return real;
}

/** Directory holding the embedded `.tmpl` files, alongside this module. */
const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), "templates");

/** Read a template by file name from the embedded templates directory. */
function readTemplate(file: string): string {
  return readFileSync(join(TEMPLATE_DIR, file), "utf8");
}

/** Render a template by replacing every `{{TOKEN}}` (no template-engine dep). */
function render(template: string, tokens: Readonly<Record<string, string>>): string {
  let out = template;
  for (const [key, value] of Object.entries(tokens)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

/**
 * Scaffold a runnable adapter package into `targetDir` (inside `root`). Writes an
 * adapter source, a schema-valid manifest, and a conformance fixture. Throws —
 * writing NOTHING — if the path escapes the root, a target file already exists
 * (without `force`), or the rendered manifest fails AdapterManifestSchema.
 */
export function scaffoldAdapter(opts: ScaffoldOptions): ScaffoldResult {
  const root = opts.root ?? process.cwd();
  const dir = resolveInRoot(opts.targetDir, root);

  const tokens = {
    NAME: opts.name,
    FRAMEWORK: opts.framework,
    HSC_VERSION: opts.hscVersion,
  } as const;

  const adapterPath = join(dir, "adapter.ts");
  const manifestPath = join(dir, "manifest.json");
  const fixturePath = join(dir, `${opts.name}.fixture.json`);

  // Render everything FIRST (no partial writes if rendering/validation fails).
  const adapterSrc = render(readTemplate("adapter.ts.tmpl"), tokens);
  const manifestSrc = render(readTemplate("manifest.json.tmpl"), tokens);
  const fixtureSrc = render(readTemplate("fixture.json.tmpl"), tokens);

  // Validate the rendered manifest against the 06-01 contract BEFORE writing —
  // the scaffold must never emit an invalid manifest.
  const parsed = AdapterManifestSchema.safeParse(JSON.parse(manifestSrc));
  if (!parsed.success) {
    throw new Error(
      `scaffolded manifest is invalid against AdapterManifestSchema: ${parsed.error.message}`,
    );
  }

  // No-clobber guard (T-06-09): refuse if ANY target file exists, unless force.
  if (!opts.force) {
    for (const p of [adapterPath, manifestPath, fixturePath]) {
      if (existsSync(p)) {
        throw new Error(
          `refusing to overwrite existing file (pass force to clobber): ${p}`,
        );
      }
    }
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(adapterPath, adapterSrc, "utf8");
  writeFileSync(manifestPath, manifestSrc, "utf8");
  writeFileSync(fixturePath, fixtureSrc, "utf8");

  return { files: { adapter: adapterPath, manifest: manifestPath, fixture: fixturePath } };
}
