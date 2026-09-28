"""Job: Render before/after SVG mockups of exercise-route turnaround cues from the #26 spike traces.

Disposable prototype: it reads the committed trace JSON beside it and writes SVGs next to it.
"Before" mirrors today's Android route map (merged polylines and a Start/Finish marker).
"After" adds the proposed cues: a turnaround marker with a label, direction chevrons, an
offset dashed line for a second pass over the same trail, and numbered legs. None of the
cues relies on color alone.
"""
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
PANEL_W, PANEL_H, PAD = 460, 360, 36
ROUTE = "#2e7d32"
REPEAT = "#1565c0"
INK = "#212121"


def project(points, bounds):
    lat0 = (bounds[0] + bounds[1]) / 2
    kx = math.cos(math.radians(lat0))
    xs = [(lon - bounds[2]) * kx for _, lon in [(0, bounds[2]), (0, bounds[3])]]
    width = (bounds[3] - bounds[2]) * kx or 1e-9
    height = (bounds[1] - bounds[0]) or 1e-9
    scale = min((PANEL_W - 2 * PAD) / width, (PANEL_H - 2 * PAD - 20) / height)
    ox = PAD + ((PANEL_W - 2 * PAD) - width * scale) / 2
    oy = PAD + 20 + ((PANEL_H - 2 * PAD - 20) - height * scale) / 2
    del xs
    return [(ox + (lon - bounds[2]) * kx * scale, oy + (bounds[1] - lat) * scale) for lat, lon in points]


def bounds_of(point_lists, around=None, radius_deg=None):
    if around is not None:
        lat, lon = around
        r = radius_deg
        return (lat - r, lat + r, lon - r / math.cos(math.radians(lat)), lon + r / math.cos(math.radians(lat)))
    pts = [p for pl in point_lists for p in pl]
    lats = [p[0] for p in pts]
    lons = [p[1] for p in pts]
    return (min(lats), max(lats), min(lons), max(lons))


def path_d(xy):
    return "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in xy)


