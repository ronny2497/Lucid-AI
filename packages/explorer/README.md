# @lucid/explorer

The read-only Lucid trace explorer SPA (Vite + React 18 + Recharts). It renders,
from the collector's `/api/*` routes:

- **Run list** (`/`) — one row per trace from `GET /api/traces`, with
  agent / version / since / status filters.
- **Single-trace view** (`/traces/$id`) — `GET /api/traces/:id` as turns →
  events with principle + quadrant badges, a Recharts Gantt timeline, and the
  server-derived base-metrics panel scoped to the trace's agent.

It is **read-only** in Phase 1: no mutation endpoints or controls (PRD §3
non-goal, T-01-15).

## How it is served

- **Bundled (default).** `vite build` emits a static bundle in `dist/`. The
  collector serves it same-origin, so the SPA fetches from the relative `/api`
  base with no CORS/config (PRD §11).
- **Split dev.** `pnpm --filter @lucid/explorer dev` starts Vite on `:5173`. The
  dev server proxies `/api` → the local collector (default `http://localhost:3000`,
  override with `LUCID_COLLECTOR_URL`). Override the runtime API base with
  `VITE_API_BASE` if you host the SPA and API on different origins.

## API base-URL config

`src/api/client.ts#apiBase()` returns `VITE_API_BASE` (trimmed of a trailing
slash) or the same-origin default `/api`.

## Honest absence (D-05)

A `feedback.check` event whose `quadrant.y` was not tagged by the emitter renders
an explicit **"absent"** badge — never a fabricated `computational`/`inferential`
value. Intentionally-untagged actions (`tool.call`, `error`) render a neutral
`—`. This is the seed of the Phase 2 empty-feedback diagnostic.

## Security

All attribute content is rendered through JSX text (escaped by React). No
raw-HTML injection prop is used anywhere (T-01-13).

## Scripts

| Script | What |
|--------|------|
| `dev` | Vite dev server (proxies `/api`) |
| `build` | `tsc --noEmit` typecheck + `vite build` static bundle |
| `preview` | Preview the built bundle |
| `test` | `vitest run` (jsdom component tests) |
| `typecheck` | `tsc --noEmit` |
