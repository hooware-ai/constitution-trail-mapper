// Synthetic browser fixture only. Production App wiring belongs to the integration owner.
import { createRoot } from "react-dom/client";
import { RuntimeFreshness } from "../../src/runtime/freshness";
import { RuntimeFreshnessStatus } from "../../src/runtime/RuntimeFreshness";
import {
  bindRefreshLifecycle,
  fetchRefreshManifest,
  saveRefreshHint,
} from "../../src/runtime/browser";
import { verifyDatasetContent } from "../../src/dataset";
let quotaFailure = false,
  starts = 0,
  inspected = 0;
const runtime = new RuntimeFreshness<number>({
  readManifest: (signal) =>
    fetchRefreshManifest("/runtime-test/manifest", signal),
  prepare: async (manifest, signal) => {
    const response = await fetch(
      `/runtime-test/${manifest.dataset.content.file}`,
      { signal, cache: "no-cache" },
    );
    if (!response.ok)
      throw Error("Mandatory data unavailable. Accepted data retained.");
    await verifyDatasetContent(await response.arrayBuffer(), manifest.dataset);
    return { manifest, value: manifest.sequence, dispose: () => {} };
  },
  saveManifest: (m) => {
    if (quotaFailure) throw Error("quota");
    saveRefreshHint(localStorage, m);
  },
});
const unbind = bindRefreshLifecycle(runtime);
const api = {
  state: () => runtime.snapshot,
  accepted: () => runtime.accepted?.manifest ?? null,
  check: () => runtime.check("manual"),
  active: (active: boolean) => runtime.setActiveRide(active),
  quota: () => (quotaFailure = true),
  invalidate: () => runtime.invalidate(),
  start: () =>
    runtime.start(
      { saved: true },
      async () => {
        inspected++;
        return { canNavigate: true };
      },
      () => {
        starts++;
      },
    ),
  counts: () => ({ starts, inspected }),
  dispose: () => {
    unbind();
    runtime.dispose();
  },
};
Object.assign(window, { runtimeTest: api });
createRoot(document.getElementById("root")!).render(
  <>
    <h1>Synthetic runtime review</h1>
    <p>Existing legal attribution and closure warning stay here.</p>
    <RuntimeFreshnessStatus
      runtime={runtime}
      appBuild="test-build-separate-from-data"
    />
  </>,
);
