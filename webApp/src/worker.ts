/// <reference lib="webworker" />
import { dispatch } from "@trail-core";
import {
  DatasetError,
  identityOf,
  parseDatasetRecord,
  sha256Hex,
  verifyDatasetContent,
  type DatasetIdentity,
  type DatasetRecord,
} from "./dataset";
import { AccessLoader, AccessSession } from "./accessTiles";

// Fixed at build time (src/globals.d.ts). A county build has no fixture code path: the fixture import is removed.
interface Loaded {
  trails: string;
  access?: string;
  /** County builds with packaged access: loads service-road tiles around each operation's endpoints. */
  accessLoader?: AccessLoader;
  mode: "fixture" | "local" | "county";
  label: string;
  identity: DatasetIdentity | null;
  record: DatasetRecord | null;
  /** Fixture-only: accept hand-built routes that carry no feature identities. */
  trustSerializedRoutes: boolean;
}

async function fetchOrExplain(url: string, what: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-cache" });
  } catch {
    throw new DatasetError(
      "data-unavailable",
      `${what} could not be downloaded. Check your connection and retry.`,
    );
  }
  if (response.status === 404)
    throw new DatasetError(
      "data-missing",
      `${what} is missing from this site. Retry; if it persists the site needs attention.`,
    );
  if (!response.ok)
    throw new DatasetError(
      "data-unavailable",
      `${what} could not be downloaded (HTTP ${response.status}). Retry in a moment.`,
    );
  return response;
}

/** The packaged county candidate: fetched, described, hash-checked, then and only then given to the router. */
async function loadCounty(pinned?: unknown): Promise<Loaded> {
  const base = import.meta.env.BASE_URL;
  let raw: unknown = pinned;
  if (pinned === undefined) {
    const described = await fetchOrExplain(
      `${base}data/dataset.json`,
      "The trail data description",
    );
    try {
      raw = await described.json();
    } catch {
      throw new DatasetError(
        "data-corrupt",
        "The trail data description is not readable.",
      );
    }
  }
  const record = parseDatasetRecord(raw, __TRAIL_CHANNEL__);
  // A replacement worker is pinned to the exact data the page started with (the network file is named by its hash), so
  // the page's identity, map and saved routes always describe the data being routed on. Newer data needs a reload.
  const reload = pinned
    ? " The trail data changed since this page opened; reload the page to use the current data."
    : "";
  let trails: string;
  let access: string | undefined;
  let accessLoader: AccessLoader | undefined;
  try {
    const content = await fetchOrExplain(
      `${base}data/${record.content.file}`,
      "The trail data",
    );
    trails = await verifyDatasetContent(await content.arrayBuffer(), record);
    if (record.access) {
      // The identity a saved route remembers must be exactly the network plus the tile index this record pins.
      const combined = await sha256Hex(
        new TextEncoder().encode(
          `${record.content.sha256}:${record.access.index.sha256}`,
        ).buffer as ArrayBuffer,
      );
      if (combined !== record.access.combinedSha256)
        throw new DatasetError(
          "data-corrupt",
          "The trail data description is inconsistent about its road data.",
        );
      accessLoader = new AccessLoader(record.access, {
        fetchBytes: async (file) =>
          (
            await fetchOrExplain(`${base}data/${file}`, "Road data")
          ).arrayBuffer(),
        sha256Hex,
        dispatch: (request) => JSON.parse(dispatch(JSON.stringify(request))),
      });
      access = await accessLoader.baseText();
    }
  } catch (error) {
    if (error instanceof DatasetError && reload)
      throw new DatasetError(error.code, error.message + reload);
    throw error;
  }
  return {
    trails,
    access,
    accessLoader,
    mode: "county",
    label: record.label,
    identity: identityOf(record),
    record,
    trustSerializedRoutes: false,
  };
}

async function loadFixture(): Promise<Loaded> {
  // Removed from county builds by the compile-time constant, so a county build cannot serve fixture data.
  if (__TRAIL_DATASET__ !== "fixture")
    throw new DatasetError(
      "data-incompatible",
      "The synthetic review network is not part of this build.",
    );
  const { default: fixture } = await import("./data/review-network.json");
  const trails = JSON.stringify(fixture);
  return {
    trails,
    mode: "fixture",
    label: "Synthetic review network — do not ride these paths",
    identity: {
      kind: "fixture",
      id: "synthetic-review-network",
      version: "1",
      contentSha256: await sha256Hex(
        new TextEncoder().encode(trails).buffer as ArrayBuffer,
      ).catch(() => "unavailable"),
    },
    record: null,
    trustSerializedRoutes: true,
  };
}

async function loadLocalReview(): Promise<Loaded & { access?: string }> {
  const response = await fetch("/local-review-data", { cache: "no-store" });
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("application/json")
  )
    throw new Error(
      "Local data is unavailable. Start the local-data review server or choose the synthetic review network.",
    );
  const data = await response.json();
  const base = JSON.parse(data.trails.replace(/^\uFEFF/, ""));
  const extra = JSON.parse(data.supplement.replace(/^\uFEFF/, ""));
  return {
    trails: JSON.stringify({
      ...base,
      layers: [...base.layers, ...extra.layers],
    }),
    access: data.access,
    mode: "local",
    label: data.label,
    identity: null,
    record: null,
    trustSerializedRoutes: false,
  };
}

/** The operations of the current boot: road loading and dispatch are one step, one operation at a time. */
let session: AccessSession<unknown> | null = null;
const run = (request: Record<string, unknown>): unknown =>
  JSON.parse(dispatch(JSON.stringify(request)));

async function handle(event: MessageEvent) {
  const { id, request } = event.data;
  try {
    if (request.op === "boot") {
      // A failed replacement must not leave the previous boot's operations running on new data.
      session = null;
      if (request.local && !import.meta.env.DEV)
        throw new Error(
          "Local network review is available only in the local development server.",
        );
      // Exactly one source per boot, chosen by the build and the explicit development flag: no fallbacks.
      const data =
        import.meta.env.DEV && request.local
          ? await loadLocalReview()
          : __TRAIL_DATASET__ === "county"
            ? await loadCounty(request.pinned)
            : await loadFixture();
      const result = JSON.parse(
        dispatch(
          JSON.stringify({
            op: "initialize",
            trails: data.trails,
            access: data.access,
            dataset: data.identity,
            trustSerializedRoutes: data.trustSerializedRoutes,
            now: Date.now(),
          }),
        ),
      );
      if (result.ok === false) throw new Error(result.error);
      session = new AccessSession(data.accessLoader ?? null, run);
      self.postMessage({
        id,
        result: {
          ...result,
          mode: data.mode,
          label: data.label,
          datasetRecord: data.record,
        },
      });
    } else
      self.postMessage({
        id,
        result: await (session ?? new AccessSession(null, run)).run(request),
      });
  } catch (error) {
    self.postMessage({
      id,
      result: {
        ok: false,
        code: error instanceof DatasetError ? error.code : undefined,
        error:
          error instanceof Error ? error.message : "The routing worker failed.",
      },
    });
  }
}

// Messages are handled strictly in arrival order, boot included: a replacement boot never overtakes an operation that is
// still loading its roads, and one operation's failure never blocks the next.
let queue: Promise<void> = Promise.resolve();
self.onmessage = (event: MessageEvent) => {
  queue = queue.then(() => handle(event));
};
