/**
 * Code-based TanStack Router tree (no file-based codegen, keeping the build
 * dependency-light). Two routes:
 *   `/`            -> the run list (RunListRoute)
 *   `/traces/$id`  -> the single-trace view (TraceRoute)
 *
 * The router is read-only navigation only; no route mutates server state.
 */

import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { RunList } from "./routes/index.js";
import { TraceView } from "./routes/traces.$id.js";

const rootRoute = createRootRoute({
  component: () => (
    <div className="app-shell">
      <header className="app-header">
        <h1>Lucid Explorer</h1>
        <span className="app-subtitle">read-only trace &amp; metrics view</span>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: RunList,
});

const traceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/traces/$id",
  component: function TraceRouteComponent() {
    const { id } = traceRoute.useParams();
    return <TraceView traceId={id} />;
  },
});

const routeTree = rootRoute.addChildren([indexRoute, traceRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
