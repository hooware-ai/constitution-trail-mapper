import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection, LineString } from "geojson";
import type { Closure, Feature, MapCues, Point, RouteResult } from "./types";
import type { LocationFix, NavigationPhase } from "./platform/navigation";
import { lengthMeters, riddenPolylines } from "./ridden";
import { rideRoutePaths } from "./rideRoutePaths";
import {
  nearestBearing,
  nextRideHeading,
  type RideHeading,
} from "./rideCamera";
import { MapView } from "./MapView";

// Vite emits a hashed same-origin worker; MapLibre's package-relative default URL is not a deployed asset.
maplibregl.setWorkerUrl(mapWorkerUrl);

const emptyLines = (): FeatureCollection<LineString> => ({
  type: "FeatureCollection",
  features: [],
});
const line = (points: Point[]) => ({
  type: "Feature" as const,
  properties: {},
  geometry: {
    type: "LineString" as const,
    coordinates: points.map((point) => [point.longitude, point.latitude]),
  },
});
const lines = (paths: Point[][]): FeatureCollection<LineString> => ({
  type: "FeatureCollection",
  features: paths.filter((path) => path.length > 1).map(line),
});
const routePaths = (route: RouteResult | null) =>
  route?.segments.map((part) => part.points) ?? [];
const estimatedPaths = (route: RouteResult | null) =>
  route?.accessGaps?.map((gap) => [gap.from, gap.to]) ?? [];
const allRoutePoints = (route: RouteResult | null) => routePaths(route).flat();

