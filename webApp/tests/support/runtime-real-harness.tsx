import { readSafetyFloor, commitSafetyFloor } from "../../src/runtime/browser";
import { createRoot } from "react-dom/client";
import { RuntimeFreshness } from "../../src/runtime/freshness";
import { fetchRefreshManifest } from "../../src/runtime/browser";
import {
  prepareRefreshRouting,
  startReviewedRoute,
} from "../../src/runtime/prepareRouting";
import { RuntimeFreshnessStatus } from "../../src/runtime/RuntimeFreshness";
import type { RouteResult } from "../../src/types";
const runtime = new RuntimeFreshness({
  readSafetyFloor,
  commitSafetyFloor,
  readManifest: (signal) =>
    fetchRefreshManifest("/runtime-test/manifest", signal),
  prepare: prepareRefreshRouting,
});
let starts = 0;
Object.assign(window, {
  realRuntime: {
    state: () => runtime.snapshot,
    version: () => runtime.accepted?.value.network.dataset?.version,
    check: () => runtime.check("manual"),
    active: (active: boolean) => runtime.setActiveRide(active),
    plan: async () =>
      runtime.accepted!.value.client.call<RouteResult>({
        op: "plan",
        start: { latitude: 40.5, longitude: -88.99 },
        destination: { latitude: 40.52, longitude: -88.97 },
        proposed: false,
        now: Date.now(),
      }),
    start: (route: unknown) =>
      startReviewedRoute(runtime, route, () => {
        starts++;
      }),
    inspect: (route: unknown) =>
      runtime.accepted!.value.client.call({
        op: "inspect",
        route,
        now: Date.now(),
      }),
    starts: () => starts,
  },
});
createRoot(document.getElementById("root")!).render(
  <>
    <h1>Real worker synthetic runtime review</h1>
    <RuntimeFreshnessStatus runtime={runtime} appBuild="test-core" />
  </>,
);
void runtime.check("launch");
