import { useEffect, useRef, useState } from "react";
import { RoutingClient, ROUTING_UNAVAILABLE_MESSAGE } from "./core";
import {
  BrowserHistorySync,
  resolvePop,
  type PopContext,
} from "./platform/browserHistory";
import { MapView } from "./MapView";
import { DataSources } from "./DataSources";
import { loopComparison, loopHeading } from "./loopSummary";
import { applyReverse, reverseOutcome } from "./reverseGate";
import { renderImage } from "./shareImage";
import { HelpDialog } from "./Help";
import { AccessConnections } from "./AccessConnections";
import {
  type DialogNotice,
  EndpointField,
  DirectionControl,
  Legend,
  Modal,
  PlaceChooser,
  ProposedChoice,
  RouteRow,
  SafeLink,
} from "./components";
import {
  emptyDraft,
  miles,
  routeNeedsRecalculation,
  type Draft,
  type Endpoint,
  type MapCues,
  type Network,
  type Point,
  type RouteResult,
} from "./types";
import {
  ActiveRideStore,
  CarriedRideStore,
  CompletedSessionStore,
  LocalRouteStore,
  stableRouteKey,
  type PlaceRecord,
  type RouteLibrary,
  type RouteRecord,
  type StoragePort,
  type StoreResult,
} from "./platform/storage";
import {
  ForegroundNavigationController,
  bindNavigationLifecycle,
  browserLocationPort,
  type NavigationState,
} from "./platform/navigation";
import { acquirePlannerLocation } from "./platform/plannerLocation";
import { addressIndexSource } from "./addressSearch";

// The synthetic address test seam: only the development server, only with ?addressFixture in the address, read once.
// A built artifact (fixture or county) never has it, so an ordinary fixture page offers no address search.
const ADDRESS_FIXTURE_SEAM =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).has("addressFixture");
import { ForegroundWakeLock } from "./platform/wakeLock";
import { BrowserSessionStore, type BrowserSession } from "./platform/session";
import {
  EXPORT_METADATA_NOTE,
  privateRouteShare,
  routeGeoJson,
  type Coordinate,
} from "./platform/sharing";
type Screen =
  | "plan"
  | "planner"
  | "searching"
  | "preview"
  | "navigation"
  | "saved"
  | "explore"
  | "updates"
  | "map-picker";
type Popup = "directions" | "share" | "clear" | "rename" | "help" | null;
const EMPTY_LIBRARY: RouteLibrary = {
  version: 1,
  saved: [],
  recent: [],
  places: [],
};
const emptyNavigation: NavigationState = {
  phase: "idle",
  message: "",
  record: null,
  fix: null,
  guidance: null,
  routeProgressMeters: 0,
  riddenMeters: 0,
  creditedDistanceMeters: 0,
  wakeLock: "unsupported",
};
// Which data this build plans on decides which saved routes it can see: fixture, local review and county never mix.
const STORAGE_NAMESPACE = __TRAIL_DATASET__ === "county" ? "county" : "fixture";
/** Sentences for the rider when a route no longer matches the loaded trail data. */
const staleRouteMessage = (result: RouteResult) => {
  const details = [
    ...new Set((result.network?.issues ?? []).map((issue) => issue.detail)),
  ].slice(0, 3);
  return result.network?.status === "unverifiable"
    ? "This route cannot be checked against the current trail data, so it cannot be ridden as it is."
    : `The trail data has changed since this route was planned${details.length ? ` (${details.join("; ")})` : ""}.`;
};
const storageFor = (mode: string): StoragePort => ({
  getItem: (key) => localStorage.getItem("trail-mapper." + mode + ":" + key),
  setItem: (key, value) =>
    localStorage.setItem("trail-mapper." + mode + ":" + key, value),
  removeItem: (key) =>
    localStorage.removeItem("trail-mapper." + mode + ":" + key),
});
const storageIssueMessage = (error: StoreResult<unknown>["error"]) =>
  error === "quota"
    ? "Browser storage is full. This change was not saved."
    : error === "corrupt" || error === "unsupported-version"
      ? "Saved browser data could not be read. It has been preserved."
      : "Browser storage is unavailable. This change was not saved.";
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
/**
 * True when asking again can give a different answer: a download, a connection, a timeout or a replaced worker. A search
 * that found no route is not retryable, since the same question has the same answer (native: `RouteNotice.retryable`).
 */
const retryable = (error: unknown) =>
  ["data-unavailable", "data-missing", "data-corrupt"].includes(
    (error as { code?: string } | null)?.code ?? "",
  ) ||
  (error instanceof Error &&
    /took too long|cancelled|stopped unexpectedly|connection|could not be downloaded/i.test(
      error.message,
    ));
const routeOkay = (value: RouteResult & { error?: string }): RouteResult => {
  if (!value.route || !Array.isArray(value.segments))
    throw new Error(
      value.error ??
        "No safe route was found. Choose a different endpoint or distance.",
    );
  return value;
};
/**
 * A recalculated route gets an identity of its own, minted ONCE when it is made: the geometry key alone would make saving
 * it overwrite the route it came from (or any saved route that happens to share the geometry). The geometry key is kept
 * beside it, because that is what a reversal is checked against.
 */
