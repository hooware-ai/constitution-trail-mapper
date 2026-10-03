import type { MapCuePiece, Point } from "./types";
import { chevronsAlong, type Chevron } from "./chevronGeometry";

// A picture of the route to share, as native shares one (header, the route with its direction cues, notices, attribution),
// drawn on this device. It has NO map tiles: a basemap would need the tile service (which the app only ever asks for the
// rider's own visible map) and would taint the canvas, so the picture shows the route over the trails around it instead.
//
// Everything that decides what the picture contains is a pure function (privacy trimming, projection, layout, cue
// placement) so it can be tested without a canvas; `drawImage` only paints that plan.

export const IMAGE_WIDTH = 1080;
const MARGIN = 56;
const MAP_MIN = 560;
const MAP_MAX = 1000;
/** The same pixel offsets native's share image uses for a second pass and for the direction stamps. */
export const SECOND_PASS_OFFSET_PX = 22;
export const IMAGE_CHEVRON_SPACING_PX = 110;
/** Matches the GeoJSON export: nothing within this distance of the start or finish unless the rider approved it. */
export const PRIVACY_RADIUS_METERS = 300;
/**
 * What the picture says instead of the route's saved title unless exact endpoints are approved: a saved title is built
 * from the endpoint labels ("<start> to <destination>") or typed by the rider, so it can name a home or a school.
 */
export const PRIVATE_IMAGE_TITLE = "Planned route";

export interface ImageInput {
  /** The route's saved title. Painted only when `exact` is true; otherwise PRIVATE_IMAGE_TITLE is painted instead. */
  title: string;
  summary: string;
  /** Notices that apply to the route (closure and work advisories, data checks), as the app shows them. */
  warnings: string[];
  attribution: string;
  pieces: MapCuePiece[];
  turnarounds: { point: Point; distance: number }[];
  /** The trails around the route, as plain lines. */
  context: Point[][];
  /** Show the exact start and finish. When false, the route near each end is left out and the ends are not marked. */
  exact: boolean;
  radiusMeters?: number;
}

export interface Pixel {
  x: number;
  y: number;
}
export interface DrawnRun {
  pixels: Pixel[];
  type: string;
  roles: string[];
  second: boolean;
}
export interface ImagePlan {
  width: number;
  height: number;
  map: { x: number; y: number; width: number; height: number };
  title: string[];
  summary: string[];
  warnings: string[][];
  attribution: string[];
  context: Pixel[][];
  runs: DrawnRun[];
  chevrons: { chevron: Chevron; second: boolean }[];
  turnarounds: { pixel: Pixel; label: string }[];
  markers: { pixel: Pixel; label: string }[];
  footerTop: number;
}

const toRadians = Math.PI / 180;
export function metersBetween(a: Point, b: Point): number {
  const dLat = (b.latitude - a.latitude) * toRadians;
  const dLon = (b.longitude - a.longitude) * toRadians;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * toRadians) *
      Math.cos(b.latitude * toRadians) *
      Math.sin(dLon / 2) ** 2;
  return 6_371_008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Leaves out the route within `radius` (plus a margin) of the start and the finish, as the GeoJSON export does. Long
 * lines are densified first so a single long leg cannot cross a hidden area unnoticed; runs are split where they would.
 */
export function hideEndpoints(
  pieces: MapCuePiece[],
  first: Point,
  last: Point,
  radius = PRIVACY_RADIUS_METERS,
): MapCuePiece[] {
  const out: MapCuePiece[] = [];
  for (const piece of pieces)
    for (const run of hideAround([piece.points], first, last, radius))
      out.push({
        ...piece,
        points: run,
        // Distances are not drawn; keep the shape of the piece consistent.
        distances: run.map((_, index) => piece.distances[0] + index),
      });
  return out;
}

/**
 * The same trimming for any set of lines (the trails drawn around the route): densified to 50 m so one long leg cannot
 * cross a hidden area unnoticed, split wherever it enters one, and nothing kept inside it. The privacy rule is about
 * everything drawn, not only the route, so context lines are held to it too.
 */
