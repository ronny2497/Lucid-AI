/**
 * The HarnessTrace JSON Schema (draft 2020-12), imported as a JS object so
 * downstream tooling can load and compile it without resolving a file path.
 *
 * The raw JSON file is also exposed via the package "./schema" export for
 * language-agnostic consumers.
 */

import harnessTraceSchema from "../schema/HarnessTrace.schema.json" with { type: "json" };

export { harnessTraceSchema };
