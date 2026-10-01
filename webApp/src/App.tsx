import { useEffect, useRef, useState } from "react";
import { RoutingClient, ROUTING_UNAVAILABLE_MESSAGE } from "./core";
import {
  BrowserHistorySync,
  resolvePop,
  type PopContext,
} from "./platform/browserHistory";
import { MapView } from "./MapView";
import { DataSources } from "./DataSources";
import { HelpDialog } from "./Help";
import { AccessConnections } from "./AccessConnections";
import {
  type DialogNotice,
  EndpointField,
  Legend,
  Modal,
  PlaceChooser,
  RouteRow,
  SafeLink,
} from "./components";
import {
  emptyDraft,
  miles,
  routeNeedsRecalculation,
  type Draft,
  type Endpoint,
  type Network,
  type Point,
  type RouteResult,
} from "./types";
import {
  ActiveRideStore,
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
const routeOkay = (value: RouteResult & { error?: string }): RouteResult => {
  if (!value.route || !Array.isArray(value.segments))
    throw new Error(
      value.error ??
        "No safe route was found. Choose a different endpoint or distance.",
    );
  return value;
};
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
  const [error, setError] = useState(""),
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
    operation = useRef(0),
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
          evaluate: async (route, fix, context) => {
            const response = await client.call<any>({
              op: "snapshot",
              route,
              point: { latitude: fix.latitude, longitude: fix.longitude },
              accuracy: fix.accuracy,
              timestamp: fix.timestamp,
              progress: context.previousProgress,
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
            if (inspected.canNavigate) {
              snapshotState.current = undefined;
              controller.start(
                ride.record,
                ride.routeProgressMeters,
                ride.creditedDistanceMeters,
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
              if (!disposed && token === operation.current)
                setPreview(inspected);
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
  async function plan() {
    if (!clientRef.current || !draft.start) return;
    const token = ++operation.current;
    setError("");
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
          now: Date.now(),
        }),
      );
      if (token !== operation.current) return;
      const record = makeRecord(result, draft);
      setPreview(result);
      setSelected(record);
      setOrigin("planner");
      setScreen("preview");
      applyStore(storeRef.current!.recordSuccess(record));
    } catch (e) {
      if (token === operation.current) {
        setError(errorText(e));
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
    go("preview");
  }
  async function recalculate() {
    if (!selected || !clientRef.current) return;
    setGapFocus(null);
    const token = ++operation.current;
    setChecking(true);
    setError("");
    const before = selected;
    try {
      const result = routeOkay(
        await clientRef.current.call<RouteResult>({
          op: "recalculate",
          route: selected.route,
          now: Date.now(),
        }),
      );
      if (token !== operation.current) return;
      const replacement = makeRecord(result, draft, selected.title);
      setPreview(result);
      setSelected(replacement);
      applyStore(
        storeRef.current!.replace(before.key, replacement),
        "Route recalculated",
        () => {
          applyStore(
            storeRef.current!.replace(replacement.key, before),
            "Previous route restored",
          );
          void openRoute(before, origin === "saved" ? "saved" : "plan");
        },
      );
    } catch (e) {
      if (token === operation.current) setError(errorText(e));
    } finally {
      if (token === operation.current) setChecking(false);
    }
  }
  async function reroute(mode: "rejoin" | "return" | "destination") {
    const controller = controllerRef.current;
    // One captured snapshot supplies both the worker payload and the later applicability check.
    const request = controller?.rerouteRequest();
    if (!controller || !request || !clientRef.current) return;
    const token = ++operation.current;
    setBusy(true);
    setError("");
    try {
      const result = routeOkay(
        await clientRef.current.call<RouteResult>({
          op: "reroute",
          route: request.record.route,
          point: {
            latitude: request.fix.latitude,
            longitude: request.fix.longitude,
          },
          progress: request.progress,
          mode,
          now: Date.now(),
        }),
      );
      if (token !== operation.current) return;
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
      const record = makeRecord(
        result,
        request.record.draft as Draft,
        mode === "return" ? "Returning to start" : request.record.title,
      );
      setPreview(result);
      setSelected(record);
      snapshotState.current = undefined;
      controller.replaceRoute(record);
      applyStore(storeRef.current!.recordSuccess(record));
    } catch (e) {
      if (token === operation.current) setError(errorText(e));
    } finally {
      if (token === operation.current) setBusy(false);
    }
  }
  function saveRecord(record: RouteRecord) {
    applyStore(storeRef.current!.save(record), "Saved to Saved routes");
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
        attribution:
          network?.mode === "fixture"
            ? "Synthetic review geometry created for Trail Mapper, CC0. Not real infrastructure. Map attribution: OpenStreetMap contributors."
            : network?.datasetRecord
              ? `${network.datasetRecord.source.attribution} Changes: ${network.datasetRecord.source.changes} Generated route; not an official county map.`
              : "Trail data: McLean County GIS Consortium (McGIS) and members. Access roads: U.S. Census Bureau. Supplemental/access data © OpenStreetMap contributors (https://www.openstreetmap.org/copyright), ODbL. Generated route; not an official county map.",
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
  const isSaved =
      !!selected && library.saved.some((item) => item.key === selected.key),
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
          closures={network?.closures ?? []}
          fixture={fixtureData}
          county={network?.mode === "county"}
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
              <button onClick={() => setError("")}>Dismiss</button>
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
                    {[3, 5, 10, 15].map((value) => (
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
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={draft.proposed}
                  onChange={(e) =>
                    setDraft({ ...draft, proposed: e.target.checked })
                  }
                />
                <span>
                  Include proposed trails
                  <small>
                    Opt in to planned paths that may not be built or usable.
                  </small>
                </span>
              </label>
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
                  {preview.summary && <p>{preview.summary}</p>}
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
                          <SafeLink href={closure.sourceUrl}>
                            Review official notice
                          </SafeLink>
                        </article>
                      ))}
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
                        : preview.accessGaps?.length
                          ? "Navigation needs a continuously mapped route. The connections listed above are still unverified."
                          : "Navigation is unavailable for this route. Review the notices above before choosing another route."}
                    </p>
                  )}
                  <div className="actions preview-actions">
                    <button
                      onClick={() => {
                        if (isSaved) {
                          setSavedTab("saved");
                          go("saved");
                        } else if (selected) saveRecord(selected);
                      }}
                    >
                      {isSaved ? "Saved · View" : "Save"}
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
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={draft.proposed}
                  onChange={(e) =>
                    setDraft({ ...draft, proposed: e.target.checked })
                  }
                />
                <span>
                  Show proposed trails
                  <small>Planned paths may not be built or usable.</small>
                </span>
              </label>
              <Legend />
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
                I understand this file will reveal the full route and its
                endpoints.
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