export function hideAround(
  lines: Point[][],
  first: Point,
  last: Point,
  radius = PRIVACY_RADIUS_METERS,
): Point[][] {
  const hidden = (point: Point) =>
    metersBetween(first, point) <= radius + 50 ||
    metersBetween(last, point) <= radius + 50;
  const out: Point[][] = [];
  for (const line of lines) {
    let run: Point[] = [];
    const flush = () => {
      if (run.length >= 2) out.push(run);
      run = [];
    };
    const sampled: Point[] = [];
    for (let i = 0; i < line.length; i++) {
      if (i === 0) {
        sampled.push(line[0]);
        continue;
      }
      const a = line[i - 1];
      const b = line[i];
      const steps = Math.max(1, Math.ceil(metersBetween(a, b) / 50));
      for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        sampled.push({
          latitude: a.latitude + (b.latitude - a.latitude) * t,
          longitude: a.longitude + (b.longitude - a.longitude) * t,
        });
      }
    }
    for (const point of sampled) {
      if (hidden(point)) flush();
      else run.push(point);
    }
    flush();
  }
  return out;
}

/** The right-hand sideways shift of a pixel polyline, as native's TrailRouteShareCueGeometry.offsetToTheRight. */
export function offsetToTheRight(points: Pixel[], pixels: number): Pixel[] {
  if (points.length < 2) return points;
  return points.map((point, index) => {
    const before = points[Math.max(index - 1, 0)];
    const after = points[Math.min(index + 1, points.length - 1)];
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length = Math.hypot(dx, dy);
    // Image y grows downward, so the right-hand normal of travel (dx, dy) is (-dy, dx).
    return length === 0
      ? point
      : {
          x: point.x - (dy / length) * pixels,
          y: point.y + (dx / length) * pixels,
        };
  });
}

