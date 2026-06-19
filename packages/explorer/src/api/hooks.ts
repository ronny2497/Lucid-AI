/**
 * @tanstack/react-query hooks over the collector query API.
 *
 * These are the only data sources for the explorer: `useTraces` (run list),
 * `useTrace` (single trace), `useMetrics` (server-derived BaseMetrics). All are
 * read-only — there are no mutation hooks (Phase 1 read-only scope, T-01-15).
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { fetchMetrics, fetchTrace, fetchTraces } from "./client.js";
import type {
  BaseMetrics,
  HarnessTrace,
  TraceFilterQuery,
  TracesResponse,
} from "./types.js";

/** Run list — `GET /api/traces` with the active filter. */
export function useTraces(
  filter: TraceFilterQuery = {},
): UseQueryResult<TracesResponse, Error> {
  return useQuery({
    queryKey: ["traces", filter],
    queryFn: () => fetchTraces(filter),
  });
}

/** Single trace — `GET /api/traces/:id`. Disabled until an id is provided. */
export function useTrace(
  id: string | undefined,
): UseQueryResult<HarnessTrace, Error> {
  return useQuery({
    queryKey: ["trace", id],
    queryFn: () => fetchTrace(id as string),
    enabled: Boolean(id),
  });
}

/** Base metrics — `GET /api/metrics` for the window (server-derived). */
export function useMetrics(
  filter: TraceFilterQuery = {},
): UseQueryResult<BaseMetrics, Error> {
  return useQuery({
    queryKey: ["metrics", filter],
    queryFn: () => fetchMetrics(filter),
  });
}
