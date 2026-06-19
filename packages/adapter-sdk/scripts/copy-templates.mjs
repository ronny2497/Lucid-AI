/**
 * Copy the embedded `adapter init` templates into dist/ after tsc.
 *
 * tsc only emits .js/.d.ts for .ts sources; the `.tmpl` template files that
 * scaffold.ts reads at runtime (via dirname(import.meta.url)/templates) are not
 * compiled, so the build step copies them verbatim to dist/templates so the
 * built scaffolder finds them with the SAME relative path it uses under src/.
 */

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcTemplates = join(pkgRoot, "src", "templates");
const distTemplates = join(pkgRoot, "dist", "templates");

if (!existsSync(srcTemplates)) {
  console.error(`copy-templates: source templates dir missing: ${srcTemplates}`);
  process.exit(1);
}

mkdirSync(distTemplates, { recursive: true });
cpSync(srcTemplates, distTemplates, { recursive: true });
console.log(`copy-templates: copied templates -> ${distTemplates}`);