/** The ride camera is separate from the planning map; it never changes route matching or the Start gate. */
export function RideMap({
  features,
  route,
  position,
  phase,
  closures,
  cues,
  riddenMeters,
  fixture,
  county,
  osm,
  tiles,
  onTilesChange,
}: {
  features: Feature[];
  route: RouteResult | null;
  position: LocationFix | null;
  phase: NavigationPhase;
  closures: Closure[];
  cues: MapCues | null;
  riddenMeters: number;
  fixture: boolean;
  county: boolean;
  osm: boolean;
  tiles: boolean;
  onTilesChange: (enabled: boolean) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const heading = useRef<RideHeading | null>(null);
  const positionRef = useRef(position);
  positionRef.current = position;
  const [ready, setReady] = useState(false);
  const [following, setFollowing] = useState(true);
  const [tileError, setTileError] = useState(false);
  const [webgl] = useState(() =>
    Boolean(document.createElement("canvas").getContext("webgl2")),
  );
  const [mapFailed, setMapFailed] = useState(false);
  const live = phase === "navigating" || phase === "off-route";

  useEffect(() => {
    if (!webgl || mapFailed || !root.current) return;
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({
        container: root.current,
        center: [-88.97, 40.502],
        zoom: 13,
        pitch: 0,
        bearing: 0,
        attributionControl: false,
        style: {
          version: 8,
          sources: {
            streets: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              maxzoom: 19,
              attribution:
                '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors / ODbL</a>',
            },
            trails: {
              type: "geojson",
              data: emptyLines(),
              attribution: fixture
                ? "Synthetic review geometry · CC0"
                : county
                  ? '<a href="https://www.mcgis.org" target="_blank" rel="noopener noreferrer">McGIS and members</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a> · reviewed, normalized subset' +
                    (osm
                      ? ' · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OSM data / ODbL</a>'
                      : "")
                  : "McGIS and members · U.S. Census · OSM data / ODbL",
            },
            closures: { type: "geojson", data: emptyLines() },
            route: { type: "geojson", data: emptyLines() },
            access: { type: "geojson", data: emptyLines() },
            estimated: { type: "geojson", data: emptyLines() },
            ridden: { type: "geojson", data: emptyLines() },
          },
          layers: [
            {
              id: "streets",
              type: "raster",
              source: "streets",
              layout: { visibility: "none" },
            },
            {
              id: "trails",
              type: "line",
              source: "trails",
              paint: {
                "line-color": "#659487",
                "line-width": 2,
                "line-opacity": 0.7,
              },
            },
            {
              id: "closures",
              type: "line",
              source: "closures",
              paint: {
                "line-color": "#b33131",
                "line-width": 6,
                "line-dasharray": [1, 1],
              },
            },
            {
              id: "route-halo",
              type: "line",
              source: "route",
              paint: {
                "line-color": "#fff",
                "line-width": 11,
                "line-opacity": 0.94,
              },
            },
            {
              id: "route",
              type: "line",
              source: "route",
              paint: { "line-color": "#00695f", "line-width": 7 },
            },
            {
              id: "access",
              type: "line",
              source: "access",
              paint: {
                "line-color": "#4d6888",
                "line-width": 6,
                "line-dasharray": [1.5, 1.5],
              },
            },
            {
              id: "estimated",
              type: "line",
              source: "estimated",
              paint: {
                "line-color": "#a94d22",
                "line-width": 5,
                "line-dasharray": [1, 2],
              },
            },
            {
              id: "ridden",
              type: "line",
              source: "ridden",
              paint: {
                "line-color": "#b5ccc4",
                "line-width": 7,
                "line-opacity": 0.9,
              },
            },
          ],
        },
      });
    } catch {
      setMapFailed(true);
      return;
    }
    map.current = m;
    m.on("load", () => setReady(true));
    const publishCamera = () => {
      root.current?.setAttribute(
        "data-actual-bearing",
        String(Math.round(m.getBearing())),
      );
      root.current?.setAttribute(
        "data-actual-pitch",
        String(Math.round(m.getPitch())),
      );
      const center = m.getCenter();
      root.current?.setAttribute(
        "data-actual-center",
        `${center.lat.toFixed(5)},${center.lng.toFixed(5)}`,
      );
    };
    m.on("moveend", publishCamera);
    publishCamera();
    m.on("dragstart", () => setFollowing(false));
    m.on("error", (event) => {
      const message = String(event.error?.message ?? "");
      if (message.includes("Worker failed") || message.includes("WebGL"))
        setMapFailed(true);
      else if (message.includes("tile")) setTileError(true);
    });
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(root.current);
    return () => {
      ro.disconnect();
      marker.current?.remove();
      marker.current = null;
      map.current = null;
      m.remove();
    };
    // A route/phase change updates sources and camera below; only unmount disposes WebGL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webgl, mapFailed]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource("trails") as GeoJSONSource).setData(
      lines(
        features
          .filter((feature) => feature.status !== "Proposed")
          .flatMap((feature) => feature.paths),
      ),
    );
    const drawnRoute = rideRoutePaths(route, cues);
    (m.getSource("route") as GeoJSONSource).setData(lines(drawnRoute.mapped));
    (m.getSource("access") as GeoJSONSource).setData(lines(drawnRoute.access));
    (m.getSource("estimated") as GeoJSONSource).setData(
      lines(estimatedPaths(route)),
    );
    (m.getSource("closures") as GeoJSONSource).setData(
      lines(
        closures.map(
          (closure) =>
            closure.points ??
            [closure.closedFrom, closure.closedTo].filter(
              (point): point is Point => !!point,
            ),
        ),
      ),
    );
    const points = allRoutePoints(route);
    if (points.length > 1 && !positionRef.current) {
      const bounds = new maplibregl.LngLatBounds();
      points.forEach((point) =>
        bounds.extend([point.longitude, point.latitude]),
      );
      m.fitBounds(bounds, { padding: 64, maxZoom: 15, duration: 0 });
    }
  }, [features, route, closures, cues, ready]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const paths =
      cues && riddenMeters > 0
        ? riddenPolylines(cues.pieces, riddenMeters)
        : [];
    (m.getSource("ridden") as GeoJSONSource).setData(lines(paths));
    root.current?.setAttribute(
      "data-ridden-meters",
      String(
        Math.round(paths.reduce((sum, path) => sum + lengthMeters(path), 0)),
      ),
    );
  }, [cues, riddenMeters, ready]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    m.setLayoutProperty("streets", "visibility", tiles ? "visible" : "none");
  }, [ready, tiles]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    if (!live || !position) {
      marker.current?.remove();
      marker.current = null;
      heading.current = null;
      root.current?.setAttribute("data-camera-mode", "waiting");
      return;
    }
    heading.current = nextRideHeading(heading.current, position);
    const bearing = heading.current.bearing;
    if (!marker.current) {
      const el = document.createElement("div");
      el.className = "ride-pin";
      el.setAttribute("aria-hidden", "true");
      marker.current = new maplibregl.Marker({
        element: el,
        rotationAlignment: "map",
      })
        .setLngLat([position.longitude, position.latitude])
        .addTo(m);
    }
    marker.current
      .setLngLat([position.longitude, position.latitude])
      .setRotation(bearing ?? 0);
    marker.current
      .getElement()
      .classList.toggle("has-heading", bearing !== null);
    if (!following) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    m.easeTo({
      center: [position.longitude, position.latitude],
      zoom: 16.5,
      pitch: bearing === null ? 0 : 48,
      bearing: bearing === null ? 0 : nearestBearing(m.getBearing(), bearing),
      offset: [0, m.getContainer().clientHeight * 0.16],
      duration: reduced ? 0 : 450,
    });
    root.current?.setAttribute(
      "data-camera-mode",
      bearing === null ? "north-up" : "heading-up",
    );
    root.current?.setAttribute("data-camera-bearing", String(bearing ?? 0));
    root.current?.setAttribute(
      "data-camera-pitch",
      String(bearing === null ? 0 : 48),
    );
  }, [ready, live, position, following, route?.key]);

  if (!webgl || mapFailed)
    return (
      <div className="ride-map-fallback">
        <MapView
          features={features}
          route={route}
          proposed={false}
          position={live ? (position ?? undefined) : undefined}
          closures={closures}
          fixture={fixture}
          county={county}
          osm={osm}
          cues={cues}
          riddenMeters={riddenMeters}
          follow={following}
          preferCanvas={false}
          onManualPan={() => setFollowing(false)}
          tilesEnabled={tiles}
          onTilesChange={onTilesChange}
        />
        <div className="ride-map-control">
          <span>Flat map on this device</span>
          <button onClick={() => setFollowing(true)}>Recenter</button>
        </div>
      </div>
    );

  return (
    <section
      className="ride-map"
      aria-label="Following navigation map"
      data-following={following}
    >
      <div
        ref={root}
        className="ride-map-canvas"
        role="region"
        aria-label="Route map. Drag to explore, then tap Recenter to follow your location."
      />
      <div className="ride-map-control">
        <button
          className="ride-recenter"
          onClick={() => setFollowing(true)}
          disabled={!position || !live}
        >
          {following ? "Following" : "Recenter"}
        </button>
        {!fixture && (
          <button
            className="ride-tiles"
            onClick={() => {
              onTilesChange(!tiles);
              setTileError(false);
            }}
            aria-pressed={tiles}
          >
            {tiles ? "Map on" : "Street map"}
          </button>
        )}
      </div>
      <div className="ride-credit">
        {fixture ? (
          "Synthetic review geometry · CC0"
        ) : (
          <>
            <a
              href="https://www.mcgis.org"
              target="_blank"
              rel="noopener noreferrer"
            >
              McGIS and members
            </a>
            {county && (
              <>
                {" "}
                ·{" "}
                <a
                  href="https://creativecommons.org/licenses/by/4.0/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  CC BY 4.0
                </a>
              </>
            )}
            {osm && (
              <>
                {" "}
                ·{" "}
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  OSM data / ODbL
                </a>
              </>
            )}
            {tiles && (
              <>
                {" "}
                ·{" "}
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  © OSM tiles
                </a>
              </>
            )}
          </>
        )}
      </div>
      {tileError && tiles && (
        <p className="ride-map-error" role="status">
          Street map unavailable. Trail route remains visible.
        </p>
      )}
    </section>
  );
}
