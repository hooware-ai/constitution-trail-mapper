import { DatasetError } from "../dataset";
import {
  assertSafeSuccessor,
  canonical,
  parseRefreshManifest,
  type RefreshManifest,
} from "./manifest";
import type { RuntimeFreshness } from "./freshness";

export const REFRESH_CACHE_KEY = "trail-mapper.refresh-hint/1";
/** Mutable manifest is never served from browser's ordinary HTTP cache, unlike verified hash-named parts. */
export async function fetchRefreshManifest(
  url: string,
  signal: AbortSignal,
  fetcher = fetch,
  timeoutMs = 15000,
): Promise<unknown> {
  const timed = new AbortController();
  const cancel = () => timed.abort();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) timed.abort();
  const timer = setTimeout(cancel, timeoutMs);
  try {
    const response = await fetcher(url, {
      cache: "no-store",
      signal: timed.signal,
      credentials: "same-origin",
    });
    if (!response.ok)
      throw new DatasetError(
        response.status === 404 ? "data-missing" : "data-unavailable",
        `Refresh description unavailable (HTTP ${response.status}). Keep accepted data and retry.`,
      );
    return await response.json();
  } catch (error) {
    if (error instanceof DatasetError) throw error;
    throw new DatasetError(
      "data-unavailable",
      "The refresh check failed or timed out. Accepted data is retained. Check the connection and retry.",
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}
/** One localStorage write is atomic across tabs. It is a wake-up hint, never cached authority/data adoption. */
export function saveRefreshHint(
  storage: Pick<Storage, "setItem">,
  manifest: RefreshManifest,
): void {
  storage.setItem(
    REFRESH_CACHE_KEY,
    JSON.stringify({
      schema: "trail-mapper.refresh-hint/1",
      sequence: manifest.sequence,
      version: manifest.dataset.version,
    }),
  );
}
/** Foreground only; no intervals, background promises, history/GPS, or notification service. */
export function bindRefreshLifecycle<T>(
  runtime: RuntimeFreshness<T>,
  win: Window = window,
  doc: Document = document,
): () => void {
  let closed = false;
  const check = (trigger: "resume" | "tab" | "online") => {
    if (closed) return;
    runtime.invalidate();
    if (doc.visibilityState === "visible") void runtime.check(trigger);
  };
  const visibility = () => {
    if (doc.visibilityState === "visible") check("resume");
    else runtime.invalidate();
  };
  const storage = (event: StorageEvent) => {
    if (
      event.key === REFRESH_CACHE_KEY ||
      event.key === SAFETY_FLOOR_KEY ||
      event.key === null
    )
      check("tab");
  };
  const online = () => {
    runtime.setOffline(false);
    check("online");
  };
  const offline = () => runtime.setOffline(true);
  const pageshow = () => check("resume");
  win.addEventListener("storage", storage);
  win.addEventListener("online", online);
  win.addEventListener("offline", offline);
  win.addEventListener("pageshow", pageshow);
  doc.addEventListener("visibilitychange", visibility);
  runtime.setOffline(win.navigator.onLine === false);
  if (doc.visibilityState === "visible") void runtime.check("launch");
  return () => {
    closed = true;
    win.removeEventListener("storage", storage);
    win.removeEventListener("online", online);
    win.removeEventListener("offline", offline);
    win.removeEventListener("pageshow", pageshow);
    doc.removeEventListener("visibilitychange", visibility);
  };
}

/** Metadata only: persisted history can reject releases, never load or approve routing data. */
export const SAFETY_FLOOR_KEY = "trail-mapper.refresh-safety-floor/1";
export async function readSafetyFloor(): Promise<RefreshManifest | null> {
  try {
    const saved = localStorage.getItem(SAFETY_FLOOR_KEY);
    if (saved === null) return null;
    const envelope = JSON.parse(saved);
    if (envelope.schema !== "trail-mapper.refresh-safety-floor/1")
      throw new Error();
    return parseRefreshManifest(envelope.manifest);
  } catch {
    throw new DatasetError(
      "data-unavailable",
      "Saved safety history could not be read. Keep accepted data and retry before Start.",
    );
  }
}
export async function commitSafetyFloor(
  manifest: RefreshManifest,
  signal: AbortSignal,
): Promise<void> {
  if (!navigator.locks)
    throw new DatasetError(
      "data-unavailable",
      "This browser cannot safely coordinate release history across tabs. Keep accepted data and use a supported browser before Start.",
    );
  await navigator.locks.request(SAFETY_FLOOR_KEY, { signal }, async () => {
    const previous = await readSafetyFloor();
    if (previous) assertSafeSuccessor(previous, manifest);
    try {
      const serialized = JSON.stringify({
        schema: "trail-mapper.refresh-safety-floor/1",
        manifest,
      });
      // Avoid ping-pong storage events for unchanged metadata.
      if (!previous || canonical(previous) !== canonical(manifest))
        localStorage.setItem(SAFETY_FLOOR_KEY, serialized);
      const saved = await readSafetyFloor();
      if (!saved || canonical(saved) !== canonical(manifest)) throw new Error();
    } catch {
      throw new DatasetError(
        "data-unavailable",
        "Safety history could not be saved. Accepted data is retained. Keep this page open and retry before Start.",
      );
    }
  });
}
