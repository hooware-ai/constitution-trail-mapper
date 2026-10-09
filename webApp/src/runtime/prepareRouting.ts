import { RoutingClient } from "../core";
import { DatasetError, identityOf, sha256Hex } from "../dataset";
import {
  routeNeedsRecalculation,
  type Network,
  type RouteResult,
} from "../types";
import { canonical, type RefreshManifest } from "./manifest";
import type { PreparedData, RuntimeFreshness } from "./freshness";

export interface RuntimeRoutingData {
  client: RoutingClient;
  network: Network;
}
/** A second worker is the transaction boundary: a failed candidate cannot mutate the accepted core/session. */
export async function prepareRefreshRouting(
  manifest: RefreshManifest,
  signal: AbortSignal,
  createClient = () => new RoutingClient(),
): Promise<PreparedData<RuntimeRoutingData>> {
  const client = createClient();
  const cancel = () => client.dispose();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted)
      throw new DatasetError(
        "data-unavailable",
        "The refresh was interrupted. Retry the check.",
      );
    const network = await client.call<Network>({
      op: "boot",
      pinned: manifest.dataset,
      validateRefresh: true,
    });
    if (
      network.mode !== "county" ||
      canonical(network.dataset) !== canonical(identityOf(manifest.dataset)) ||
      canonical(network.datasetRecord) !== canonical(manifest.dataset)
    )
      throw new DatasetError(
        "data-incompatible",
        "The prepared router does not match the reviewed release. Keep accepted data.",
      );
    if (!Array.isArray(network.closures))
      throw new DatasetError(
        "data-corrupt",
        "The prepared closure catalog is missing.",
      );
    const actual = await Promise.all(
      network.closures.map(async (closure) => ({
        id: closure.id,
        contentSha256: await sha256Hex(
          new TextEncoder().encode(canonical(closure)).buffer as ArrayBuffer,
        ),
      })),
    );
    const byId = (a: { id: string }, b: { id: string }) =>
      a.id.localeCompare(b.id);
    if (
      canonical(actual.sort(byId)) !==
      canonical([...manifest.closures].sort(byId))
    )
      throw new DatasetError(
        "data-corrupt",
        "The routing closure catalog differs from the reviewed release. Keep accepted closures.",
      );
    if (signal.aborted)
      throw new DatasetError(
        "data-unavailable",
        "The refresh was interrupted. Retry the check.",
      );
    client.pinDataset(manifest.dataset);
    return {
      manifest,
      value: { client, network },
      dispose: () => client.dispose(),
    };
  } catch (error) {
    client.dispose();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

/** Host uses the existing foreground controller in begin; inspection never overwrites the saved route. */
export function startReviewedRoute(
  runtime: RuntimeFreshness<RuntimeRoutingData>,
  route: unknown,
  begin: (data: RuntimeRoutingData, route: unknown) => void,
  onInspected?: (result: RouteResult) => void,
): Promise<boolean> {
  return runtime.start(
    route,
    async (data, saved) => {
      const result = await data.client.call<RouteResult>({
        op: "inspect",
        route: saved,
        now: Date.now(),
      });
      onInspected?.(result);
      return {
        canNavigate:
          result.canNavigate === true &&
          !routeNeedsRecalculation(result) &&
          result.network?.status === "current" &&
          result.closures.length === 0 &&
          result.proposed !== true,
      };
    },
    begin,
  );
}
