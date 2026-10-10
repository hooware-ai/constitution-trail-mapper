import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Feature, Point, RouteResult, Closure, MapCues } from "./types";
import { ChevronLayer } from "./chevrons";
import { lengthMeters, riddenPolylines } from "./ridden";
import { connectionsToCheck, gapDistance } from "./gapDistance";
const routePoints = (route: RouteResult) => [
  ...route.segments.flatMap((segment) => segment.points),
  ...(route.accessGaps ?? []).flatMap((gap) => [gap.from, gap.to]),
];
const xy = (p: Point): L.LatLngTuple => [p.latitude, p.longitude];
const plain = (text: string) => {
  const node = document.createElement("span");
  node.textContent = text;
  return node;
};
/** An attribution link opens in a new tab and never hands over this page: a tap on it must not end a ride in progress. */
const credit = (href: string, text: string) =>
  `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;

export function MapView({
  features,
  route,
  gapFocus,
  instructionFocus,
  proposed,
  picking,
  onPick,
  pickedPoint,
  position,
  closures = [],
  fixture,
  county = false,
  osm = false,
  fitSignal = 0,
  cues = null,
  riddenMeters,
  follow = false,
  preferCanvas = true,
  onManualPan,
  tilesEnabled,
  onTilesChange,
  onTileError,
  showTileError = true,
  showTileControl = true,
  showCaption = true,
}: {
  features: Feature[];
  route: RouteResult | null;
  gapFocus?: { id: string } | null;
  /** Preview-only selection; the parent binds this to the route that supplied the instruction. */
  instructionFocus?: { index: number } | null;
  proposed: boolean;
  picking?: boolean;
  onPick?: (p: Point) => void;
  /** A resolved Explore pin awaiting the user's endpoint confirmation. */
  pickedPoint?: Point | null;
  position?: Point;
  closures?: Closure[];
  fixture: boolean;
  /** Packaged county data: credit the county license, not the OSM/Census sources of the older local files. */
  county?: boolean;
  /** The packaged data includes the reviewed OpenStreetMap supplement: credit it (ODbL) beside the county license. */
  osm?: boolean;
  /** Increase to refit the map to every drawn trail ("Show all trails"). */
  fitSignal?: number;
  /** Direction chevrons, second passes and turn-around signs for `route` (computed by the shared core, as for native). */
  cues?: MapCues | null;
  /** While navigating: how far along the route the rider has credibly ridden. That part is faded, as in native. */
  riddenMeters?: number;
  /** Flat-map fallback on devices without WebGL. */
  follow?: boolean;
  preferCanvas?: boolean;
  onManualPan?: () => void;
  tilesEnabled?: boolean;
  onTilesChange?: (enabled: boolean) => void;
  /** Explore places optional-tile errors beside its controls rather than over the map. */
  onTileError?: (failed: boolean) => void;
  showTileError?: boolean;
  showTileControl?: boolean;
  showCaption?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    layers = useRef<L.LayerGroup | null>(null);
  const gapMarkers = useRef(new Map<string, L.Marker>());
  const chevrons = useRef<ChevronLayer | null>(null);
  const riddenLayer = useRef<L.LayerGroup | null>(null);
  const drawRidden = useRef<() => void>(() => {});
  const pick = useRef(onPick),
    manualPan = useRef(onManualPan),
    [localTiles, setLocalTiles] = useState(false),
    [tileError, setTileError] = useState(false);
  useEffect(() => onTileError?.(tileError), [tileError, onTileError]);
  const tiles = tilesEnabled ?? localTiles;
  useEffect(() => setTileError(false), [tiles]);
  const setTiles = onTilesChange ?? setLocalTiles;
  pick.current = onPick;
  manualPan.current = onManualPan;
  useEffect(() => {
    if (!root.current) return;
    const m = L.map(root.current, {
      zoomControl: true,
      attributionControl: true,
      preferCanvas,
    }).setView([40.502, -88.97], 13);
    // Leaflet's own prefix link would also replace this page; keep the credit, open it safely.
    m.attributionControl.setPrefix(credit("https://leafletjs.com", "Leaflet"));
    map.current = m;
    layers.current = L.layerGroup().addTo(m);
    chevrons.current = new ChevronLayer().addTo(m);
    riddenLayer.current = L.layerGroup().addTo(m);
    // A read-only mirror of the view (zoom and centre) for tests and assistive tooling; it changes nothing.
    const publishView = () => {
      const c = m.getCenter();
      root.current?.setAttribute("data-zoom", String(m.getZoom()));
      root.current?.setAttribute(
        "data-center",
        `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`,
      );
    };
    m.on("moveend zoomend", publishView);
    m.on("dragstart", () => manualPan.current?.());
    publishView();

    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(root.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, [preferCanvas]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const clicked = (e: L.LeafletMouseEvent) => {
      if (picking)
        pick.current?.({ latitude: e.latlng.lat, longitude: e.latlng.lng });
    };
    m.on("click", clicked);
    return () => {
      m.off("click", clicked);
    };
  }, [picking]);
  useEffect(() => {
    const m = map.current;
    if (!m || !pickedPoint) return;
    const marker = L.marker(xy(pickedPoint), {
      keyboard: false,
      interactive: false,
      icon: L.divIcon({
        className: "explore-point-marker",
        html: plain("●"),
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      }),
    }).addTo(m);
    marker.getElement()?.setAttribute("role", "img");
    marker.getElement()?.setAttribute("aria-label", "Selected ride point");
    return () => {
      marker.remove();
    };
  }, [pickedPoint]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const notice = fixture
      ? "Synthetic review geometry · CC0"
      : county
        ? `Trail data: ${credit("https://www.mcgis.org", "McGIS and members")} · ${credit("https://creativecommons.org/licenses/by/4.0/", "CC BY 4.0")} · changes: reviewed subset, normalized${osm ? ` · OpenStreetMap data: ${credit("https://www.openstreetmap.org/copyright", "© OpenStreetMap contributors / ODbL")}` : ""}`
        : `Trail data: ${credit("https://www.mcgis.org", "McGIS and members")} · U.S. Census · ${credit("https://www.openstreetmap.org/copyright", "© OSM contributors / ODbL")}`;
    m.attributionControl.addAttribution(notice);
    return () => {
      m.attributionControl.removeAttribution(notice);
    };
  }, [fixture, county, osm]);
  useEffect(() => {
    const m = map.current,
      g = layers.current;
    if (!m || !g) return;
    g.clearLayers();
    gapMarkers.current.clear();
    features
      .filter((f) => proposed || f.status !== "Proposed")
      .forEach((f) =>
        f.paths.forEach((path) => {
          const proposed = f.status === "Proposed",
            shared = f.roles.includes("SharedRoadways"),
            park = f.roles.includes("ParkConnectors"),
            verified = f.id.startsWith("verified-osm:way:");
          L.polyline(path.map(xy), {
            color: proposed
              ? "#7851a9"
              : verified
                ? "#b01767"
                : shared
                  ? "#68718b"
                  : park
                    ? "#63a375"
                    : "#08725f",
            weight: route ? 2 : 4,
            opacity: route ? 0.5 : 0.85,
            dashArray: proposed ? "6 7" : shared ? "3 5" : undefined,
          })
            .bindTooltip(plain(f.name ?? "Trail"))
            .addTo(g);
        }),
      );
    // Closure geometry is map context; the selected route retains its heavier casing.
    const closureMarkers: { closure: Closure; anchor: L.LatLng }[] = [];
    closures.forEach((closure) => {
      if (!closure.points || closure.points.length < 2) return;
      const path = L.polyline(closure.points.map(xy), {
        color: "#b45309",
        weight: 3,
        opacity: 0.85,
        dashArray: "3 7",
        interactive: false,
      }).addTo(g);
      closureMarkers.push({ closure, anchor: path.getCenter() });
    });
    // With cues the route is drawn as the pieces native draws (direction ordered, a second pass beside the first); without
    // them, as the plain drawable segments. Estimated access is never drawn as a line either way.
    const drawn = cues
      ? cues.pieces.filter((piece) => piece.isRouted)
      : (route?.segments ?? []);
    drawn.forEach((s) => {
      const roles =
        s.roles ?? (s as { routeRoles?: string[] }).routeRoles ?? [];
      const access = s.type === "Access",
        prop = roles.includes("ProposedTrails"),
        shared = roles.includes("SharedRoadways"),
        park = roles.includes("ParkConnectors");
      const color = prop
        ? "#7851a9"
        : access
          ? "#4d6888"
          : shared
            ? "#68718b"
            : park
              ? "#63a375"
              : "#08725f";
      L.polyline(s.points.map(xy), {
        color: "#fff",
        weight: 10,
        opacity: 0.9,
      }).addTo(g);
      L.polyline(s.points.map(xy), {
        color,
        weight: 6,
        dashArray: access ? "8 7" : prop ? "6 7" : shared ? "3 5" : undefined,
      }).addTo(g);
    });
    chevrons.current?.setPieces(cues?.pieces ?? []);
    (cues?.turnarounds ?? []).forEach((turn) => {
      const label = `Turn around, ${(turn.distance / 1609.344).toFixed(1)} mi into the route`;
      const marker = L.marker(xy(turn.point), {
        icon: L.divIcon({
          className: "turnaround-marker",
          html: '<span class="turnaround-sign"><span aria-hidden="true">↩</span> Turn around</span>',
          iconSize: [112, 28],
          iconAnchor: [56, 14],
        }),
        title: label,
        keyboard: true,
      })
        .bindPopup(plain(label))
        .addTo(g);
      marker.getElement()?.setAttribute("aria-label", label);
    });
    closureMarkers.forEach(({ closure, anchor }) => {
      const details = document.createElement("div");
      const heading = document.createElement("strong");
      heading.textContent = "Reported trail closure";
      const message = document.createElement("p");
      message.textContent = closure.message;
      details.append(heading, message);
      if (closure.mappingNote) {
        const note = document.createElement("p");
        note.textContent = `${closure.mappingNote}${closure.checkedOn ? ` Notice checked ${closure.checkedOn}.` : ""}`;
        details.append(note);
      }
      if (/^https?:\/\//i.test(closure.sourceUrl)) {
        const source = document.createElement("a");
        source.href = closure.sourceUrl;
        source.textContent = "Review official notice";
        source.target = "_blank";
        source.rel = "noopener noreferrer";
        details.append(source);
      }
      const marker = L.marker(anchor, {
        icon: L.divIcon({
          className: "closure-marker",
          html: '<span class="closure-symbol" aria-hidden="true"></span>',
          iconSize: [44, 44],
          iconAnchor: [22, 22],
          popupAnchor: [0, -16],
        }),
        title: "Trail closed — show closure details",
        keyboard: true,
        bubblingMouseEvents: false,
      })
        .bindTooltip(plain("Trail closed"), {
          permanent: true,
          interactive: true,
          direction: "auto",
          offset: [14, 0],
          className: "closure-label",
        })
        .bindPopup(details, { maxWidth: 280 })
        .addTo(g);
      marker
        .getElement()
        ?.setAttribute("aria-label", "Trail closed — show closure details");
      const label = marker.getTooltip()?.getElement();
      if (label) {
        L.DomEvent.disableClickPropagation(label);
        label.addEventListener("click", () => marker.openPopup());
      }
    });
    if (route?.segments.length) {
      const all = route.segments.flatMap((s) => s.points);
      for (const [p, label] of [
        [all[0], "Start"],
        [all.at(-1), "Finish"],
      ] as const) {
        if (p)
          L.circleMarker(xy(p), {
            radius: 8,
            fillColor: label === "Start" ? "#fff" : "#08725f",
            color: "#093b33",
            weight: 3,
            fillOpacity: 1,
          })
            .bindTooltip(
              route.canNavigate
                ? label
                : "Mapped route " + (label === "Start" ? "begins" : "ends"),
            )
            .addTo(g);
      }
    }
    // Start and destination (or loop return) connections are obvious: they get a dashed line and no numbered notice. Connections
    // BETWEEN mapped parts keep their numbered marker, popup and list entry.
    (route?.accessGaps ?? [])
      .filter((gap) => gap.kind === "endpoint")
      .forEach((gap) => {
        L.polyline([xy(gap.from), xy(gap.to)], {
          color: "#093b33",
          weight: 3,
          opacity: 0.8,
          dashArray: "4 6",
          interactive: false,
          className: "estimated-connection",
        })
          .bindTooltip("Estimated connection, not confirmed", {
            sticky: true,
          })
          .addTo(g);
      });
    connectionsToCheck(route?.accessGaps ?? []).forEach((gap, index) => {
      const bounds = L.latLngBounds([xy(gap.from), xy(gap.to)]);
      const label = `Connection ${index + 1}: ${gap.label}, ${gapDistance(gap.distanceMeters)}`;
      const details = document.createElement("div");
      const heading = document.createElement("strong");
      heading.textContent = label;
      const note = document.createElement("p");
      note.textContent =
        "Map data does not confirm a traversable connection here. This distance is included in the route estimate.";
      details.append(heading, note);
      const marker = L.marker(bounds.getCenter(), {
        icon: L.divIcon({
          className: "connection-marker",
          html: `<span class="connection-number" aria-hidden="true">${index + 1}</span>`,
          iconSize: [44, 44],
          iconAnchor: [22, 22],
          popupAnchor: [0, -12],
        }),
        title: label + " — unverified",
        keyboard: true,
        bubblingMouseEvents: false,
      })
        .bindTooltip(plain(label), { direction: "auto" })
        .bindPopup(details, {
          maxWidth: 260,
          className: "connection-popup",
          autoPanPaddingTopLeft: [48, 116],
          autoPanPaddingBottomRight: [16, 32],
        })
        .addTo(g);
      marker.getElement()?.setAttribute("aria-label", label + " — unverified");
      marker.on("popupopen", () => marker.closeTooltip());
      gapMarkers.current.set(gap.id, marker);
    });
    drawRidden.current();
  }, [features, route, proposed, closures, cues]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const pts = route
      ? routePoints(route)
      : features.flatMap((f) => f.paths.flat());
    if (pts.length) {
      const bounds =
        route || fixture
          ? L.latLngBounds(pts.map(xy))
          : L.latLngBounds([
              [40.45, -89.035],
              [40.55, -88.91],
            ]);
      m.fitBounds(bounds, { padding: [32, 32], maxZoom: 16, animate: false });
    }
  }, [route, features, fixture]);
  // The ridden overlay is redrawn on top of the route whenever either changes (the route is rebuilt on its own schedule).
  drawRidden.current = () => {
    const group = riddenLayer.current;
    if (!group) return;
    group.clearLayers();
    const lines =
      cues && riddenMeters ? riddenPolylines(cues.pieces, riddenMeters) : [];
    for (const line of lines)
      L.polyline(line.map(xy), {
        color: "#ffffff",
        weight: 14,
        opacity: 0.6,
        interactive: false,
      }).addTo(group);
    root.current?.setAttribute(
      "data-ridden-meters",
      String(
        Math.round(lines.reduce((sum, line) => sum + lengthMeters(line), 0)),
      ),
    );
  };
  useEffect(() => {
    drawRidden.current();
  }, [cues, riddenMeters, route]);
  useEffect(() => {
    const m = map.current;
    if (!m || !fitSignal) return;
    const pts = features
      .filter((f) => proposed || f.status !== "Proposed")
      .flatMap((f) => f.paths.flat());
    if (pts.length)
      m.fitBounds(L.latLngBounds(pts.map(xy)), {
        padding: [32, 32],
        maxZoom: 16,
        animate: false,
      });
    // Only an explicit request refits; later data or toggle changes must not move the rider's view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal]);
  useEffect(() => {
    const gap = route?.accessGaps?.find((item) => item.id === gapFocus?.id);
    const m = map.current;
    if (!m || !gap) return;
    root.current?.parentElement?.scrollIntoView({ block: "nearest" });
    m.fitBounds(L.latLngBounds([xy(gap.from), xy(gap.to)]), {
      padding: [56, 56],
      maxZoom: 19,
      animate: false,
    });
    const marker = gapMarkers.current.get(gap.id);
    marker?.getElement()?.focus({ preventScroll: true });
    marker?.openPopup();
  }, [gapFocus, route]);
  useEffect(() => {
    const instruction = instructionFocus
      ? route?.instructions[instructionFocus.index]
      : undefined;
    const m = map.current;
    if (!m || !instruction?.point || !instructionFocus) return;
    const number = instructionFocus.index + 1;
    const icon = document.createElement("span");
    icon.textContent = String(number);
    const marker = L.marker(xy(instruction.point), {
      keyboard: false,
      interactive: false,
      icon: L.divIcon({
        className: "instruction-marker",
        html: icon,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      }),
      title: `Step ${number}: ${instruction.text}`,
    }).addTo(m);
    const element = marker.getElement();
    element?.setAttribute("role", "img");
    element?.setAttribute("tabindex", "-1");
    element?.setAttribute("aria-label", `Step ${number}: ${instruction.text}`);
    m.setView(xy(instruction.point), 17, { animate: false });
    const reveal = () =>
      root.current?.parentElement?.scrollIntoView({
        block: "nearest",
        behavior: "instant",
      });
    let revealedY = 0;
    const cancelReveal = () => {
      window.removeEventListener("scrollend", settle);
      window.removeEventListener("pointerdown", cancelReveal, true);
      window.removeEventListener("wheel", cancelReveal, true);
      window.removeEventListener("keydown", cancelReveal, true);
    };
    const settle = () => {
      if (window.scrollY === revealedY) return;
      cancelReveal();
      if (document.activeElement !== element) return;
      const box = element?.getBoundingClientRect();
      if (box && (box.top < 0 || box.bottom > window.innerHeight)) {
        reveal();
      }
    };
    // The dialog's close restores its opener first; focus the located maneuver afterwards.
    const frame = requestAnimationFrame(() => {
      const scrollBefore = window.scrollY;
      reveal();
      revealedY = window.scrollY;
      element?.focus({ preventScroll: true });
      // Mobile Chromium can restore the old viewport after this focus. Reveal once more when that scroll settles.
      if (revealedY !== scrollBefore) {
        window.addEventListener("scrollend", settle);
        window.addEventListener("pointerdown", cancelReveal, {
          passive: true,
          capture: true,
        });
        window.addEventListener("wheel", cancelReveal, {
          passive: true,
          capture: true,
        });
        window.addEventListener("keydown", cancelReveal, { capture: true });
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelReveal();
      marker.remove();
    };
  }, [instructionFocus, route]);
  useEffect(() => {
    if (!map.current || !position) return;
    const marker = L.circleMarker(xy(position), {
      radius: 9,
      color: "#fff",
      weight: 3,
      fillColor: "#1663c5",
      fillOpacity: 1,
    }).addTo(map.current);
    return () => {
      marker.remove();
    };
  }, [position?.latitude, position?.longitude]);
  useEffect(() => {
    if (follow && position) map.current?.panTo(xy(position), { animate: true });
  }, [follow, position?.latitude, position?.longitude]);
  useEffect(() => {
    if (!map.current || !tiles || fixture) return;
    const tile = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      // The licence credit is a visible, clickable link whenever the optional tiles are on (the tile policy requires
      // visible attribution); it opens the copyright page in a new tab without handing it this page.
      attribution: credit(
        "https://www.openstreetmap.org/copyright",
        "© OpenStreetMap contributors",
      ),
      crossOrigin: false,
    });
    tile.on("tileerror", () => setTileError(true));
    tile.addTo(map.current);
    return () => {
      tile.remove();
    };
  }, [tiles, fixture]);
  function fit() {
    const pts = route
      ? routePoints(route)
      : features.flatMap((f) => f.paths.flat());
    if (pts.length)
      map.current?.fitBounds(L.latLngBounds(pts.map(xy)), {
        padding: [32, 32],
        maxZoom: 16,
      });
  }
  return (
    <section
      className={"map-wrap" + (picking ? " picking" : "")}
      data-estimated-connections={route?.accessGaps?.length ?? 0}
      aria-label={
        route?.accessGaps?.length
          ? "Route map with unverified connections"
          : route
            ? "Complete route map"
            : "Trail network map"
      }
    >
      <div
        className="map"
        ref={root}
        role="region"
        aria-label="Interactive map. Arrow keys pan, plus and minus zoom."
        tabIndex={0}
      />
      <div className="map-tools">
        <button onClick={fit}>Fit {route ? "route" : "network"}</button>
        {!fixture && showTileControl && (
          <label className="tile-toggle">
            <input
              type="checkbox"
              checked={tiles}
              onChange={(e) => {
                setTileError(false);
                setTiles(e.target.checked);
              }}
            />{" "}
            Street basemap (online)
          </label>
        )}
      </div>
      {showCaption && (
        <div className="map-caption">
          {fixture
            ? "Synthetic review network · not real trails"
            : "Bloomington–Normal · Constitution Trail"}
        </div>
      )}
      {picking && (
        <div className="map-picker">
          <p>Tap a point, or pan with arrow keys.</p>
          <button
            onClick={() => {
              const c = map.current?.getCenter();
              if (c) pick.current?.({ latitude: c.lat, longitude: c.lng });
            }}
          >
            Use map center
          </button>
        </div>
      )}
      {tileError && showTileError && (
        <p className="map-error" role="status">
          Street map unavailable. Trail geometry remains visible.
        </p>
      )}
    </section>
  );
}
