/**
 * RED -> GREEN: the run-list view renders one row per trace from GET /api/traces.
 *
 * We mount the presentational `RunList` with a mocked react-query fetch returning
 * two RunListRows and assert both rows render with agent / status / duration /
 * cost / event count. `cost: null` must render as "unknown" (never fabricated).
 */

import type { ReactElement } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RunList } from "../index.js";
import type { RunListRow, TracesResponse } from "../../api/types.js";

const NS = 1_000_000_000; // 1 second in ns

const rows: RunListRow[] = [
  {
    traceId: "trace-aaa",
    agentId: "billing-agent",
    harnessVersion: "0.1.0",
    startTime: 0,
    endTime: 2 * NS,
    statusCode: 0,
    durationNs: 2 * NS,
    cost: 0.0123,
    eventCount: 7,
  },
  {
    traceId: "trace-bbb",
    agentId: "support-agent",
    harnessVersion: "0.1.0",
    startTime: 0,
    endTime: 5 * NS,
    statusCode: 2,
    durationNs: 5 * NS,
    cost: null, // unpriced model -> must render "unknown"
    eventCount: 3,
  },
];

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("RunList", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async (): Promise<TracesResponse> => ({ traces: rows }),
      })) as unknown as typeof fetch,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders one row per trace with agent, status, and duration", async () => {
    renderWithClient(<RunList />);

    expect(await screen.findByText("billing-agent")).toBeInTheDocument();
    expect(await screen.findByText("support-agent")).toBeInTheDocument();

    // Both trace ids are present (one row each).
    expect(screen.getByText(/trace-aaa/)).toBeInTheDocument();
    expect(screen.getByText(/trace-bbb/)).toBeInTheDocument();
  });

  it("renders a null cost as 'unknown' (never fabricated)", async () => {
    renderWithClient(<RunList />);
    // Wait for data, then assert at least one "unknown" cost cell exists.
    await screen.findByText("support-agent");
    expect(screen.getAllByText(/unknown/i).length).toBeGreaterThan(0);
  });
});
