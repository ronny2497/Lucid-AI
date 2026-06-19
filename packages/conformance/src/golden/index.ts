/**
 * @lucid/conformance — golden corpus barrel.
 *
 * Re-exports the typed corpus index so consumers (06-02 conformance suite)
 * import from `./golden/index.js` rather than reaching into `corpus.ts`.
 */

export {
  GOLDEN_CORPUS,
  VIOLATION_TAGS,
  VIOLATION_TAG_SET,
  HSC_EVENT_TYPE_SET,
  type GoldenCategory,
  type ExpectedVerdict,
  type ViolationTag,
  type GoldenEntry,
} from "./corpus.js";
