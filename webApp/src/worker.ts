/// <reference lib="webworker" />
import { dispatch } from "@trail-core";
import fixture from "./data/review-network.json";
self.onmessage = async (event: MessageEvent) => {
  const { id, request } = event.data;
  try {
    if (request.op === "boot") {
      let data: any;
      if (request.local && !import.meta.env.DEV)
        throw new Error(
          "Local network review is available only in the local development server.",
        );
      if (import.meta.env.DEV && request.local) {
        const response = await fetch("/local-review-data", {
          cache: "no-store",
        });
        if (
          !response.ok ||
          !response.headers.get("content-type")?.includes("application/json")
        )
          throw new Error(
            "Local data is unavailable. Start the local-data review server or choose the synthetic review network.",
          );
        data = await response.json();
        const base = JSON.parse(data.trails.replace(/^\uFEFF/, ""));
        const extra = JSON.parse(data.supplement.replace(/^\uFEFF/, ""));
        data.trails = JSON.stringify({
          ...base,
          layers: [...base.layers, ...extra.layers],
        });
      } else
        data = {
          trails: JSON.stringify(fixture),
          mode: "fixture",
          label: "Synthetic review network — do not ride these paths",
        };
      const result = JSON.parse(
        dispatch(
          JSON.stringify({
            op: "initialize",
            trails: data.trails,
            access: data.access,
            now: Date.now(),
          }),
        ),
      );
      self.postMessage({
        id,
        result: { ...result, mode: data.mode, label: data.label },
      });
    } else
      self.postMessage({
        id,
        result: JSON.parse(dispatch(JSON.stringify(request))),
      });
  } catch (error) {
    self.postMessage({
      id,
      result: {
        ok: false,
        error:
          error instanceof Error ? error.message : "The routing worker failed.",
      },
    });
  }
};