const mintedKey = (geometryKey: string) =>
  `${geometryKey}~r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const recalculatedTitle = (title: string) =>
  title.endsWith(" (recalculated)") ? title : `${title} (recalculated)`;
export function App() {
  const panelRef = useRef<HTMLElement>(null);
  const canShare = typeof navigator.share === "function";
  const [local] = useState(
    () => new URL(location.href).searchParams.get("data") === "local",
  );
  const [screen, setScreen] = useState<Screen>("plan"),
    [network, setNetwork] = useState<Network | null>(null),
    [bootError, setBootError] = useState(""),
    [bootAttempt, setBootAttempt] = useState(0);
  const [draft, setDraft] = useState<Draft>(emptyDraft),
    [preview, setPreview] = useState<RouteResult | null>(null),
    [selected, setSelected] = useState<RouteRecord | null>(null),
    [library, setLibrary] = useState<RouteLibrary>(EMPTY_LIBRARY);
  const [field, setField] = useState<"start" | "destination" | null>(null),
    [pickField, setPickField] = useState<"start" | "destination">("start"),
    [popup, setPopup] = useState<Popup>(null),
    [dialogNotice, setDialogNotice] = useState<DialogNotice | null>(null);
  const popupOpen = useRef(false),
    dialogEpoch = useRef(0),
    shownPopup = useRef<Popup>(null),
    shareAttempt = useRef(0),
    imageAttempt = useRef(0),
    shownRouteRef = useRef<unknown>(undefined),
    announceFrame = useRef(0);
  popupOpen.current = popup !== null;
  // Every open or close is a new dialog session; late results from an earlier one are ignored.
  if (shownPopup.current !== popup) {
    shownPopup.current = popup;
    dialogEpoch.current++;
  }
  // Feedback belongs to one dialog session: never carried into the next one.
  useEffect(() => {
    cancelAnimationFrame(announceFrame.current);
    setDialogNotice(null);
  }, [popup]);
  /** Clear, then set on the next frame, so repeating the same message is still a change assistive tech announces. */
  function announce(notice: DialogNotice, epoch = dialogEpoch.current) {
    cancelAnimationFrame(announceFrame.current);
    setDialogNotice(null);
    announceFrame.current = requestAnimationFrame(() => {
      if (epoch === dialogEpoch.current) setDialogNotice(notice);
    });
  }
  // The key of the restored route whose planned direction is still being proved after a reload. While it is pending the
  // route on screen is the REVERSED record (its own geometry key), so nothing that depends on the planned route (Save,
  // the Saved indicator, reversing again) may act on it: each would resolve to the wrong record.
  const [pendingDirection, setPendingDirection] = useState<{
      key: string;
      plannedKey: string;
    } | null>(null),
    // Bumped whenever a proof ends, so a retry waiting for it (the rider came back while it was still held) can run.
    [proofEnded, setProofEnded] = useState(0),
    [reverseOf, setReverseOf] = useState<RouteRecord | null>(null),
    [showClosures, setShowClosures] = useState(true),
    [fitSignal, setFitSignal] = useState(0),
    [retryPlan, setRetryPlan] = useState(false),
    [error, setError] = useState(""),
    [storageError, setStorageError] = useState(""),
    [unreadableSaved, setUnreadableSaved] = useState<
      false | "aside" | "pending"
    >(false),
    [routingDown, setRoutingDown] = useState(false),
    [busy, setBusy] = useState(false),
    [checking, setChecking] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [nav, setNav] = useState<NavigationState>(emptyNavigation);
  const [savedTab, setSavedTab] = useState<"saved" | "recent">("saved"),
    [origin, setOrigin] = useState<"plan" | "saved" | "planner">("planner");
  const [toast, setToast] = useState<{
      message: string;
      undo?: () => void;
    } | null>(null),
    [renameTarget, setRenameTarget] = useState<
      RouteRecord | PlaceRecord | null
    >(null),
    [renameValue, setRenameValue] = useState(""),
    [exactExport, setExactExport] = useState(false);
  const [gapFocus, setGapFocus] = useState<{ id: string } | null>(null);
  const [locationRequest, setLocationRequest] = useState<{
    target: "start" | "destination";
    phase: "waiting" | "failure";
    message: string;
  } | null>(null);
  const cancelLocationRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelLocationRef.current?.(), []);
  const [sessionReady, setSessionReady] = useState(false);
  const sessionRef = useRef<BrowserSessionStore | null>(null);
  const clientRef = useRef<RoutingClient | null>(null),
    controllerRef = useRef<ForegroundNavigationController | null>(null),
    storeRef = useRef<LocalRouteStore | null>(null),
    activeRef = useRef<ActiveRideStore | null>(null),
    completedRef = useRef<CompletedSessionStore | null>(null),
    carriedStoreRef = useRef<CarriedRideStore | null>(null),
    // What the rider rode of earlier routes of THIS ride before a rejoin (null: nothing yet), kept with the route key.
    carriedRef = useRef<{
      distanceMeters: number;
      traversalEdges: unknown[];
    } | null>(null),
    finishLoopRef = useRef<(record: RouteRecord) => void>(() => {}),
    operation = useRef(0),
    directionPendingRef = useRef(false),
    proofRunning = useRef(false),
    selectedRef = useRef<RouteRecord | null>(null),
    snapshotState = useRef<unknown>(undefined);
  const success = (message: string, undo?: () => void) =>
    setToast({ message, undo });
  function applyStore(
    result: StoreResult<RouteLibrary>,
    message?: string,
    undo?: () => void,
  ) {
    setLibrary(result.state);
    setUnreadableSaved(
      result.pendingUnreadable
        ? "pending"
        : storeRef.current?.hasQuarantine()
          ? "aside"
          : false,
    );
    if (result.ok) {
      setStorageError("");
      if (message) success(message, undo);
    } else {
      const message = storageIssueMessage(result.error);
      setStorageError(message);
      // A dialog left open by the failed change shows the reason where it can be seen and heard.
      if (popupOpen.current) announce({ kind: "error", message });
    }
    return result.ok;
  }
  async function restartRouting() {
    const client = clientRef.current;
    if (!client) return;
    // Own the operation from the click, so leaving or opening another route while the worker boots
    // abandons this continuation instead of letting it apply results to newer work.
    const token = ++operation.current;
    const retained =
      screen === "preview" && selected && !preview && !nav.record;
    const route = retained ? selected.route : null;
    setError("");
    try {
      await client.recover();
      if (clientRef.current !== client || token !== operation.current) return;
      success("Route planning restarted");
      // A Saved/Recent or restored route whose inspection was interrupted keeps its geometry: inspect it again.
      if (route) {
        setChecking(true);
        try {
          const inspected = routeOkay(
            await client.call<RouteResult>({
              op: "inspect",
              route,
              now: Date.now(),
            }),
          );
          if (token === operation.current) setPreview(inspected);
        } catch (e) {
          if (token === operation.current) setError(errorText(e));
        } finally {
          if (token === operation.current) setChecking(false);
        }
      }
    } catch (e) {
      if (clientRef.current === client && token === operation.current)
        setError(errorText(e));
    }
  }
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    let disposed = false,
      initialized = false,
      unbind: undefined | (() => void),
      unsubscribe: undefined | (() => void);
    const client = new RoutingClient();
    clientRef.current = client;
    setRoutingDown(false);
    client.onUnavailableChange = (down) => {
      if (disposed) return;
      setRoutingDown(down);
      // Existing turn guidance must not outlive the worker that produced it.
      if (down) controllerRef.current?.routingUnavailable();
    };
    setBootError("");
    setNetwork(null);
    setSessionReady(false);
    const storage = storageFor(local ? "local" : STORAGE_NAMESPACE),
      store = new LocalRouteStore(storage),
      active = new ActiveRideStore(storage);
    storeRef.current = store;
    activeRef.current = active;
    completedRef.current = new CompletedSessionStore(storage);
    carriedStoreRef.current = new CarriedRideStore(storage);
    applyStore(store.read());
    const session = new BrowserSessionStore(storage);
    sessionRef.current = session;
    const previousSession = session.read();
    if (!previousSession.ok)
      setStorageError(
        "The previous screen could not be recovered. Its browser data has been preserved.",
      );
    client
      .call<Network>({ op: "boot", local })
      .then(async (data) => {
        if (disposed) return;
        initialized = true;
        setNetwork(data);
        if (data.datasetRecord) client.pinDataset(data.datasetRecord);
        const wake = new ForegroundWakeLock(navigator.wakeLock);
        const controller = new ForegroundNavigationController({
          location: navigator.geolocation
            ? browserLocationPort(navigator.geolocation)
            : undefined,
          storage: active,
          wakeLock: wake,
          onAccepted: (guidance) => {
            snapshotState.current = guidance.state;
          },
          onArrived: (record) => finishLoopRef.current(record),
          evaluate: async (route, fix, context) => {
            const response = await client.call<any>({
              op: "snapshot",
              route,
              point: { latitude: fix.latitude, longitude: fix.longitude },
              accuracy: fix.accuracy,
              timestamp: fix.timestamp,
              progress: context.previousProgress,
              // The first evaluation of a restored ride starts from the saved RIDDEN progress, not the matched position.
              ridden: context.previousRidden,
              resume: context.resume,
              state: snapshotState.current,
              now: Date.now(),
            });
            if (!response.credible)
              throw new Error("Location is not accurate enough for guidance.");
            return {
              ...response,
              routeProgressMeters: response.progress,
              distanceFromRouteMeters: response.distanceFromRoute,
              instruction:
                response.nextInstruction?.text ??
                (response.arrived
                  ? "You have arrived"
                  : "Continue along the route"),
              remainingMeters: response.remaining,
            };
          },
        });
        controllerRef.current = controller;
        unsubscribe = controller.subscribe(setNav);
        unbind = bindNavigationLifecycle(controller);
        const restored = active.read();
        if (!restored.ok)
          setStorageError(
            "The previous ride could not be recovered from this browser.",
          );
        if (restored.state) {
          const token = ++operation.current;
          const ride = restored.state;
          setReverseOf(null);
          setSelected(ride.record);
          setDraft(ride.record.draft as Draft);
          restoreScreen("preview");
          setChecking(true);
          try {
            const inspected = routeOkay(
              await client.call<RouteResult>({
                op: "inspect",
                route: ride.record.route,
                now: Date.now(),
              }),
            );
            if (disposed || token !== operation.current) return;
            setPreview(inspected);
            void restoreDirection(
              client,
              ride.record,
              () => !disposed && token === operation.current,
            );
            if (inspected.canNavigate) {
              snapshotState.current = undefined;
              const carried = carriedStoreRef.current?.read();
              carriedRef.current =
                carried && carried.recordKey === ride.record.key
                  ? carried.carried
                  : null;
              controller.start(
                ride.record,
                ride.routeProgressMeters,
                ride.creditedDistanceMeters,
                // The saved RIDDEN progress, kept apart from the matched position (older saves fall back conservatively).
                ride.riddenMeters,
              );
              restoreScreen("navigation");
            } else
              setError(
                routeNeedsRecalculation(inspected)
                  ? `${staleRouteMessage(inspected)} Your previous ride was not resumed: recalculate to plan a new route.`
                  : "Your previous ride needs review before navigation can resume.",
              );
          } catch (e) {
            if (!disposed && token === operation.current)
              setError(errorText(e));
          } finally {
            if (!disposed && token === operation.current) setChecking(false);
          }
        } else if (previousSession.state) {
          const restoredSession = previousSession.state;
          setDraft(restoredSession.draft);
          setReverseOf(null);
          setSelected(restoredSession.selected);
          setOrigin(restoredSession.origin);
          setSavedTab(restoredSession.savedTab);
          restoreScreen(restoredSession.screen);
          if (
            restoredSession.screen === "preview" &&
            restoredSession.selected
          ) {
            const token = ++operation.current;
            setChecking(true);
            try {
              const inspected = routeOkay(
                await client.call<RouteResult>({
                  op: "inspect",
                  route: restoredSession.selected.route,
                  now: Date.now(),
                }),
              );
              if (!disposed && token === operation.current) {
                setPreview(inspected);
                void restoreDirection(
                  client,
                  restoredSession.selected,
                  () => !disposed && token === operation.current,
                );
              }
            } catch (e) {
              if (!disposed && token === operation.current)
                setError(errorText(e));
            } finally {
              if (!disposed && token === operation.current) setChecking(false);
            }
          }
        }
      })
      .catch((e) => {
        if (!disposed) setBootError(errorText(e));
      })
      .finally(() => {
        if (!disposed && initialized) setSessionReady(true);
      });
    return () => {
      disposed = true;
      ++operation.current;
      unbind?.();
      unsubscribe?.();
      controllerRef.current?.dispose();
      controllerRef.current = null;
      client.dispose();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [local, bootAttempt]);
  const overlayOpen = popup !== null || field !== null;
  const historyRef = useRef<BrowserHistorySync | null>(null),
    popContext = useRef<PopContext>({
      screen,
      overlayOpen,
      navigating: false,
      hasPreview: false,
    }),
    goRef = useRef<(next: Screen) => void>(() => {}),
    fromPop = useRef(false),
    restoring = useRef(false),
    closingByPop = useRef(false),
    lastSynced = useRef<{ screen: string; overlay: boolean } | null>(null);
  popContext.current = {
    screen,
    overlayOpen,
    navigating: screen === "navigation",
    hasPreview: !!(selected && preview),
  };
  goRef.current = go;
  /** Screens brought back from the previous visit relabel the current history entry instead of adding one. */
  function restoreScreen(next: Screen) {
    if (next !== popContext.current.screen) restoring.current = true;
    setScreen(next);
  }
  // Browser Back/Forward: history entries hold only a screen name, never route or place data.
  useEffect(() => {
    // Record navigation from the first moment the UI is usable, not after restoration finishes.
    const sync: BrowserHistorySync = new BrowserHistorySync(
      window.history,
      (target, direction) => {
        const action = resolvePop(popContext.current, target, direction);
        if (action.type === "close-overlay") {
          closingByPop.current = true;
          setPopup(null);
          setField(null);
        } else if (action.type === "keep-navigating") {
          sync.push("navigation");
          setToast({
            message:
              "Your ride is still active. Use Stop navigation to end it.",
          });
        } else if (action.type === "stay") {
          sync.replace(popContext.current.screen);
        } else if (action.screen !== popContext.current.screen) {
          fromPop.current = true;
          goRef.current(action.screen as Screen);
        }
      },
    );
    sync.start(popContext.current.screen);
    historyRef.current = sync;
    // An overlay that was already open when history started has no entry yet: give it one, so closing it
    // pops an entry that exists instead of leaving the app.
    if (popContext.current.overlayOpen)
      sync.push(popContext.current.screen, true);
    lastSynced.current = {
      screen: popContext.current.screen,
      overlay: popContext.current.overlayOpen,
    };
    const onPop = (event: PopStateEvent) => sync.handlePop(event.state);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      historyRef.current = null;
    };
  }, []);
  useEffect(() => {
    const sync = historyRef.current,
      last = lastSynced.current;
    if (!sync || !last) return;
    if (last.overlay && !overlayOpen) {
      if (closingByPop.current) closingByPop.current = false;
      else sync.popOverlay();
    }
    if (last.screen !== screen) {
      if (fromPop.current) {
        fromPop.current = false;
        sync.replace(screen);
      } else if (restoring.current) {
        restoring.current = false;
        sync.replace(screen);
      } else sync.push(screen);
    }
    if (!last.overlay && overlayOpen) sync.push(screen, true);
    lastSynced.current = { screen, overlay: overlayOpen };
  }, [screen, overlayOpen]);
  useEffect(() => {
    if (!sessionReady || !sessionRef.current) return;
    const savedScreen: BrowserSession["screen"] =
      screen === "navigation"
        ? "preview"
        : screen === "searching" || screen === "map-picker"
          ? "planner"
          : screen;
    const persist = () => {
      const result = sessionRef.current?.write({
        version: 1,
        screen: savedScreen,
        draft,
        selected,
        savedTab,
        origin,
        updatedAt: Date.now(),
      });
      if (result && !result.ok)
        setStorageError(
          "Your current screen and draft could not be saved in this browser.",
        );
    };
    const timeout = setTimeout(persist, 300);
    const hide = () => {
      if (document.visibilityState === "hidden") persist();
    };
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [sessionReady, screen, draft, selected, savedTab, origin]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), toast.undo ? 12000 : 7000);
    return () => clearTimeout(timeout);
  }, [toast]);
  function cancelLocation() {
    cancelLocationRef.current?.();
    cancelLocationRef.current = null;
    setLocationRequest(null);
    setBusy(false);
  }
  function openPlace(field: "start" | "destination") {
    cancelLocation();
    setField(field);
  }
  function go(next: Screen) {
    cancelLocation();
    setGapFocus(null);
    if (controllerRef.current?.state.record && next !== "navigation")
      controllerRef.current.stop();
    const token = ++operation.current;
    if (screen === "searching")
      void clientRef.current?.cancel().catch((e) => {
        if (token === operation.current)
          setError(
            "Routing could not restart after cancellation. " + errorText(e),
          );
      });
    setBusy(false);
    setChecking(false);
    setError("");
    setPopup(null);
    setField(null);
    setScreen(next);
  }
  function begin(mode: "point" | "loop") {
    setDraft({ ...emptyDraft(), mode });
    setPreview(null);
    setSelected(null);
    setReverseOf(null);
    setOrigin("planner");
    go("planner");
  }
  function choose(endpoint: Endpoint) {
    if (!field) return;
    cancelLocation();
    setDraft((value) => ({ ...value, [field]: endpoint }));
    setField(null);
    setError("");
  }
  async function chooseMap(point: Point) {
    if (!clientRef.current) return;
    const token = ++operation.current;
    setBusy(true);
    try {
      const resolved = await clientRef.current.call<{
        point: Point;
        label: string;
        receipt: string | null;
      }>({ op: "mapPoint", point, proposed: draft.proposed, now: Date.now() });
      if (token !== operation.current) return;
      setDraft((value) => ({
        ...value,
        [pickField]: { ...resolved.point, label: resolved.label },
      }));
      go("planner");
      if (resolved.receipt) success(resolved.receipt);
    } catch (e) {
      if (token === operation.current) setError(errorText(e));
    } finally {
      if (token === operation.current) setBusy(false);
    }
  }
  function currentLocation(target = field) {
    if (!target) return;
    cancelLocation();
    const token = ++operation.current;
    setField(null);
    setBusy(true);
    setError("");
    cancelLocationRef.current = acquirePlannerLocation(
      {
        secureContext: window.isSecureContext,
        location: navigator.geolocation
          ? browserLocationPort(navigator.geolocation)
          : undefined,
      },
      (event) => {
        if (token !== operation.current) return;
        if (event.phase === "success") {
          setBusy(false);
          setLocationRequest(null);
          setDraft((value) => ({
            ...value,
            [target]: {
              label: "Current location",
              latitude: event.fix.latitude,
              longitude: event.fix.longitude,
            },
          }));
        } else {
          setBusy(event.phase === "waiting");
          setLocationRequest({ target, ...event });
        }
      },
    );
  }
  function makeRecord(
    result: RouteResult,
    source: Draft,
    title?: string,
  ): RouteRecord {
    return {
      key: stableRouteKey({
        kind: result.kind,
        segments: (result.route as { segments: unknown }).segments,
      }),
      title:
        title ??
        (source.mode === "loop"
          ? `${miles(result.distance)} mi loop from ${source.start?.label ?? "start"}`
          : `${source.start?.label ?? "Start"} to ${source.destination?.label ?? "destination"}`),
      createdAt: Date.now(),
      usedAt: Date.now(),
      route: result.route,
      draft: source,
      ...(network?.dataset
        ? {
            dataset: {
              kind: network.dataset.kind,
              id: network.dataset.id,
              version: network.dataset.version,
              contentSha256: network.dataset.contentSha256,
            },
          }
        : {}),
    };
  }
  /** The rider's completed loops, newest first: recently ridden edges cost more, so the next loop is a fresh one. */
  const loopHistory = () => completedRef.current?.read().state ?? [];
  /**
   * An exercise loop was genuinely completed (called synchronously by the navigation controller). The completed ride is
   * ended HERE, before anything is awaited: it belongs to this moment, so a later ride, a reversal or a worker restart
   * can never be stopped by it. Only the recording of the history happens afterwards, and it touches no live state: it
   * uses the worker captured now and the carried ride captured now, and ends in a notice.
   */
  function loopFinished(record: RouteRecord) {
    const client = clientRef.current;
    const carried = carriedRef.current;
    controllerRef.current?.stop();
    snapshotState.current = undefined;
    carriedRef.current = null;
    carriedStoreRef.current?.clear();
    go("preview");
    void recordCompletion(client, record, carried);
  }
  async function recordCompletion(
    client: RoutingClient | null,
    record: RouteRecord,
    carried: { distanceMeters: number; traversalEdges: unknown[] } | null,
  ) {
    let message = "Exercise route complete.";
    try {
      if (!client) throw new Error("routing unavailable");
      const made = await client.call<{ session: unknown }>({
        op: "completedSession",
        route: record.route,
        completedAt: Date.now(),
        ...(carried ? { carried } : {}),
      });
      if (made.session) {
        const saved = completedRef.current?.record(made.session);
        if (saved && !saved.ok)
          message =
            "Exercise route complete, but its history could not be saved.";
      }
    } catch {
      message = "Exercise route complete, but its history could not be saved.";
    }
    setToast({ message });
  }
  finishLoopRef.current = loopFinished;
  async function plan() {
    if (!clientRef.current || !draft.start) return;
    const token = ++operation.current;
    setError("");
    setRetryPlan(false);
    setBusy(true);
    setScreen("searching");
    try {
      const result = routeOkay(
        await clientRef.current.call<RouteResult>({
          op: "plan",
          start: draft.start,
          destination: draft.mode === "point" ? draft.destination : undefined,
          miles: draft.mode === "loop" ? draft.miles : undefined,
          proposed: draft.proposed,
          ...(draft.mode === "loop"
            ? { completedSessions: loopHistory() }
            : {}),
          now: Date.now(),
        }),
      );
      if (token !== operation.current) return;
      const record = makeRecord(result, draft);
      setPreview(result);
      setReverseOf(null);
      setSelected(record);
      setOrigin("planner");
      setScreen("preview");
      applyStore(storeRef.current!.recordSuccess(record));
    } catch (e) {
      if (token === operation.current) {
        setError(errorText(e));
        setRetryPlan(retryable(e));
        setScreen("planner");
      }
    } finally {
      if (token === operation.current) setBusy(false);
    }
  }
  async function openRoute(record: RouteRecord, from: "plan" | "saved") {
    if (!clientRef.current) return;
    setGapFocus(null);
    const token = ++operation.current;
    setReverseOf(null);
    setSelected(record);
    setPreview(null);
    setDraft(record.draft as Draft);
    setOrigin(from);
    setScreen("preview");
    setChecking(true);
    setError("");
    applyStore(storeRef.current!.open(record.key));
    try {
      const result = routeOkay(
        await clientRef.current.call<RouteResult>({
          op: "inspect",
          route: record.route,
          now: Date.now(),
        }),
      );
      if (token === operation.current) setPreview(result);
    } catch (e) {
      if (token === operation.current) setError(errorText(e));
    } finally {
      if (token === operation.current) setChecking(false);
    }
  }
  async function startNavigation() {
    if (!selected || !clientRef.current || !online) return;
    const token = ++operation.current;
    setChecking(true);
    setError("");
    try {
      const inspected = routeOkay(
        await clientRef.current.call<RouteResult>({
          op: "inspect",
          route: selected.route,
          now: Date.now(),
        }),
      );
      if (token !== operation.current) return;
      setPreview(inspected);
      if (!inspected.canNavigate) {
        setError(
          routeNeedsRecalculation(inspected)
            ? `${staleRouteMessage(inspected)} Recalculate before navigating.`
            : "Review the closure or access warning and recalculate before navigating.",
        );
        return;
      }
      snapshotState.current = undefined;
      carriedRef.current = null;
      carriedStoreRef.current?.clear();
      controllerRef.current?.start(selected);
      setScreen("navigation");
    } catch (e) {
      if (token === operation.current) setError(errorText(e));
    } finally {
      if (token === operation.current) setChecking(false);
    }
  }
  function stopNavigation() {
    controllerRef.current?.stop();
    snapshotState.current = undefined;
    carriedRef.current = null;
    carriedStoreRef.current?.clear();
    go("preview");
  }
  async function recalculate() {
    if (!selected || !clientRef.current) return;
    setGapFocus(null);
    const token = ++operation.current;
    setChecking(true);
    setError("");
    const client = clientRef.current;
    // The route being recalculated, and the SAVED route it stands for: recalculating a temporary result again still
    // leaves the original untouched, so the original is what a later save is measured against.
    const before = selected;
    const planned = reverseOf ?? selected;
    const original = planned.recalculatedFrom ?? {
      key: planned.key,
      title: planned.title,
    };
    try {
      const result = routeOkay(
        await client.call<RouteResult>({
          op: "recalculate",
          route: before.route,
          ...((before.route as { kind?: string }).kind === "ExerciseLoop"
            ? { completedSessions: loopHistory() }
            : {}),
          now: Date.now(),
        }),
      );
      if (token !== operation.current) return;
      // The result is a TEMPORARY route with a freshly minted identity. Nothing is written to the library here: not the
      // original (it is kept exactly as it was), not Recent, and not the result. Only an explicit Save makes a record.
      const made = makeRecord(result, draft, recalculatedTitle(original.title));
      const candidate: RouteRecord = {
        ...made,
        key: mintedKey(made.key),
        geometryKey: made.key,
        temporary: true,
        recalculatedFrom: original,
      };
      setPreview(result);
      setReverseOf(null);
      setSelected(candidate);
      success(
        result.canNavigate
          ? "Recalculated route ready. It is not saved, and your saved route is unchanged."
          : "A recalculated route was found but it cannot be started yet. Your saved route is unchanged.",
      );
    } catch (e) {
      if (token !== operation.current) return;
      setError(`${errorText(e)} Your saved route is unchanged.`);
      // The route on screen is what Start would use, so its eligibility is checked again now rather than left as it was.
      try {
        const current = routeOkay(
          await client.call<RouteResult>({
            op: "inspect",
            route: before.route,
            now: Date.now(),
          }),
        );
        if (token === operation.current) setPreview(current);
      } catch {
        if (token === operation.current) setPreview(null);
      }
    } finally {
      if (token === operation.current) setChecking(false);
    }
  }
  async function reroute(mode: "rejoin" | "return" | "destination") {
    const controller = controllerRef.current;
    // One captured snapshot supplies both the worker payload and the later applicability check.
    const request = controller?.rerouteRequest();
    const client = clientRef.current;
    if (!controller || !request || !client) return;
    const token = ++operation.current;
    setBusy(true);
    setError("");
    try {
      const result = routeOkay(
        await client.call<RouteResult>({
          op: "reroute",
          route: request.record.route,
          point: {
            latitude: request.fix.latitude,
            longitude: request.fix.longitude,
          },
          // As in native, a rejoin is measured from how far the rider has credibly RIDDEN, not from where an off-route
          // position happens to project onto the loop.
          progress: request.riddenMeters,
          mode,
          now: Date.now(),
        }),
      );
      if (token !== operation.current) return;
      // Everything that needs the worker is finished BEFORE the ownership check below, so that once the ride is known to
      // be the same ride, adopting the replacement is one synchronous step that cannot be overtaken.
      let carried: {
        distanceMeters: number;
        traversalEdges: unknown[];
      } | null = null;
      if (mode === "rejoin") {
        // What was ridden of the loop before leaving it counts toward the finished workout, as in native.
        const made = await client.call<{
          carried: { distanceMeters: number; traversalEdges: unknown[] };
        }>({
          op: "carryRide",
          route: request.record.route,
          progress: request.riddenMeters,
          ...(carriedRef.current ? { carried: carriedRef.current } : {}),
          now: Date.now(),
        });
        carried = made.carried;
        if (token !== operation.current) return;
      }
      // A newer fix may have queued behind this reroute: wait for it so the current position is known.
      const settled = await controller.whenEvaluationsSettled();
      if (token !== operation.current) return;
      // Guidance may have been discarded or the rider may have moved while the worker computed.
      if (!settled || controller.rerouteStaleReason(request)) {
        setError(
          "Your position changed while the new route was being found, so your current route was kept. Choose a reroute again if you still need one.",
        );
        return;
      }
      if (!result.canNavigate)
        throw new Error(
          result.warnings.join(" ") ||
            "This reroute cannot be navigated safely.",
        );
      // From here to the end of the try block nothing is awaited.
      const record = makeRecord(
        result,
        request.record.draft as Draft,
        mode === "return" ? "Returning to start" : request.record.title,
      );
      setPreview(result);
      setReverseOf(null);
      setSelected(record);
      snapshotState.current = undefined;
      if (carried) {
        carriedRef.current = carried;
        carriedStoreRef.current?.write({ recordKey: record.key, carried });
      }
      controller.replaceRoute(record);
      applyStore(storeRef.current!.recordSuccess(record));
      // What changed, in native's words.
      const meters = (value: number) => `${miles(value)} mi`;
      success(
        mode === "destination"
          ? `Route updated from here: ${meters(result.distance)} to your destination.`
          : mode === "rejoin"
            ? `Rejoining the loop ahead: ${meters(result.distance)} to the finish (${meters(
                Math.max(
                  0,
                  ((request.record.route as { totalDistanceMeters?: number })
                    .totalDistanceMeters ?? 0) - request.riddenMeters,
                ),
              )} remained on the planned loop).`
            : `Heading back to the start: ${meters(result.distance)}.`,
      );
    } catch (e) {
      // As in native, a search that finds nothing says so from where the rider is.
      const text = errorText(e);
      if (token === operation.current)
        setError(
          /^No safe route/.test(text)
            ? /closure/i.test(text)
              ? "No safe route from here. Review the official detour guidance."
              : "No safe route from here. Head back toward the route line."
            : text,
        );
    } finally {
      if (token === operation.current) setBusy(false);
    }
  }
  /**
   * Ride this loop the other way, as native does: a fresh description of the reversed route replaces what is shown and
   * what is navigated, an active ride starts over (progress belongs to one direction, so an early turnaround cannot
   * complete the reversed loop), and the planned direction stays the one that is saved.
   */
  async function reverseDirection() {
    if (!selected || !clientRef.current || preview?.kind !== "ExerciseLoop")
      return;
    const token = ++operation.current;
    setBusy(true);
    setError("");
    try {
      const result = routeOkay(
        await clientRef.current.call<RouteResult>({
          op: "reverse",
          route: selected.route,
          now: Date.now(),
        }),
      );
      if (token !== operation.current) return;
      // A reversal inside a ride restarts it, so it needs a fresh yes. A no is not "keep riding the old route": the same
      // closure or data change blocks the loop being ridden, so guidance and credit are dropped (reverseGate.ts).
      const rideActive = !!nav.record;
      const decision = reverseOutcome(result, rideActive);
      if (decision.kind === "stop-ride") {
        applyReverse(decision, rideActive, controllerRef.current, null);
        snapshotState.current = undefined;
        // Show the route as it stands now, so the reasons are in front of the rider, and leave the ride screen.
        const current = routeOkay(
          await clientRef.current.call<RouteResult>({
            op: "inspect",
            route: selected.route,
            now: Date.now(),
          }),
        );
        if (token !== operation.current) return;
        setPreview(current);
        go("preview");
        setError(decision.message);
        return;
      }
      const planned = reverseOf ?? selected;
      const reversing = reverseOf === null;
      const fresh = makeRecord(result, draft, selected.title);
      const record: RouteRecord = reversing
        ? {
            ...fresh,
            plannedKey: planned.key,
            // The reversal is proved against the planned route's GEOMETRY, which is not its key when it has a minted one.
            ...(planned.geometryKey
              ? { plannedGeometryKey: planned.geometryKey }
              : {}),
            ...(planned.temporary ? { temporary: true as const } : {}),
            ...(planned.recalculatedFrom
              ? { recalculatedFrom: planned.recalculatedFrom }
              : {}),
          }
        : planned.geometryKey && planned.geometryKey === fresh.key
          ? // Reversing back is the planned route again, under its own identity, status and original.
            {
              ...fresh,
              key: planned.key,
              geometryKey: planned.geometryKey,
              title: planned.title,
              createdAt: planned.createdAt,
              ...(planned.temporary ? { temporary: true as const } : {}),
              ...(planned.recalculatedFrom
                ? { recalculatedFrom: planned.recalculatedFrom }
                : {}),
            }
          : fresh;
      setPreview(result);
      setSelected(record);
      // Reversing back is the planned direction again.
      setReverseOf(reversing ? planned : null);
      snapshotState.current = undefined;
      carriedRef.current = null;
      carriedStoreRef.current?.clear();
      applyReverse(decision, rideActive, controllerRef.current, record);
    } catch (e) {
      if (token === operation.current) setError(errorText(e));
    } finally {
      if (token === operation.current) setBusy(false);
    }
  }
  /**
   * After a reload the direction comes back from the stored record, but only if it checks out: reversing the restored
   * route afresh must reproduce the planned route's key. Otherwise the route is shown as exactly what it is, a route in
   * its own right, rather than claiming a direction that cannot be shown.
   */
  async function restoreDirection(
    client: RoutingClient,
    record: RouteRecord,
    isCurrent: () => boolean,
  ) {
    if (!record.plannedKey) return;
    // Pending from now until the proof is settled.
    // Readiness belongs to THIS restored record (its key AND the planned identity it claims), never to another record
    // that merely shares its geometry key, such as an ordinary saved copy.
    setPendingDirection({ key: record.key, plannedKey: record.plannedKey });
    proofRunning.current = true;
    try {
      await proveDirection(client, record, isCurrent);
    } finally {
      proofRunning.current = false;
      setProofEnded((count) => count + 1);
      // A proof that ended because the rider LEFT (not because it finished) settled nothing: if the same restored route is
      // still the one retained (browser Back shows it again) its direction stays unresolved, and the proof is run again
      // when it is shown. Any other route clears it.
      const kept = selectedRef.current;
      const retained =
        !isCurrent() &&
        !!kept &&
        kept.key === record.key &&
        kept.plannedKey === record.plannedKey;
      if (!retained)
        setPendingDirection((pending) =>
          pending &&
          pending.key === record.key &&
          pending.plannedKey === record.plannedKey
            ? null
            : pending,
        );
    }
  }
  async function proveDirection(
    client: RoutingClient,
    record: RouteRecord,
    isCurrent: () => boolean,
  ) {
    if (!record.plannedKey) return;
    try {
      const result = routeOkay(
        await client.call<RouteResult>({
          op: "reverse",
          route: record.route,
          now: Date.now(),
        }),
      );
      if (!isCurrent()) return;
      // Built from the restored record, not from live state: it keeps the data identity the route was planned on.
      const {
        plannedKey: _reversed,
        plannedGeometryKey: _geometry,
        ...own
      } = record;
      const geometryKey = stableRouteKey({
        kind: result.kind,
        segments: (result.route as { segments: unknown }).segments,
      });
      // The proof is the planned route's geometry; its identity (a minted key for a recalculated route) is the stored one.
      if (geometryKey === (record.plannedGeometryKey ?? record.plannedKey)) {
        const planned: RouteRecord = {
          ...own,
          key: record.plannedKey,
          route: result.route,
          ...(record.plannedGeometryKey
            ? { geometryKey: record.plannedGeometryKey }
            : {}),
        };
        // A status settled while the proof ran (saved) is not undone by the captured, older record.
        const live = selectedRef.current;
        if (live && live.key === record.key && !live.temporary)
          delete planned.temporary;
        setReverseOf(planned);
        return;
      }
    } catch {
      /* fall through: the direction is not provable */
    }
    if (!isCurrent()) return;
    setSelected((current) =>
      current && current.key === record.key
        ? (({ plannedKey: _dropped, plannedGeometryKey: _unproved, ...rest }) =>
            // Shown as the route it is. A temporary one must not later save under its bare geometry key, which could
            // be the key of a route already saved: it gets an identity of its own, minted once.
            rest.temporary && !rest.geometryKey
              ? { ...rest, key: mintedKey(rest.key), geometryKey: rest.key }
              : rest)(current)
        : current,
    );
  }
  function saveRecord(record: RouteRecord) {
    // Not while the planned direction is still being proved: the route on screen is the reversed record, and saving it
    // would store the reversed geometry key instead of the planned route's identity.
    if (directionPendingRef.current) return;
    const ok = applyStore(
      storeRef.current!.save(record),
      record.temporary
        ? "Saved as a new route. Your earlier saved route is kept."
        : "Saved to Saved routes",
    );
    // Only after the library accepted it is the route no longer temporary (a quota failure leaves it temporary, the
    // original untouched, and no success announced).
    if (ok && record.temporary) {
      const settled = (item: RouteRecord): RouteRecord => {
        const { temporary: _temporary, ...rest } = item;
        return rest;
      };
      setSelected((current) => (current ? settled(current) : current));
      setReverseOf((current) => (current ? settled(current) : current));
    }
  }
  function removeRoute(record: RouteRecord, saved: boolean) {
    const result = saved
      ? storeRef.current!.deleteSaved(record.key)
      : storeRef.current!.removeRecent(record.key);
    applyStore(
      result,
      saved ? "Saved route deleted" : "Removed from recents",
      () =>
        applyStore(
          saved
            ? storeRef.current!.save(record)
            : storeRef.current!.recordSuccess(record),
          "Route restored",
        ),
    );
  }
  function removePlace(place: PlaceRecord) {
    applyStore(storeRef.current!.deletePlace(place.key), "Place deleted", () =>
      applyStore(storeRef.current!.savePlace(place), "Place restored"),
    );
  }
  function rename(item: RouteRecord | PlaceRecord) {
    setRenameTarget(item);
    setRenameValue("title" in item ? item.title : item.label);
    setPopup("rename");
  }
  function finishRename() {
    if (!renameTarget || !renameValue.trim()) return;
    const result =
      "title" in renameTarget
        ? storeRef.current!.rename(renameTarget.key, renameValue)
        : storeRef.current!.savePlace({
            ...renameTarget,
            label: renameValue.trim(),
          });
    if (applyStore(result, "Name updated")) {
      if (selected?.key === renameTarget.key && "title" in renameTarget)
        setSelected({ ...selected, title: renameValue.trim() });
      setPopup(null);
    }
  }
  function saveEndpoint() {
    const endpoint = draft.mode === "loop" ? draft.start : draft.destination;
    if (!endpoint) return;
    applyStore(
      storeRef.current!.savePlace({
        ...endpoint,
        key: stableRouteKey({
          latitude: endpoint.latitude,
          longitude: endpoint.longitude,
        }),
        createdAt: Date.now(),
      }),
      "Place saved",
    );
  }
  async function shareSummary() {
    // This attempt belongs to the dialog session and the request that started it.
    const epoch = dialogEpoch.current,
      attempt = ++shareAttempt.current,
      current = () =>
        epoch === dialogEpoch.current && attempt === shareAttempt.current;
    cancelAnimationFrame(announceFrame.current);
    setDialogNotice(null);
    const summary = privateRouteShare(location.href, preview?.distance);
    try {
      if (canShare) await navigator.share(summary);
      else
        await navigator.clipboard.writeText(summary.text + "\n" + summary.url);
      if (!current()) return;
      if (!canShare) success("Private summary copied");
      setPopup(null);
    } catch (e) {
      if (!current()) return;
      // Cancelling the system share sheet is the rider's choice, not a failure.
      if (!(e instanceof DOMException && e.name === "AbortError"))
        announce(
          {
            kind: "error",
            message:
              "Sharing is unavailable. Select and copy the summary shown here, then try again if you like.",
          },
          epoch,
        );
    }
  }
  /**
   * A picture of the route, drawn on this device with no map tiles (see shareImage.ts). It follows the same endpoint rule as
   * the file export: unless the rider approves it, the route within about 300 m of the start and finish is left out and
   * the ends are not marked. Shared with the system share sheet when it can take a file, otherwise downloaded.
   */
  const canShareImage = () => {
    try {
      return (
        typeof navigator.canShare === "function" &&
        navigator.canShare({
          files: [new File([""], "route.png", { type: "image/png" })],
        })
      );
    } catch {
      return false;
    }
  };
  async function shareImage() {
    if (!selected || !preview) return;
    // This attempt belongs to the dialog session, the route and the request that started it; anything that finishes after
    // any of them has moved on is refused before it can download, share or speak.
    const epoch = dialogEpoch.current,
      attempt = ++imageAttempt.current,
      route = preview.route,
      title = selected.title,
      exact = exactExport,
      bound = cuesState && cuesState.route === route ? cuesState.data : null,
      current = () =>
        epoch === dialogEpoch.current &&
        attempt === imageAttempt.current &&
        shownRouteRef.current === route;
    cancelAnimationFrame(announceFrame.current);
    setDialogNotice(null);
    if (routeNeedsRecalculation(preview)) {
      announce(
        {
          kind: "error",
          message: `${staleRouteMessage(preview)} It cannot be shown as verified trail: recalculate it first.`,
        },
        epoch,
      );
      return;
    }
    try {
      if (!bound)
        throw new Error(
          "The route's direction cues are not ready yet. Try again in a moment.",
        );
      const blob = await renderImage({
        title,
        summary: preview.summary ?? "",
        warnings: preview.warnings,
        attribution: exportAttribution(),
        pieces: bound.pieces,
        turnarounds: bound.turnarounds,
        context: (network?.features ?? [])
          .filter(
            (feature) => feature.status !== "Proposed" || !!preview.proposed,
          )
          .flatMap((feature) => feature.paths),
        exact,
      });
      if (!current()) return;
      const file = new File([blob], "trail-mapper-route.png", {
        type: "image/png",
      });
      if (canShareImage()) {
        try {
          await navigator.share({
            files: [file],
            title: "Trail Mapper route",
            text: "A ride planned with Trail Mapper.",
          });
          if (current())
            announce(
              { kind: "success", message: "Route image shared." },
              epoch,
            );
        } catch (e) {
          // Closing the share sheet is a choice, not a failure.
          if ((e as { name?: string }).name !== "AbortError") throw e;
        }
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "trail-mapper-route.png";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      announce(
        {
          kind: "success",
          message: exact
            ? "Route image downloaded with your endpoint approval."
            : "Route image downloaded with endpoint areas removed.",
        },
        epoch,
      );
    } catch (e) {
      if (current()) announce({ kind: "error", message: errorText(e) }, epoch);
    }
  }
  /** The credit for what the route was actually drawn from: the county data, and every separately included part of it. */
  function exportAttribution(): string {
    if (network?.mode === "fixture")
      return "Synthetic review geometry created for Trail Mapper, CC0. Not real infrastructure. Map attribution: OpenStreetMap contributors.";
    const record = network?.datasetRecord;
    if (!record)
      return "Trail data: McLean County GIS Consortium (McGIS) and members. Access roads: U.S. Census Bureau. Supplemental/access data © OpenStreetMap contributors (https://www.openstreetmap.org/copyright), ODbL. Generated route; not an official county map.";
    const parts = [
      `${record.source.attribution} Changes: ${record.source.changes}`,
    ];
    for (const part of record.supplements ?? [])
      parts.push(
        `Reviewed OpenStreetMap paths (${part.featureCount}, kept as their own layer): ${part.attribution}. License: ${part.license} (${part.licenseUrl}).`,
      );
    if (record.access)
      parts.push(
        record.access.index.localFeatureCount > 0
          ? "Road access: U.S. Census Bureau TIGER/Line roads and © OpenStreetMap contributors service roads (ODbL, https://www.openstreetmap.org/copyright), used only to route access to trails."
          : "Road access: U.S. Census Bureau TIGER/Line roads, used only to route access to trails.",
      );
    if (record.proposedLayer)
      parts.push(
        `Proposed trails (preview only, not built): ${record.proposedLayer.attribution}. License: ${record.proposedLayer.license} (${record.proposedLayer.licenseUrl}).`,
      );
    parts.push("Generated route; not an official county map.");
    return parts.join(" ");
  }
  function downloadGeoJson() {
    if (!selected || !preview) return;
    // Its lines would be exported as verified existing trail, but the loaded data no longer confirms them.
    if (routeNeedsRecalculation(preview)) {
      announce({
        kind: "error",
        message: `${staleRouteMessage(preview)} It cannot be exported as verified trail: recalculate it first.`,
      });
      return;
    }
    try {
      const coordinates = preview.segments.flatMap((s) =>
        s.points.map((p) => [p.longitude, p.latitude] as Coordinate),
      );
      let offset = 0;
      const segmentBreaks = preview.segments
        .slice(0, -1)
        .map((s) => {
          offset += s.points.length;
          return offset;
        })
        .filter((index) => index > 0 && index < coordinates.length);
      const point = (p: { longitude: number; latitude: number }) =>
        [p.longitude, p.latitude] as Coordinate;
      const geojson = routeGeoJson(selected, coordinates, {
        segmentBreaks,
        segments: preview.segments.map((segment) => ({
          type: segment.type,
          roles: [...(segment.routeRoles ?? segment.roles ?? [])],
        })),
        context: {
          kind: preview.kind,
          dataset: {
            label: network?.label ?? "Unknown dataset",
            mode: network?.mode ?? "unknown",
            // What the route was planned on and what it was checked against are different facts once data changes.
            ...(selected.dataset ? { plannedOn: selected.dataset } : {}),
            ...(preview.network ? { routeCheck: preview.network.status } : {}),
            ...(network?.datasetRecord
              ? {
                  id: network.datasetRecord.id,
                  version: network.datasetRecord.version,
                  contentSha256: network.datasetRecord.content.sha256,
                  license: network.datasetRecord.source.license,
                  licenseUrl: network.datasetRecord.source.licenseUrl,
                  changes: network.datasetRecord.source.changes,
                  reviewedOn: network.datasetRecord.source.reviewedOn,
                  extractedAtUtc: network.datasetRecord.source.extractedAtUtc,
                  approved: network.datasetRecord.approval.approved,
                }
              : {}),
          },
          exportedAt: new Date().toISOString(),
          proposedRoute: !!preview.proposed,
          statusCheckedAt:
            typeof preview.evaluatedAt === "number"
              ? new Date(preview.evaluatedAt).toISOString()
              : null,
          warnings: preview.warnings,
          closures: preview.closures.map((closure) => ({
            title: closure.title,
            message: closure.message,
            sourceUrl: closure.sourceUrl,
          })),
          gaps: (preview.accessGaps ?? []).map((gap) => ({
            id: gap.id,
            distanceMeters: gap.distanceMeters,
            from: point(gap.from),
            to: point(gap.to),
          })),
        },
        action: "download",
        includeExactEndpoints: exactExport,
        fullRouteApproved: exactExport,
        attribution: exportAttribution(),
      });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(geojson, null, 2)], {
          type: "application/geo+json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "trail-mapper-route.geojson";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      announce({
        kind: "success",
        message: exactExport
          ? "Full route downloaded with your endpoint approval."
          : "Route downloaded with endpoint areas removed.",
      });
    } catch (e) {
      announce({ kind: "error", message: errorText(e) });
    }
  }
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const heading = panelRef.current?.querySelector<HTMLElement>("h1");
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [screen, network]);
  const directionPending =
    !!selected &&
    pendingDirection !== null &&
    pendingDirection.key === selected.key &&
    pendingDirection.plannedKey === selected.plannedKey;
  directionPendingRef.current = directionPending;
  selectedRef.current = selected;
  // Shown again with its direction still unresolved (the first proof was cancelled by leaving): prove it afresh, under this
  // showing's own operation, so the abandoned answer is never adopted.
  useEffect(() => {
    const client = clientRef.current;
    if (
      screen !== "preview" ||
      !directionPending ||
      checking ||
      proofRunning.current ||
      !client ||
      !selected
    )
      return;
    const token = ++operation.current;
    void restoreDirection(client, selected, () => token === operation.current);
  }, [screen, directionPending, selected, checking, proofEnded]);
  // The route on screen is no longer the unresolved restored record (another record was opened): its readiness is not
  // inherited, and an answer that arrives later cannot reapply it. While a proof is still running its own end clears it.
  useEffect(() => {
    if (pendingDirection && !directionPending && !proofRunning.current)
      setPendingDirection(null);
  }, [pendingDirection, directionPending, proofEnded]);
  const isSaved =
      !!selected &&
      !directionPending &&
      library.saved.some((item) => item.key === (reverseOf ?? selected).key),
    isPlanner = draft.mode === "loop",
    validMiles =
      Number.isFinite(draft.miles) && draft.miles >= 0.5 && draft.miles <= 100;
  const canPlan =
    !!network &&
    !!draft.start &&
    (isPlanner ? validMiles : !!draft.destination) &&
    !busy;
  const topScreen = ["plan", "saved", "explore", "updates"].includes(screen),
    showRoute = ["preview", "navigation", "searching"].includes(screen)
      ? preview
      : null;
  // The map cues (chevrons, second pass, turn-around signs) come from the shared core for the route being shown. They are an
  // enhancement: if they cannot be had, the route is drawn as a plain line.
  // A result belongs to the route it was computed for. It is used only while that route is the one being shown, so a
  // held answer for an earlier route (a switch, a reversal, a failure, a restart) can never be drawn or exported
  // under a different route's title and checks.
  const [cuesState, setCuesState] = useState<{
    route: unknown;
    data: MapCues;
  } | null>(null);
  const shownRoute = showRoute?.route;
  shownRouteRef.current = shownRoute;
  const cues =
    cuesState && shownRoute !== undefined && cuesState.route === shownRoute
      ? cuesState.data
      : null;
  useEffect(() => {
    const client = clientRef.current;
    setCuesState(null);
    if (!client || !shownRoute) return;
    let current = true;
    client
      .call<MapCues>({ op: "mapCues", route: shownRoute })
      .then((made) => {
        if (current)
          setCuesState({
            route: shownRoute,
            data: { pieces: made.pieces, turnarounds: made.turnarounds },
          });
      })
      .catch(() => {
        if (current) setCuesState(null);
      });
    return () => {
      current = false;
    };
  }, [shownRoute]);
  const back = () => {
    if (screen === "navigation") {
      stopNavigation();
      return;
    }
    // Leaving the map picker (search or picker) returns to the planner with its draft untouched.
    if (screen === "searching" || screen === "map-picker") {
      go("planner");
      return;
    }
    if (screen === "preview") {
      go(origin);
      return;
    }
    go("plan");
  };
  // Only the synthetic network offers review places and a fixed map view; before load, the build decides.
  const fixtureData = network
      ? network.mode === "fixture"
      : __TRAIL_DATASET__ === "fixture" && !local,
    stale = preview ? routeNeedsRecalculation(preview) : false,
    olderData =
      !!selected?.dataset &&
      !!network?.dataset &&
      selected.dataset.contentSha256 !== network.dataset.contentSha256;
  const shownRecent = library.recent.slice(0, 3),
    share = privateRouteShare(location.href, preview?.distance);
  return (
    <div className={"app " + screen}>
      <a
        className="skip-link"
        href="#route-controls"
        onClick={(event) => {
          // A fragment jump would add an entry the history model does not manage: move focus instead.
          event.preventDefault();
          panelRef.current?.focus();
        }}
      >
        Skip to route controls
      </a>
      <header className="app-header">
        <button
          className="brand"
          onClick={() => go("plan")}
          aria-label="Trail Mapper home"
        >
          <span aria-hidden="true">↗</span>
          <span>
            Trail Mapper<small>Bloomington–Normal</small>
          </span>
        </button>
        <div className="header-actions">
          <button
            className="help-button"
            aria-haspopup="dialog"
            onClick={() => setPopup("help")}
          >
            Help
            <span className="visually-hidden"> and about</span>
          </button>
          <span className="local-badge">On this browser · no account</span>
        </div>
      </header>
      <div className="review-banner" role="status">
        {network?.mode === "county"
          ? network.datasetRecord?.approval.approved
            ? "Existing reviewed trails only · check posted signs and closures before you ride."
            : "Review candidate · county trail data that is not approved for public release."
          : network?.mode === "local"
            ? "Local data review · current closures and access still need your attention."
            : local
              ? "Loading local trail data…"
              : __TRAIL_DATASET__ === "county"
                ? "Loading trail data…"
                : "Synthetic review network — do not ride these paths."}
      </div>
      {!online && (
        <div className="offline-banner" role="status">
          Offline. Street maps are unavailable. This browser app does not
          provide offline navigation.
        </div>
      )}
      <main className="workspace">
        <MapView
          features={network?.features ?? []}
          route={showRoute}
          gapFocus={gapFocus}
          proposed={draft.proposed}
          picking={screen === "map-picker"}
          onPick={chooseMap}
          position={nav.fix ?? undefined}
          closures={
            screen === "explore" && !showClosures
              ? []
              : (network?.closures ?? [])
          }
          fitSignal={fitSignal}
          cues={cues}
          riddenMeters={screen === "navigation" ? nav.riddenMeters : undefined}
          fixture={fixtureData}
          county={network?.mode === "county"}
          osm={
            Boolean(network?.datasetRecord?.supplements?.length) ||
            (network?.datasetRecord?.access?.index.localFeatureCount ?? 0) > 0
          }
        />
        <section
          className="panel"
          aria-label="Route controls"
          id="route-controls"
          tabIndex={-1}
          ref={panelRef}
        >
          {!topScreen && (
            <button className="back" onClick={back}>
              ←{" "}
              {screen === "navigation"
                ? "Stop navigation"
                : screen === "searching"
                  ? "Cancel search"
                  : screen === "map-picker"
                    ? "Cancel map selection"
                    : "Back"}
            </button>
          )}
          {!network && !bootError && (
            <div role="status" className="loading">
              <h1>Loading trails…</h1>
              <p>Preparing route planning and current trail notices.</p>
            </div>
          )}
          {bootError && (
            <div className="error" role="alert">
              <h1>Trails could not load</h1>
              <p>{bootError}</p>
              <p className="caption">
                Your saved routes and places are still on this device. Nothing
                else is shown in place of the trail data.
              </p>
              <button onClick={() => setBootAttempt((value) => value + 1)}>
                Retry loading
              </button>
              {local && (
                <a href={location.pathname}>Use synthetic review network</a>
              )}
            </div>
          )}
          {routingDown && network && (
            <div className="error" role="alert">
              <p>{ROUTING_UNAVAILABLE_MESSAGE}</p>
              <button onClick={() => void restartRouting()}>
                Restart route planning
              </button>
            </div>
          )}
          {error && !(routingDown && error === ROUTING_UNAVAILABLE_MESSAGE) && (
            <div className="error" role="alert">
              <p>{error}</p>
              {retryPlan && screen === "planner" && canPlan && !busy && (
                <button className="primary" onClick={() => void plan()}>
                  Try again
                </button>
              )}
              <button
                onClick={() => {
                  setError("");
                  setRetryPlan(false);
                }}
              >
                Dismiss
              </button>
            </div>
          )}
          {locationRequest && (
            <div
              className={
                locationRequest.phase === "failure" ? "error" : "warning"
              }
              role={locationRequest.phase === "failure" ? "alert" : "status"}
            >
              <p>{locationRequest.message}</p>
              <div className="actions">
                {locationRequest.phase === "failure" ? (
                  <button
                    onClick={() => currentLocation(locationRequest.target)}
                  >
                    Try location again
                  </button>
                ) : (
                  <button onClick={cancelLocation}>
                    Cancel location request
                  </button>
                )}
                <button onClick={() => openPlace(locationRequest.target)}>
                  Choose a place
                </button>
                <button
                  onClick={() => {
                    setPickField(locationRequest.target);
                    go("map-picker");
                  }}
                >
                  Pick on map
                </button>
              </div>
            </div>
          )}
          {storageError && (
            <div className="warning" role="alert">
              {storageError}
            </div>
          )}
          {unreadableSaved && (
            <div className="warning" role="status">
              {unreadableSaved === "pending"
                ? "Some saved items in this browser could not be read and there is no room to set them aside. Your other routes and places are unaffected."
                : "Some saved items in this browser could not be read and were set aside. Your other routes and places are unaffected."}{" "}
              <button
                onClick={() => {
                  const ok = applyStore(
                    storeRef.current!.discardUnreadable(),
                    "Unreadable data deleted",
                  );
                  // The button disappears; keep keyboard and screen-reader focus in the panel.
                  if (ok) panelRef.current?.focus();
                }}
              >
                Delete unreadable data
              </button>
            </div>
          )}
          {nav.storageError && (
            <div className="warning" role="alert">
              Your ride could not be saved for recovery. Keep this page open.
            </div>
          )}
          {network && screen === "plan" && (
            <>
              <p className="eyebrow">Your next ride</p>
              <h1>Plan a ride</h1>
              <p className="lead">Find a way there, or make time for a loop.</p>
              <div className="plan-choices">
                <button
                  className="route-choice primary"
                  onClick={() => begin("point")}
                >
                  <span aria-hidden="true">↗</span>
                  <strong>Go somewhere</strong>
                  <small>Choose a start and destination</small>
                </button>
                <button className="route-choice" onClick={() => begin("loop")}>
                  <span aria-hidden="true">↻</span>
                  <strong>Make an exercise loop</strong>
                  <small>A ride that returns to your start</small>
                </button>
              </div>
              {shownRecent.length > 0 && (
                <section className="recent-section">
                  <div className="section-heading">
                    <h2>Recent</h2>
                    <button
                      onClick={() => {
                        setSavedTab("recent");
                        go("saved");
                      }}
                    >
                      See all
                    </button>
                  </div>
                  <ul className="route-list">
                    {shownRecent.map((record) => (
                      <RouteRow
                        key={record.key}
                        record={record}
                        onOpen={() => void openRoute(record, "plan")}
                      />
                    ))}
                  </ul>
                </section>
              )}
              <p className="caption">
                Saved routes and places stay in this browser. No sign-in or
                cloud sync.
              </p>
              <Legend />
            </>
          )}
          {network && screen === "planner" && (
            <>
              <p className="eyebrow">Plan your ride</p>
              <h1>{isPlanner ? "Make an exercise loop" : "Go somewhere"}</h1>
              <EndpointField
                label="Start"
                value={draft.start}
                onClick={() => openPlace("start")}
              />
              {!isPlanner && (
                <>
                  <button
                    className="swap"
                    aria-label="Swap start and destination"
                    onClick={() => {
                      cancelLocation();
                      setDraft({
                        ...draft,
                        start: draft.destination,
                        destination: draft.start,
                      });
                    }}
                  >
                    ⇅ Swap
                  </button>
                  <EndpointField
                    label="Destination"
                    value={draft.destination}
                    onClick={() => openPlace("destination")}
                  />
                </>
              )}
              {isPlanner && (
                <fieldset>
                  <legend>Target distance</legend>
                  <div className="distance-presets">
                    {[3, 5, 8, 10].map((value) => (
                      <button
                        key={value}
                        aria-pressed={draft.miles === value}
                        onClick={() => setDraft({ ...draft, miles: value })}
                      >
                        {value} mi
                      </button>
                    ))}
                  </div>
                  <label className="field">
                    Custom miles
                    <input
                      type="number"
                      min="0.5"
                      max="100"
                      step="0.1"
                      value={Number.isNaN(draft.miles) ? "" : draft.miles}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          miles:
                            e.target.value === ""
                              ? NaN
                              : Number(e.target.value),
                        })
                      }
                      aria-invalid={!validMiles}
                      aria-describedby="distance-help"
                    />
                  </label>
                  <p
                    id="distance-help"
                    className={validMiles ? "caption" : "error"}
                  >
                    Choose 0.5–100 miles. The route may vary from your target.
                  </p>
                </fieldset>
              )}
              <ProposedChoice
                network={network}
                checked={draft.proposed}
                onChange={(proposed) => setDraft({ ...draft, proposed })}
                label="Include proposed trails"
                description="Opt in to planned paths that may not be built or usable."
              />
              <button
                className="primary wide"
                disabled={!canPlan}
                onClick={() => void plan()}
              >
                {isPlanner ? "Make loop" : "Find route"}
              </button>
              <p className="caption">
                Select a resolved start{!isPlanner ? " and destination" : ""}.
                Unmapped access will be identified before navigation.
              </p>
            </>
          )}
          {screen === "map-picker" && (
            <>
              <h1>Choose {pickField} on the map</h1>
              <p>
                Tap the trail where you want to{" "}
                {pickField === "start" ? "start" : "finish"}, or move the map
                and use its center.
              </p>
              <button onClick={() => go("planner")}>
                Cancel map selection
              </button>
              <Legend />
            </>
          )}
          {screen === "searching" && (
            <div className="search-progress" role="status">
              <span className="spinner" aria-hidden="true" />
              <h1>{isPlanner ? "Making your loop…" : "Finding a route…"}</h1>
              <p>Checking trails, street access and current closures.</p>
              <button onClick={() => go("planner")}>Cancel</button>
            </div>
          )}{" "}
          {screen === "preview" && (
            <>
              <p className="eyebrow">Ready when you are</p>
              <h1>Route preview</h1>
              {selected && <h2>{selected.title}</h2>}
              {checking && (
                <p className="checking" role="status">
                  Checking the known closure catalog…
                </p>
              )}
              {preview && (
                <>
                  <div className="route-stats">
                    <div>
                      <strong>{miles(preview.distance)}</strong>
                      <span>miles</span>
                    </div>
                    <div>
                      <strong>
                        {Math.max(
                          1,
                          Math.round((preview.distance / 1609.344 / 10) * 60),
                        )}
                      </strong>
                      <span>min at 10 mph · estimate</span>
                    </div>
                  </div>
                  <p className="route-details">
                    {miles(preview.accessDistance)} mi street access ·{" "}
                    {miles(preview.sharedDistance)} mi shared roadway
                    {typeof preview.retracedDistance === "number"
                      ? ` · ${miles(preview.retracedDistance)} mi retraced`
                      : null}
                  </p>
                  {preview.kind === "ExerciseLoop" && (
                    <>
                      <p>
                        <strong>{loopHeading(preview.targetMatched)}</strong>
                      </p>
                      {typeof preview.requestedDistance === "number" && (
                        <p className="route-details">
                          {loopComparison(
                            preview.requestedDistance,
                            preview.distance,
                          )}
                        </p>
                      )}
                    </>
                  )}
                  {preview.summary && <p>{preview.summary}</p>}
                  {cues &&
                    (cues.turnarounds.length > 0 ||
                      cues.pieces.some(
                        (piece) => piece.repeatsEarlierTravel,
                      )) && (
                      <p className="caption">
                        Chevrons show direction. Double chevrons: second pass,
                        drawn beside the first. Turn-around signs mark where the
                        route turns back.
                      </p>
                    )}
                  <AccessConnections
                    gaps={preview.accessGaps ?? []}
                    onShow={(id) => setGapFocus({ id })}
                  />
                  {stale && (
                    <div className="error stale-route" role="alert">
                      <h3>This route needs recalculating</h3>
                      <p>{staleRouteMessage(preview)}</p>
                      <p>
                        Your saved route is kept as it was. Navigation is off
                        until you recalculate it on the current data or choose
                        another route.
                      </p>
                      <button
                        className="primary"
                        disabled={checking}
                        onClick={() => void recalculate()}
                      >
                        Recalculate on current data
                      </button>
                    </div>
                  )}
                  {selected?.temporary && (
                    <div
                      className={
                        preview.canNavigate
                          ? "success-note recalculated-route"
                          : "warning recalculated-route"
                      }
                      role="status"
                    >
                      <h3>Recalculated route · not saved</h3>
                      <p>
                        This is a temporary preview
                        {selected.recalculatedFrom
                          ? ` recalculated from “${selected.recalculatedFrom.title}”`
                          : ""}
                        . Your saved route is unchanged.{" "}
                        {preview.canNavigate
                          ? "Start it now, or save it as a new route."
                          : "It cannot be started yet (see below), but you can still save it as a new route."}
                      </p>
                    </div>
                  )}
                  {olderData && !stale && (
                    <p className="caption">
                      Planned on an earlier version of the trail data (
                      {selected!.dataset!.version}). It still matches the data
                      loaded now.
                    </p>
                  )}
                  {preview.warnings
                    .filter(
                      (warning) =>
                        !(stale && warning.startsWith("This saved route ")),
                    )
                    .map((warning, index) => (
                      <p className="warning" key={index}>
                        {warning}
                      </p>
                    ))}
                  {preview.closures.length > 0 && (
                    <div className="closure-list">
                      {preview.closures.map((closure) => (
                        <article key={closure.id}>
                          <h3>{closure.title}</h3>
                          <p>{closure.message}</p>
                          {closure.locationDescription && (
                            <p className="caption">
                              {closure.locationDescription}
                            </p>
                          )}
                          <SafeLink href={closure.sourceUrl}>
                            Review official notice
                          </SafeLink>
                        </article>
                      ))}
                    </div>
                  )}
                  {preview.closures.length > 0 && !stale && (
                    <div className="recalculate-offer">
                      <button
                        className="primary"
                        disabled={checking}
                        onClick={() => void recalculate()}
                      >
                        Recalculate around the closure
                      </button>
                      <p className="caption">
                        Your saved route is kept as it is. The recalculated
                        route is a temporary preview you can start or save as a
                        new route.
                      </p>
                    </div>
                  )}
                  {!checking && (
                    <p className="closure-status">
                      {preview.closures.length
                        ? "A reported closure affects this route. Recalculate before navigating."
                        : "Known closure catalog checked on opening; live conditions are unverified. Check posted signs."}
                    </p>
                  )}
                  <Legend />
                  <p className="warning" id="foreground-note">
                    <strong>
                      Keep this page open and visible while you ride.
                    </strong>{" "}
                    Guidance pauses if you switch tabs, lock the screen or leave
                    the page. There is no background tracking or offline
                    navigation.
                  </p>
                  {preview.kind === "ExerciseLoop" && (
                    <DirectionControl
                      reversed={reverseOf !== null}
                      busy={busy || checking || directionPending}
                      onReverse={() => void reverseDirection()}
                    />
                  )}
                  <button
                    className="primary wide"
                    aria-describedby="foreground-note"
                    disabled={checking || !preview.canNavigate || !online}
                    onClick={() => void startNavigation()}
                  >
                    {checking ? "Checking closures…" : "Start navigation"}
                  </button>
                  {!preview.canNavigate && (
                    <p className="caption">
                      {stale
                        ? "Navigation is unavailable until this route is recalculated on the current trail data."
                        : selected?.temporary
                          ? preview.accessGaps?.length
                            ? "This recalculated route cannot be started: its connections listed above are still unverified. Your saved route is unchanged."
                            : "This recalculated route cannot be started: review the notices above. Your saved route is unchanged."
                          : preview.accessGaps?.length
                            ? "Navigation needs a continuously mapped route. The connections listed above are still unverified."
                            : "Navigation is unavailable for this route. Review the notices above before choosing another route."}
                    </p>
                  )}
                  {directionPending && (
                    <p
                      className="caption"
                      id="direction-pending-note"
                      role="status"
                    >
                      Checking which direction this route was planned in. Save
                      and Reverse are available as soon as that is known.
                    </p>
                  )}
                  <div className="actions preview-actions">
                    <button
                      disabled={directionPending}
                      aria-describedby={
                        directionPending ? "direction-pending-note" : undefined
                      }
                      onClick={() => {
                        if (isSaved) {
                          setSavedTab("saved");
                          go("saved");
                        } else if (selected) saveRecord(reverseOf ?? selected);
                      }}
                    >
                      {isSaved
                        ? "Saved · View"
                        : selected?.temporary
                          ? "Save as new route"
                          : "Save"}
                    </button>
                    <button
                      onClick={() => {
                        setExactExport(false);
                        setPopup("share");
                      }}
                    >
                      Share
                    </button>
                    <button
                      onClick={() => {
                        setOrigin("planner");
                        go("planner");
                      }}
                    >
                      Edit
                    </button>
                    <button onClick={() => setPopup("directions")}>
                      Directions
                    </button>
                  </div>
                  <div className="actions">
                    <button
                      disabled={checking}
                      onClick={() => void recalculate()}
                    >
                      Recalculate route
                    </button>
                    <button onClick={saveEndpoint}>
                      Save {draft.mode === "loop" ? "start" : "destination"} as
                      a place
                    </button>
                  </div>
                  <p className="caption">
                    Foreground navigation only. Keep this page visible; changing
                    tabs or locking the screen pauses guidance.
                  </p>
                </>
              )}
              {!preview && !checking && !error && (
                <p>No route is available. Return to the planner to find one.</p>
              )}
            </>
          )}
          {screen === "navigation" && (
            <>
              <p className="eyebrow">Foreground navigation</p>
              <h1>
                {selected?.title === "Returning to start"
                  ? "Returning to start"
                  : "Ride in progress"}
              </h1>
              <p className="caption">
                Keep this page open and visible: guidance pauses if you switch
                tabs or lock the screen.
              </p>
              <div className={"guidance " + nav.phase} aria-live="polite">
                <h2>
                  {nav.phase === "reacquiring"
                    ? "Reacquiring location…"
                    : nav.phase === "off-route"
                      ? "You are off route"
                      : nav.phase === "navigating"
                        ? (nav.guidance?.instruction ??
                          "Checking your position…")
                        : nav.phase === "paused"
                          ? "Navigation paused"
                          : "Waiting for location"}
                </h2>
                {nav.message && <p>{nav.message}</p>}
                {nav.guidance && (
                  <p>
                    <strong>{miles(nav.guidance.remainingMeters)} mi</strong>{" "}
                    remaining
                    {typeof nav.guidance.distanceToNextInstruction === "number"
                      ? ` · ${Math.round(nav.guidance.distanceToNextInstruction)} m to next instruction`
                      : ""}
                  </p>
                )}
              </div>
              <p>
                {miles(nav.creditedDistanceMeters)} mi observed this ride
                {nav.fix
                  ? ` · location accuracy ${Math.round(nav.fix.accuracy)} m`
                  : ""}
              </p>
              {preview?.kind === "ExerciseLoop" && (
                <DirectionControl
                  reversed={reverseOf !== null}
                  busy={busy || directionPending}
                  onReverse={() => void reverseDirection()}
                />
              )}
              {nav.phase === "off-route" && (
                <div className="reroute-actions">
                  <h2>Choose what comes next</h2>
                  {preview?.kind === "ExerciseLoop" ? (
                    <>
                      <button
                        className="primary wide"
                        disabled={busy}
                        onClick={() => void reroute("rejoin")}
                      >
                        Rejoin the loop
                      </button>
                      <button
                        className="wide"
                        disabled={busy}
                        onClick={() => void reroute("return")}
                      >
                        Return to start
                      </button>
                    </>
                  ) : (
                    <button
                      className="primary wide"
                      disabled={busy}
                      onClick={() => void reroute("destination")}
                    >
                      {selected?.title === "Returning to start"
                        ? "Reroute to start"
                        : "Reroute"}
                    </button>
                  )}
                </div>
              )}
              {nav.phase === "permission-denied" && (
                <p>
                  Allow location in your browser settings, then stop and start
                  navigation again. You can still view the route and directions.
                </p>
              )}
              <div className="wake-status" role="status">
                Screen wake lock:{" "}
                {nav.wakeLock === "held"
                  ? "keeping this page awake"
                  : nav.wakeLock === "unsupported"
                    ? "not supported in this browser"
                    : nav.wakeLock === "denied"
                      ? "not allowed — the screen may lock"
                      : nav.wakeLock === "requesting"
                        ? "requesting…"
                        : nav.wakeLock === "released"
                          ? "released by the browser"
                          : "inactive"}
                .
              </div>
              <p className="caption">
                Guidance pauses when the page is hidden or the screen locks.
                Return here for a fresh location. Distance traveled while
                unobserved is not credited.
              </p>
              <button className="wide" onClick={() => setPopup("directions")}>
                View directions
              </button>
              <button className="primary wide" onClick={stopNavigation}>
                Stop navigation
              </button>
            </>
          )}
          {network && screen === "saved" && (
            <>
              <p className="eyebrow">Yours to revisit</p>
              <h1>Saved</h1>
              <div className="tabs" role="tablist" aria-label="Route library">
                <button
                  role="tab"
                  aria-selected={savedTab === "saved"}
                  aria-controls="saved-library"
                  onClick={() => setSavedTab("saved")}
                >
                  Saved · {library.saved.length + library.places.length}
                </button>
                <button
                  role="tab"
                  aria-selected={savedTab === "recent"}
                  aria-controls="saved-library"
                  onClick={() => setSavedTab("recent")}
                >
                  Recent · {library.recent.length}
                </button>
              </div>
              <section
                id="saved-library"
                role="tabpanel"
                aria-label={
                  savedTab === "saved"
                    ? "Saved routes and places"
                    : "Recent routes"
                }
              >
                {savedTab === "saved" ? (
                  <>
                    <p className="caption">
                      Routes and places saved in this browser only. No account
                      or cloud backup.
                    </p>
                    {!library.saved.length && !library.places.length && (
                      <div className="empty-state">
                        <h2>Nothing saved yet</h2>
                        <p>Save a route from its map to keep it here.</p>
                        <button onClick={() => begin("point")}>
                          Plan a ride
                        </button>
                      </div>
                    )}
                    {library.saved.length > 0 && (
                      <>
                        <h2>Saved routes</h2>
                        <ul className="route-list">
                          {library.saved.map((record) => (
                            <RouteRow
                              key={record.key}
                              record={record}
                              onOpen={() => void openRoute(record, "saved")}
                            >
                              <button
                                aria-label={"Rename " + record.title}
                                onClick={() => rename(record)}
                              >
                                Rename
                              </button>
                              <button
                                aria-label={"Delete " + record.title}
                                onClick={() => removeRoute(record, true)}
                              >
                                Delete
                              </button>
                            </RouteRow>
                          ))}
                        </ul>
                      </>
                    )}
                    {library.places.length > 0 && (
                      <>
                        <h2>Saved places</h2>
                        <ul className="route-list">
                          {library.places.map((place) => (
                            <li key={place.key}>
                              <button
                                className="route-row"
                                onClick={() => {
                                  setDraft({
                                    ...emptyDraft(),
                                    destination: place,
                                  });
                                  go("planner");
                                }}
                              >
                                <strong>{place.label}</strong>
                                <span>Plan a route here</span>
                              </button>
                              <div className="row-actions">
                                <button
                                  onClick={() => rename(place)}
                                  aria-label={"Rename " + place.label}
                                >
                                  Rename
                                </button>
                                <button
                                  onClick={() => removePlace(place)}
                                  aria-label={"Delete " + place.label}
                                >
                                  Delete
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <p className="caption">
                      Recent routes stay in this browser. Up to 20 are kept for
                      30 days. They are never synced to an account.
                    </p>
                    {!library.recent.length && (
                      <div className="empty-state">
                        <h2>No recent routes</h2>
                        <p>Routes you plan show up here until you save them.</p>
                      </div>
                    )}
                    <ul className="route-list">
                      {library.recent.map((record) => (
                        <RouteRow
                          key={record.key}
                          record={record}
                          onOpen={() => void openRoute(record, "saved")}
                        >
                          <button
                            aria-label={"Save " + record.title}
                            onClick={() => saveRecord(record)}
                          >
                            Save
                          </button>
                          <button
                            aria-label={
                              "Remove " + record.title + " from recents"
                            }
                            onClick={() => removeRoute(record, false)}
                          >
                            Remove
                          </button>
                        </RouteRow>
                      ))}
                    </ul>
                    <button
                      disabled={!library.recent.length}
                      onClick={() => setPopup("clear")}
                    >
                      Clear recents
                    </button>
                  </>
                )}
              </section>
            </>
          )}
          {network && screen === "explore" && (
            <>
              <p className="eyebrow">Explore the network</p>
              <h1>Trails around you</h1>
              <p>
                See the trails, connectors and shared roadways used by the route
                planner.
              </p>
              <ProposedChoice
                network={network}
                checked={draft.proposed}
                onChange={(proposed) => setDraft({ ...draft, proposed })}
                label="Show proposed trails"
                description="Planned paths may not be built or usable."
              />
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={showClosures}
                  onChange={(e) => setShowClosures(e.target.checked)}
                />
                <span>
                  Reported closure areas
                  <small>
                    Dashed amber lines are approximate work corridors, not exact
                    closure limits. Tap a marker for the official notice.
                  </small>
                </span>
              </label>
              <Legend
                verified={network.features.some((f) =>
                  f.id.startsWith("verified-osm:way:"),
                )}
              />
              <div className="actions">
                <button onClick={() => setFitSignal((n) => n + 1)}>
                  Show all trails
                </button>
                <SafeLink href="https://mcleangis.maps.arcgis.com/apps/instant/sidebar/index.html?appid=d98c151296fd4b03860af8f4df7787a4">
                  County map
                </SafeLink>
              </div>
              <p>
                {network.features.length} mapped trail features in this dataset.
              </p>
              <p className="caption">
                {network.mode === "fixture"
                  ? "This synthetic network exists only to review the browser experience."
                  : "Street basemap tiles are optional and require internet. Trail geometry is supplied by the locally loaded dataset."}
              </p>
              <DataSources network={network} />
              <button className="wide" onClick={() => setPopup("help")}>
                Help, privacy and sources
              </button>
              <button className="primary wide" onClick={() => begin("point")}>
                Plan a ride
              </button>
            </>
          )}
          {network && screen === "updates" && (
            <>
              <p className="eyebrow">Before you ride</p>
              <h1>Trail updates</h1>
              <p className="freshness">{network.freshnessMessage}</p>
              <p className="caption">
                These are the shared app’s published notices, not a live report
                of conditions. Check the official source and signs on the trail.
              </p>
              <section className="offline-status">
                <h2>Browser availability</h2>
                <p>
                  {online ? "Online" : "Offline"} · No offline area downloaded.
                  Offline navigation is not available.
                </p>
                <p className="caption">
                  Browser installation is optional where supported. It does not
                  add offline maps or background location.
                </p>
              </section>
              <DataSources network={network} />
              <button className="wide" onClick={() => setPopup("help")}>
                Help, privacy and sources
              </button>
              <div className="updates-list">
                {network.updates.map((update) => (
                  <article key={update.id}>
                    <p className="update-status">{update.status}</p>
                    <h2>{update.title}</h2>
                    <p>{update.details}</p>
                    <SafeLink href={update.source?.url ?? update.sourceUrl}>
                      {update.source?.title ?? "Read official source"}
                    </SafeLink>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </main>
      {topScreen && (
        <nav className="main-nav" aria-label="Main navigation">
          {(["plan", "saved", "explore", "updates"] as const).map((tab) => (
            <button
              key={tab}
              aria-current={screen === tab ? "page" : undefined}
              onClick={() => go(tab)}
            >
              <span aria-hidden="true">
                {tab === "plan"
                  ? "↗"
                  : tab === "saved"
                    ? "♡"
                    : tab === "explore"
                      ? "◇"
                      : "◉"}
              </span>
              {tab[0].toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
      )}
      {field && (
        <PlaceChooser
          field={field}
          start={field === "destination" ? draft.start : null}
          saved={library.places}
          fixture={fixtureData}
          addressSource={addressIndexSource(
            __TRAIL_ADDRESS_INDEX__,
            fixtureData && ADDRESS_FIXTURE_SEAM,
          )}
          onChoose={choose}
          onMap={() => {
            setPickField(field);
            setField(null);
            go("map-picker");
          }}
          onLocation={() => currentLocation()}
          onClose={() => setField(null)}
        />
      )}
      {popup === "directions" && (
        <Modal title="Directions" onClose={() => setPopup(null)}>
          {preview?.instructions.length ? (
            <ol className="directions">
              {preview.instructions.map((instruction, index) => (
                <li key={index}>
                  <strong>{instruction.text}</strong>
                  <span>{miles(instruction.distance)} mi from start</span>
                </li>
              ))}
            </ol>
          ) : (
            <p>Directions are unavailable until a route is ready.</p>
          )}
        </Modal>
      )}
      {popup === "share" && (
        <Modal
          title="Share route"
          notice={dialogNotice}
          onClose={() => setPopup(null)}
        >
          <h3>Private summary</h3>
          <p>
            Exact start and destination, route coordinates and your recent
            history are excluded.
          </p>
          <div className="share-preview">
            <p>{share.text}</p>
            <p>{share.url}</p>
          </div>
          <button className="primary wide" onClick={() => void shareSummary()}>
            {canShare ? "Share summary" : "Copy summary"}
          </button>
          <hr />
          <h3>Download a route file</h3>
          <p>
            GeoJSON downloads are separate from sharing. The default removes
            areas around your start and destination. The file includes
            attribution.
          </p>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={exactExport}
              onChange={(e) => setExactExport(e.target.checked)}
            />
            <span>
              Include exact start and destination
              <small>
                I understand this file or image will reveal the full route and
                its endpoints, and the image the saved route title.
              </small>
            </span>
          </label>
          <p className="caption">{EXPORT_METADATA_NOTE}</p>
          {typeof preview?.evaluatedAt === "number" && (
            <p className="caption">
              Route warnings and closures were last checked{" "}
              {new Date(preview.evaluatedAt).toLocaleString()}. Reopen the route
              to refresh them before exporting.
            </p>
          )}
          <button className="wide" onClick={downloadGeoJson}>
            {exactExport
              ? "Download full route GeoJSON"
              : "Download private GeoJSON"}
          </button>
          <hr />
          <h3>Route image</h3>
          <p>
            A picture of the route with its direction, notices and data credit,
            drawn on this device. It has no map tiles, and it follows the choice
            above: unless you include exact endpoints, about 300 m around the
            start and finish are left out and the title is a generic one. With
            exact endpoints it shows this route’s saved title.
          </p>
          <button
            className="wide"
            disabled={!cues}
            onClick={() => void shareImage()}
          >
            {canShareImage() ? "Share route image" : "Save route image"}
          </button>
        </Modal>
      )}
      {popup === "help" && (
        <HelpDialog
          network={network}
          build={{
            ...__TRAIL_BUILD__,
            dataset: __TRAIL_DATASET__,
            channel: __TRAIL_CHANNEL__,
          }}
          onClose={() => setPopup(null)}
        />
      )}
      {popup === "clear" && (
        <Modal
          title={`Clear ${library.recent.length} recent routes?`}
          notice={dialogNotice}
          onClose={() => setPopup(null)}
        >
          <p>Saved routes and places are not affected.</p>
          <div className="actions">
            <button onClick={() => setPopup(null)}>Cancel</button>
            <button
              className="danger"
              onClick={() => {
                if (
                  applyStore(
                    storeRef.current!.clearRecents(),
                    "Recents cleared",
                  )
                )
                  setPopup(null);
              }}
            >
              Clear
            </button>
          </div>
        </Modal>
      )}
      {popup === "rename" && (
        <Modal
          title="Rename"
          notice={dialogNotice}
          onClose={() => setPopup(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              finishRename();
            }}
          >
            <label className="field">
              Name
              <input
                autoFocus
                value={renameValue}
                maxLength={120}
                onChange={(event) => setRenameValue(event.target.value)}
              />
            </label>
            <div className="actions">
              <button type="button" onClick={() => setPopup(null)}>
                Cancel
              </button>
              <button
                type="submit"
                className="primary"
                disabled={!renameValue.trim()}
              >
                Save name
              </button>
            </div>
          </form>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.undo && (
            <button
              onClick={() => {
                const undo = toast.undo;
                setToast(null);
                undo?.();
              }}
            >
              Undo
            </button>
          )}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
