import { readSafetyFloor, commitSafetyFloor } from "../../src/runtime/browser";
// Explicit synthetic host injection. Production main.tsx never supplies an endpoint or policy.
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../src/App";
import {
  fetchRefreshManifest,
  saveRefreshHint,
} from "../../src/runtime/browser";
import { prepareRefreshRouting } from "../../src/runtime/prepareRouting";
import type { RefreshDependencies } from "../../src/runtime/freshness";
import type { RuntimeRoutingData } from "../../src/runtime/prepareRouting";
import "../../src/styles.css";
const uses: Array<{ version: string; op: string }> = [];
Object.assign(window, { runtimeRoutingUses: uses });
const refresh: RefreshDependencies<RuntimeRoutingData> &
  Required<
    Pick<
      RefreshDependencies<RuntimeRoutingData>,
      "readSafetyFloor" | "commitSafetyFloor"
    >
  > = {
  readSafetyFloor,
  commitSafetyFloor,
  readManifest: (signal) =>
    fetchRefreshManifest("/runtime-test/manifest", signal),
  prepare: async (manifest, signal) => {
    const data = await prepareRefreshRouting(manifest, signal);
    const call = data.value.client.call.bind(data.value.client);
    data.value.client.call = async (request) => {
      uses.push({ version: manifest.dataset.version, op: String(request.op) });
      const result = await call(request);
      uses.push({
        version: manifest.dataset.version,
        op: `${String(request.op)}:done`,
      });
      return result;
    };
    return data;
  },
  saveManifest: (manifest) => saveRefreshHint(localStorage, manifest),
};
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App refresh={refresh} />
  </React.StrictMode>,
);
