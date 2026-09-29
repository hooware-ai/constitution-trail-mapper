import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Feature, Point, RouteResult, Closure } from "./types";
const xy = (p: Point): L.LatLngTuple => [p.latitude, p.longitude];
const plain = (text: string) => {
  const node = document.createElement("span");
  node.textContent = text;
  return node;
};
export function MapView({
  features,
  route,
  proposed,
  picking,
  onPick,
  position,
  closures = [],
  fixture,
}: {
  features: Feature[];
  route: RouteResult | null;
  proposed: boolean;
  picking?: boolean;
  onPick?: (p: Point) => void;
  position?: Point;
  closures?: Closure[];
  fixture: boolean;
}) {
  const root = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    layers = useRef<L.LayerGroup | null>(null);
  const pick = useRef(onPick),
    [tiles, setTiles] = useState(false),
    [tileError, setTileError] = useState(false);
  pick.current = onPick;
  useEffect(() => {
    if (!root.current) return;
    const m = L.map(root.current, {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
    }).setView([40.502, -88.97], 13);
    map.current = m;
    layers.current = L.layerGroup().addTo(m);

    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(root.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);
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
    if (!m) return;
    const credit = fixture
      ? "Synthetic review geometry · CC0"
      : 'Trail data: <a href="https://www.mcgis.org">McGIS and members</a> · U.S. Census · <a href="https://www.openstreetmap.org/copyright">© OSM contributors / ODbL</a>';
    m.attributionControl.addAttribution(credit);
    return () => {
      m.attributionControl.removeAttribution(credit);
    };
  }, [fixture]);
  useEffect(() => {
    const m = map.current,
      g = layers.current;
    if (!m || !g) return;
    g.clearLayers();
    features
      .filter((f) => proposed || f.status !== "Proposed")
      .forEach((f) =>
        f.paths.forEach((path) => {
          const proposed = f.status === "Proposed",
            shared = f.roles.includes("SharedRoadways"),
            park = f.roles.includes("ParkConnectors");
          L.polyline(path.map(xy), {
            color: proposed
              ? "#7851a9"
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
    route?.segments.forEach((s) => {
      // Kotlin bridge omits estimated access from drawable segments.
      const roles = s.roles ?? s.routeRoles ?? [];
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
    closureMarkers.forEach(({ closure, anchor }) => {
      const details = document.createElement("div");
      const heading = document.createElement("strong");
      heading.textContent = "Reported trail closure";
      const message = document.createElement("p");
      message.textContent = closure.message;
      details.append(heading, message);
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
  }, [features, route, proposed, closures]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const pts =
      route?.segments.flatMap((s) => s.points) ??
      features.flatMap((f) => f.paths.flat());
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
  }, [route?.key, features, fixture]);
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
    if (!map.current || !tiles || fixture) return;
    const tile = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
      crossOrigin: false,
    });
    tile.on("tileerror", () => setTileError(true));
    tile.addTo(map.current);
    return () => {
      tile.remove();
    };
  }, [tiles, fixture]);
  function fit() {
    const pts =
      route?.segments.flatMap((s) => s.points) ??
      features.flatMap((f) => f.paths.flat());
    if (pts.length)
      map.current?.fitBounds(L.latLngBounds(pts.map(xy)), {
        padding: [32, 32],
        maxZoom: 16,
      });
  }
  return (
    <section
      className={"map-wrap" + (picking ? " picking" : "")}
      aria-label={route ? "Complete route map" : "Trail network map"}
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
        {!fixture && (
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
      <div className="map-caption">
        {fixture
          ? "Synthetic review network · not real trails"
          : "Bloomington–Normal · Constitution Trail"}
      </div>
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
      {tileError && (
        <p className="map-error" role="status">
          Street map unavailable. Trail geometry remains visible.
        </p>
      )}
    </section>
  );
}
