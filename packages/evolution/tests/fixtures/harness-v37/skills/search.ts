/**
 * harness-v37 fixture skill — a tiny stub `search` skill module.
 *
 * This is a synthetic structural surface for the apply tests (edit-skill targets
 * a file like this). It is intentionally minimal and has no runtime behavior.
 */

export interface SearchArgs {
  query: string;
  limit?: number;
}

export function search(args: SearchArgs): string[] {
  // Stub: returns no results. The apply tests only need a real file to edit.
  void args;
  return [];
}