/** Greedy word wrap with a supplied measure, so it can be tested without a canvas. */
export function wrapText(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= maxWidth || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Fits points into a rectangle, keeping the aspect ratio; north is up. */
export function fitProjection(
  points: Point[],
  box: { x: number; y: number; width: number; height: number },
  padding: number,
): (point: Point) => Pixel {
  const mid =
    points.reduce((sum, p) => sum + p.latitude, 0) / Math.max(1, points.length);
  const kx = Math.cos(mid * toRadians);
  const xs = points.map((p) => p.longitude * kx);
  const ys = points.map((p) => p.latitude);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const scale = Math.min(
    (box.width - padding * 2) / spanX,
    (box.height - padding * 2) / spanY,
  );
  const offsetX = box.x + (box.width - spanX * scale) / 2;
  const offsetY = box.y + (box.height - spanY * scale) / 2;
  return (point) => ({
    x: offsetX + (point.longitude * kx - minX) * scale,
    y: offsetY + (maxY - point.latitude) * scale,
  });
}

const frame = (points: Point[]) => {
  const lats = points.map((p) => p.latitude);
  const lons = points.map((p) => p.longitude);
  return {
    south: Math.min(...lats),
    north: Math.max(...lats),
    west: Math.min(...lons),
    east: Math.max(...lons),
  };
};

export function planImage(
  input: ImageInput,
  measure: (text: string, size: number, bold: boolean) => number,
): ImagePlan {
  const radius = input.radiusMeters ?? PRIVACY_RADIUS_METERS;
  const allPoints = input.pieces.flatMap((p) => p.points);
  if (allPoints.length < 2) throw new Error("There is no route to draw.");
  const first = allPoints[0];
  const last = allPoints[allPoints.length - 1];
  const pieces = (
    input.exact
      ? input.pieces
      : hideEndpoints(input.pieces, first, last, radius)
  ).filter((piece) => piece.isRouted && piece.points.length >= 2);
  if (!pieces.length)
    throw new Error(
      "This route is too short to draw while hiding exact endpoints.",
    );
  const drawn = pieces.flatMap((p) => p.points);
  const box = frame(drawn);
  // Aspect of the picture follows the route's own shape, within limits that keep it a usable image.
  const aspect =
    (box.north - box.south) /
      Math.max(
        1e-9,
        (box.east - box.west) *
          Math.cos(((box.north + box.south) / 2) * toRadians),
      ) || 1;
  const innerWidth = IMAGE_WIDTH - MARGIN * 2;
  const text = (value: string, size: number, bold: boolean, width: number) =>
    wrapText(value, width, (t) => measure(t, size, bold));
  // Decided here, at the boundary, so no caller can paint a saved title (endpoint labels or rider-typed text) while the
  // endpoints are meant to be private.
  const title = text(
    input.exact ? input.title : PRIVATE_IMAGE_TITLE,
    64,
    true,
    innerWidth,
  ).slice(0, 2);
  const summary = text(input.summary, 32, false, innerWidth).slice(0, 3);
  // The header is as tall as its words: name, title lines, summary lines, and a little air before the map.
  const header = 130 + (title.length - 1) * 70 + 24 + summary.length * 42 + 30;
  const mapHeight = Math.round(
    Math.min(MAP_MAX, Math.max(MAP_MIN, innerWidth * aspect)),
  );
  const map = { x: MARGIN, y: header, width: innerWidth, height: mapHeight };
  const project = fitProjection(drawn, map, 70);

  // Context trails that come near the drawn route, so the picture shows where it is without a basemap.
  const margin =
    Math.max(box.north - box.south, box.east - box.west) * 0.35 + 0.002;
  // Under the privacy rule the trails around the route are trimmed exactly like the route, so nothing drawn enters a
  // hidden circle (a trail through the start would otherwise show where the start is).
  const contextLines = input.exact
    ? input.context
    : hideAround(input.context, first, last, radius);
  const context = contextLines
    .filter((line) =>
      line.some(
        (p) =>
          p.latitude >= box.south - margin &&
          p.latitude <= box.north + margin &&
          p.longitude >= box.west - margin &&
          p.longitude <= box.east + margin,
      ),
    )
    .map((line) => line.map(project));

  const runs: DrawnRun[] = [];
  const chevrons: ImagePlan["chevrons"] = [];
  for (const piece of pieces) {
    let pixels = piece.points.map(project);
    const second = piece.repeatsEarlierTravel;
    if (second) pixels = offsetToTheRight(pixels, SECOND_PASS_OFFSET_PX);
    runs.push({ pixels, type: piece.type, roles: piece.roles, second });
    for (const chevron of chevronsAlong(pixels, IMAGE_CHEVRON_SPACING_PX))
      chevrons.push({ chevron, second });
  }

  const visible = (point: Point) =>
    input.exact ||
    (metersBetween(first, point) > radius + 50 &&
      metersBetween(last, point) > radius + 50);
  const turnarounds = input.turnarounds
    .filter((turn) => visible(turn.point))
    .map((turn) => ({
      pixel: project(turn.point),
      label: "Turn around",
    }));
  const markers: ImagePlan["markers"] = [];
  if (input.exact) {
    const together = metersBetween(first, last) < 30;
    markers.push({
      pixel: project(first),
      label: together ? "Start / Finish" : "Start",
    });
    if (!together) markers.push({ pixel: project(last), label: "Finish" });
  }

  // Notices and credit are never cut short: the picture grows to hold all of them.
  const warnings = input.warnings.map((w) => text(w, 28, false, innerWidth));
  const attribution = text(input.attribution, 24, false, innerWidth);
  const footerTop = map.y + map.height + 36;
  const warningHeight = warnings.reduce(
    (sum, lines) => sum + lines.length * 38 + 14,
    0,
  );
  const height = Math.ceil(
    footerTop + warningHeight + attribution.length * 32 + 56,
  );
  return {
    width: IMAGE_WIDTH,
    height,
    map,
    title,
    summary,
    warnings,
    attribution,
    context,
    runs,
    chevrons,
    turnarounds,
    markers,
    footerTop,
  };
}

const ACCENT = "#08725f";
const routeColor = (run: DrawnRun) =>
  run.roles.includes("ProposedTrails")
    ? "#7851a9"
    : run.type === "Access"
      ? "#4d6888"
      : run.roles.includes("SharedRoadways")
        ? "#68718b"
        : run.roles.includes("ParkConnectors")
          ? "#63a375"
          : ACCENT;

function stroke(
  ctx: CanvasRenderingContext2D,
  pixels: Pixel[],
  color: string,
  width: number,
  dash: number[] = [],
) {
  if (pixels.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(pixels[0].x, pixels[0].y);
  for (const p of pixels.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function chevron(ctx: CanvasRenderingContext2D, c: Chevron, doubled: boolean) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.angle);
  const offsets = doubled ? [-12, 10] : [0];
  for (const [color, width] of [
    ["rgba(0,0,0,0.8)", 8],
    ["#ffffff", 4],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const x of offsets) {
      ctx.beginPath();
      ctx.moveTo(x - 9, -12);
      ctx.lineTo(x + 5, 0);
      ctx.lineTo(x - 9, 12);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function label(
  ctx: CanvasRenderingContext2D,
  wanted: Pixel,
  text: string,
  bounds: { x: number; y: number; width: number; height: number },
  glyph?: string,
) {
  ctx.font = "700 26px system-ui, sans-serif";
  const body = glyph ? `${glyph} ${text}` : text;
  const width = ctx.measureText(body).width + 22;
  // Kept wholly inside the map: a sign at the edge of the route slides in rather than being cut off.
  const at = {
    x: Math.min(
      Math.max(wanted.x, bounds.x + width / 2 + 6),
      bounds.x + bounds.width - width / 2 - 6,
    ),
    y: Math.min(
      Math.max(wanted.y, bounds.y + 26),
      bounds.y + bounds.height - 26,
    ),
  };
  const x = at.x - width / 2;
  const y = at.y - 20;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#212121";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(x, y, width, 40, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#212121";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(body, at.x, at.y + 1);
  ctx.textAlign = "start";
}

/** Paints the plan. Nothing here decides what is shown. */
export function drawImage(ctx: CanvasRenderingContext2D, plan: ImagePlan) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, plan.width, plan.height);
  // Header: accent bar, the app's name, the route's title and summary.
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, plan.width, 12);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = ACCENT;
  ctx.font = "700 28px system-ui, sans-serif";
  ctx.fillText("Trail Mapper", MARGIN, 58);
  ctx.fillStyle = "#14201c";
  ctx.font = "700 64px system-ui, sans-serif";
  plan.title.forEach((line, i) => ctx.fillText(line, MARGIN, 130 + i * 70));
  ctx.fillStyle = "#4a5a54";
  ctx.font = "400 32px system-ui, sans-serif";
  const summaryTop = 130 + (plan.title.length - 1) * 70 + 52;
  plan.summary.forEach((line, i) =>
    ctx.fillText(line, MARGIN, summaryTop + i * 42),
  );

  // The map area: a quiet ground, the trails around the route, then the route and its cues.
  const { map } = plan;
  ctx.fillStyle = "#eef4ef";
  ctx.fillRect(map.x, map.y, map.width, map.height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(map.x, map.y, map.width, map.height);
  ctx.clip();
  for (const line of plan.context) stroke(ctx, line, "#c6d6cb", 5);
  for (const run of plan.runs)
    stroke(ctx, run.pixels, "rgba(255,255,255,0.95)", 22);
  for (const run of plan.runs) {
    const dash =
      run.type === "Access"
        ? [18, 14]
        : run.roles.includes("ProposedTrails")
          ? [14, 14]
          : run.roles.includes("SharedRoadways")
            ? [8, 10]
            : [];
    stroke(ctx, run.pixels, routeColor(run), 12, dash);
  }
  for (const { chevron: c, second } of plan.chevrons) chevron(ctx, c, second);
  for (const turn of plan.turnarounds)
    label(
      ctx,
      { x: turn.pixel.x, y: turn.pixel.y - 44 },
      turn.label,
      map,
      "↩",
    );
  for (const marker of plan.markers) {
    ctx.fillStyle = marker.label === "Finish" ? ACCENT : "#ffffff";
    ctx.strokeStyle = "#093b33";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(marker.pixel.x, marker.pixel.y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    label(
      ctx,
      { x: marker.pixel.x, y: marker.pixel.y - 38 },
      marker.label,
      map,
    );
  }
  ctx.restore();
  ctx.strokeStyle = "#b9c9bf";
  ctx.lineWidth = 2;
  ctx.strokeRect(map.x, map.y, map.width, map.height);

  // Notices and credit.
  let y = plan.footerTop + 20;
  ctx.fillStyle = "#7a3a00";
  ctx.font = "400 28px system-ui, sans-serif";
  for (const lines of plan.warnings) {
    lines.forEach((line, i) => ctx.fillText(line, MARGIN, y + i * 38));
    y += lines.length * 38 + 14;
  }
  ctx.fillStyle = "#4a5a54";
  ctx.font = "400 24px system-ui, sans-serif";
  plan.attribution.forEach((line, i) =>
    ctx.fillText(line, MARGIN, y + 20 + i * 32),
  );
}

/** Renders the picture to a PNG. No network is used: everything drawn is already on this device. */
export async function renderImage(input: ImageInput): Promise<Blob> {
  const probe = document.createElement("canvas").getContext("2d")!;
  const measure = (text: string, size: number, bold: boolean) => {
    probe.font = `${bold ? 700 : 400} ${size}px system-ui, sans-serif`;
    return probe.measureText(text).width;
  };
  const plan = planImage(input, measure);
  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  drawImage(canvas.getContext("2d")!, plan);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("The image could not be created.")),
      "image/png",
    ),
  );
}