def offset(xy, dist):
    out = []
    for i, (x, y) in enumerate(xy):
        a = xy[max(i - 1, 0)]
        b = xy[min(i + 1, len(xy) - 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        n = math.hypot(dx, dy) or 1
        out.append((x - dy / n * dist, y + dx / n * dist))
    return out


def chevrons(xy, every=46):
    marks, carried = [], every / 2
    for (x1, y1), (x2, y2) in zip(xy, xy[1:]):
        seg = math.hypot(x2 - x1, y2 - y1)
        if seg == 0:
            continue
        ux, uy = (x2 - x1) / seg, (y2 - y1) / seg
        d = carried
        while d < seg:
            cx, cy = x1 + ux * d, y1 + uy * d
            tip = (cx + ux * 6, cy + uy * 6)
            left = (cx - ux * 4 - uy * 5, cy - uy * 4 + ux * 5)
            right = (cx - ux * 4 + uy * 5, cy - uy * 4 - ux * 5)
            marks.append(f'<polyline points="{left[0]:.1f},{left[1]:.1f} {tip[0]:.1f},{tip[1]:.1f} {right[0]:.1f},{right[1]:.1f}" '
                         f'fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>')
            d += every
        carried = d - seg
    return marks


def meters(a, b):
    lat = math.radians((a[0] + b[0]) / 2)
    return math.hypot((a[0] - b[0]) * 111_320, (a[1] - b[1]) * 111_320 * math.cos(lat))


def repeated(segment, earlier):
    """A segment is a repeat pass when most of it lies within 6 m of trail already ridden."""
    if not earlier:
        return False
    near = sum(1 for p in segment if any(meters(p, q) < 6 for q in earlier))
    return near >= 0.8 * len(segment)


def densify(points, step_m=5):
    out = [points[0]]
    for a, b in zip(points, points[1:]):
        n = max(1, int(meters(a, b) / step_m))
        out += [(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(1, n + 1)]
    return out


def panel(title, body, x0):
    clip = f"clip{x0}"
    return (f'<g transform="translate({x0},0)"><clipPath id="{clip}"><rect width="{PANEL_W}" height="{PANEL_H}"/></clipPath>'
            f'<rect x="0.5" y="0.5" width="{PANEL_W - 1}" height="{PANEL_H - 1}" fill="#f7f7f2" stroke="#bdbdbd"/>'
            f'<g clip-path="url(#{clip})">' + "".join(body) + "</g>"
            f'<text x="14" y="26" font-size="15" font-weight="600" fill="{INK}">{title}</text></g>')


def start_marker(xy):
    x, y = xy
    return [f'<circle cx="{x:.1f}" cy="{y:.1f}" r="8" fill="white" stroke="{INK}" stroke-width="3"/>',
            f'<text x="{x + 12:.1f}" y="{y + 4:.1f}" font-size="12" fill="{INK}">Start / Finish</text>']


def before_panel(case, bounds):
    body = []
    for poly in case["drawable"]:
        body.append(f'<path d="{path_d(project(poly, bounds))}" fill="none" stroke="{ROUTE}" stroke-width="7" '
                    f'stroke-linecap="round" stroke-linejoin="round"/>')
    body += start_marker(project([case["segments"][0][0]], bounds)[0])
    return body


def point_along(xy, fraction):
    lengths = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(xy, xy[1:])]
    target, walked = sum(lengths) * fraction, 0.0
    for (a, b), length in zip(zip(xy, xy[1:]), lengths):
        if walked + length >= target and length > 0:
            t = (target - walked) / length
            return a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
        walked += length
    return xy[-1]


def legs_between_reversals(segments, reversals):
    """Group the ordered edge segments into legs that end at each reversal point."""
    legs, current = [], []
    for seg in segments:
        current.append(seg)
        if any(meters(seg[-1], r) < 3 for r in reversals):
            legs.append(current)
            current = []
    if current:
        legs.append(current)
    return legs


def after_panel(case, bounds):
    body, ridden, labels = [], [], []
    segments = [seg for seg in case.get("edgeSegments", case["segments"]) if len(seg) >= 2]
    for number, leg in enumerate(legs_between_reversals(segments, case["reversals"]), start=1):
        leg_points = [p for seg in leg for p in seg]
        if len(legs_between_reversals(segments, case["reversals"])) > 1:
            mx, my = point_along(project(leg_points, bounds), 0.35)
            labels.append(f'<circle cx="{mx:.1f}" cy="{my:.1f}" r="9" fill="white" stroke="{INK}" stroke-width="1.5"/>'
                          f'<text x="{mx:.1f}" y="{my + 4:.1f}" font-size="11" text-anchor="middle" fill="{INK}">{number}</text>')
        for seg in leg:
            body += draw_pass(seg, bounds, ridden)
    for lat, lon in case["reversals"]:
        x, y = project([(lat, lon)], bounds)[0]
        right = x < PANEL_W - 120
        body.append(f'<rect x="{x - 10:.1f}" y="{y - 10:.1f}" width="20" height="20" rx="4" fill="white" stroke="{INK}" stroke-width="2.5"/>'
                    f'<path d="M{x + 4:.1f},{y + 5:.1f} L{x + 4:.1f},{y - 2:.1f} A4,4 0 0 0 {x - 4:.1f},{y - 2:.1f} L{x - 4:.1f},{y + 5:.1f}" '
                    f'fill="none" stroke="{INK}" stroke-width="2"/>'
                    f'<path d="M{x - 7:.1f},{y + 2:.1f} L{x - 4:.1f},{y + 6:.1f} L{x - 1:.1f},{y + 2:.1f}" fill="none" stroke="{INK}" stroke-width="2"/>'
                    f'<text x="{x + (14 if right else -14):.1f}" y="{y - 12:.1f}" font-size="12" font-weight="600" fill="{INK}" '
                    f'text-anchor="{"start" if right else "end"}">Turn around</text>')
    body += labels
    body += start_marker(project([segments[0][0]], bounds)[0])
    return body


def draw_pass(seg, bounds, ridden):
    body = []
    xy = project(seg, bounds)
    dense = densify(seg)
    is_repeat = repeated(dense, ridden)
    if is_repeat:
        xy = offset(xy, 7)
        body.append(f'<path d="{path_d(xy)}" fill="none" stroke="{REPEAT}" stroke-width="6" stroke-dasharray="10 6" '
                    f'stroke-linecap="round" stroke-linejoin="round"/>')
    else:
        body.append(f'<path d="{path_d(xy)}" fill="none" stroke="{ROUTE}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>')
    body += chevrons(xy)
    ridden += dense
    return body


def legend(y):
    return (f'<g transform="translate(14,{y})" font-size="12" fill="{INK}">'
            f'<line x1="0" y1="0" x2="28" y2="0" stroke="{ROUTE}" stroke-width="7"/><text x="36" y="4">First pass (chevrons show direction)</text>'
            f'<line x1="270" y1="0" x2="298" y2="0" stroke="{REPEAT}" stroke-width="6" stroke-dasharray="10 6"/><text x="306" y="4">Second pass, offset and dashed</text>'
            f'<rect x="560" y="-9" width="18" height="18" rx="4" fill="white" stroke="{INK}" stroke-width="2.5"/><text x="586" y="4">Turn-around marker</text>'
            f'<circle cx="760" cy="0" r="9" fill="white" stroke="{INK}" stroke-width="1.5"/><text x="760" y="4" font-size="11" text-anchor="middle">1</text><text x="776" y="4">Leg order</text>'
            "</g>")


def write(name, title, case, bounds):
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{PANEL_W * 2 + 20}" height="{PANEL_H + 70}" '
           f'font-family="Segoe UI, Roboto, Arial, sans-serif">'
           f'<rect width="100%" height="100%" fill="white"/>'
           f'<text x="10" y="{PANEL_H + 30}" font-size="13" fill="#555">{title}</text>'
           + panel("Before: today's map", before_panel(case, bounds), 0)
           + panel("After: proposed cues", after_panel(case, bounds), PANEL_W + 20)
           + legend(PANEL_H + 54) + "</svg>")
    (HERE / name).write_text(svg, encoding="utf-8")
    print("wrote", name)


def main():
    synthetic = json.loads((HERE / "fixture-trace.json").read_text(encoding="utf-8"))
    real = json.loads((HERE / "real-trace.json").read_text(encoding="utf-8"))
    for key in ("out-and-back", "lollipop"):
        case = synthetic[key]
        write(f"fixture-{key}.svg", f"Synthetic fixture: {key} (preview zoom)", case, bounds_of(case["segments"]))
    case = real["uptown-circle-5.0"]
    write("real-uptown-5mi-preview.svg", "Real data: 5 mi exercise loop from Uptown Circle (preview zoom)", case,
          bounds_of(case["segments"]))
    rev = case["reversals"][0]
    write("real-uptown-5mi-navigation.svg", "Same route near its reversal (about navigation zoom, 250 m radius)", case,
          bounds_of(None, around=rev, radius_deg=0.00225))


if __name__ == "__main__":
    main()
