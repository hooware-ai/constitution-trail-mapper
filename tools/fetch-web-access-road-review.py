"""Capture and independently audit a fresh endpoint-road review, without admitting it.

Fixed original public sources and selection. Raw bytes stay in ignored generated/;
the unchanged native PowerShell extractor replays those exact responses offline.
Admission and publication approval remain separate manual review steps.
"""
from collections import Counter
import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import urllib.parse
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parent.parent
LAYER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer/8"
OVERPASS = "https://overpass-api.de/api/interpreter"
BBOX = [-89.2, 40.4, -88.9, 40.6]
CLASSES = ["S1400", "S1640", "S1710", "S1730", "S1780", "S1820"]
WHERE = "MTFCC IN ('" + "','".join(CLASSES) + "')"
QUERY = '[out:json][timeout:120];way["highway"="service"](40.4,-89.2,40.6,-88.9);out tags geom;'
SOURCES = dict(tigerwebTransportationService=LAYER.rsplit("/", 1)[0],
               tigerLineAllRoads="https://catalog.data.gov/dataset/tiger-line-shapefile-current-county-mclean-county-il-all-roads",
               openStreetMap="https://www.openstreetmap.org/copyright", openStreetMapOverpass=OVERPASS,
               boundingBoxWgs84=BBOX, includedMtfcc=CLASSES, includedOsmHighways=["service"])


def now():
    return datetime.now(timezone.utc).isoformat()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n")


def validate_response(record, value):
    if record.get("finalUrl") != record["url"]:
        raise ValueError("Source redirected away from the original query URL")
    content_type = record.get("headers", {}).get("Content-Type", "") or ""
    if "json" not in content_type.lower():
        raise ValueError("Source response is not JSON")
    if value.get("error") or value.get("remark"):
        raise ValueError("Source reported an error or incomplete response")


def selection(extra):
    params = dict(where=WHERE, geometry=",".join(map(str, BBOX)),
                  geometryType="esriGeometryEnvelope", inSR=4326,
                  spatialRel="esriSpatialRelIntersects", f="json")
    params.update(extra)
    return LAYER + "/query?" + urllib.parse.urlencode(params)


def snapshot(fetch, label):
    count = fetch(selection(dict(returnCountOnly="true")), label + "-count")["count"]
    reply = fetch(selection(dict(returnIdsOnly="true")), label + "-ids")
    ids = reply["objectIds"]
    if type(count) is not int or count <= 0 or not isinstance(ids, list):
        raise ValueError("TIGER snapshot is empty or malformed")
    if reply.get("exceededTransferLimit") or len(ids) != count or len(set(ids)) != count:
        raise ValueError("Incomplete or duplicate TIGER ID snapshot")
    if any(type(v) is not int for v in ids):
        raise ValueError("Invalid TIGER ID")
    return sorted(ids)


def validate_paths(paths):
    if not isinstance(paths, list) or not paths:
        raise ValueError("Missing geometry")
    for path in paths:
        if not isinstance(path, list) or len(path) < 2:
            raise ValueError("Degenerate path")
        for p in path:
            if (not isinstance(p, list) or len(p) != 2 or any(type(v) not in (int, float) or not math.isfinite(v) for v in p)
                    or abs(p[0]) > 180 or abs(p[1]) > 56):
                raise ValueError("Invalid coordinates for access tiling")
        if len({tuple(p) for p in path}) < 2:
            raise ValueError("Degenerate path")
    # Bounding-box proximity alone would admit a line that misses the selection.
    def intersects(a, b):
        low, high = 0.0, 1.0
        for axis, minimum, maximum in ((0, BBOX[0], BBOX[2]), (1, BBOX[1], BBOX[3])):
            delta = b[axis] - a[axis]
            if delta == 0:
                if not minimum <= a[axis] <= maximum:
                    return False
            else:
                t1, t2 = sorted(((minimum - a[axis]) / delta, (maximum - a[axis]) / delta))
                low, high = max(low, t1), min(high, t2)
                if low > high:
                    return False
        return True
    if not any(intersects(a, b) for path in paths for a, b in zip(path, path[1:])):
        raise ValueError("Road does not intersect the fixed selection bounds")


def text(value):
    return value.strip() or None if isinstance(value, str) else None


def audit(tiger, osm, normalized, timestamp=None):
    layers = normalized["layers"]
    if [str(layer["id"]) for layer in layers] != ["8", "osm-service"]:
        raise ValueError("Layer order changed")
    if normalized["sources"] != SOURCES:
        raise ValueError("Source selection metadata changed")
    if set(normalized) != {"job", "generatedAtUtc", "sources", "layers"} or normalized["job"] != "Trail Mapper normalized ordinary endpoint access roads":
        raise ValueError("Normalized document metadata changed")
    if timestamp and datetime.fromisoformat(normalized["generatedAtUtc"].replace("Z", "+00:00")) != datetime.fromisoformat(timestamp):
        raise ValueError("Normalized timestamp differs from response completion")
    layer_metadata = [dict(id=8, name="Local Roads", url=LAYER, geometryType="esriGeometryPolyline"),
                      dict(id="osm-service", name="OpenStreetMap Service Roads", url=OVERPASS,
                           geometryType="polyline", attribution="OpenStreetMap contributors")]
    for layer, expected_metadata in zip(layers, layer_metadata):
        if {key: value for key, value in layer.items() if key not in ("features", "featureCount")} != expected_metadata:
            raise ValueError("Layer metadata changed")
    if not tiger or not osm.get("elements") or not osm.get("osm3s", {}).get("timestamp_osm_base"):
        raise ValueError("Empty source or missing OSM snapshot timestamp")
    expected = []
    for f in tiger:
        a = f["attributes"]
        if a["MTFCC"] not in CLASSES:
            raise ValueError("Unexpected TIGER class")
        validate_paths(f["geometry"]["paths"])
        expected.append(dict(id=f'8:{a["OBJECTID"]}', sourceLayerId=8, sourceLayerName="Local Roads",
                             objectId=a["OBJECTID"], oid=a.get("OID"), name=text(a.get("NAME")),
                             baseName=text(a.get("BASENAME")), mtfcc=a["MTFCC"], routeType=a.get("RTTYP"),
                             paths=f["geometry"]["paths"]))
    actual = layers[0]["features"]
    if actual != expected:
        raise ValueError("TIGER normalization or order differs from raw source")
    excluded = Counter()
    expected = []
    ids = set()
    for way in osm["elements"]:
        if way.get("type") != "way" or type(way.get("id")) is not int or way["id"] in ids:
            raise ValueError("Invalid or duplicate OSM way")
        ids.add(way["id"])
        tags = way.get("tags", {})
        if tags.get("highway") != "service":
            raise ValueError("Unexpected OSM highway class")
        access, bicycle, service = [tags.get(key, "").lower() for key in ("access", "bicycle", "service")]
        if ((access in ("no", "private") and bicycle not in ("yes", "designated", "permissive"))
                or bicycle in ("no", "private") or service in ("drive-through", "emergency_access")):
            excluded["access-or-service"] += 1
            continue
        path = [[p["lon"], p["lat"]] for p in way["geometry"]]
        if len(path) < 2:
            excluded["fewer-than-two-points"] += 1
            continue
        validate_paths([path])
        road_class = {"parking_aisle": "OSM_PARKING_AISLE", "driveway": "OSM_DRIVEWAY"}.get(service, "OSM_SERVICE")
        expected.append(dict(id=f'osm:way:{way["id"]}', sourceLayerId="osm-service",
                             sourceLayerName="OpenStreetMap Service Roads", objectId=way["id"], oid=way["id"],
                             name=text(tags.get("name")), baseName=None, mtfcc=road_class, routeType=None,
                             osmHighway="service", osmService=tags.get("service"), osmAccess=tags.get("access"),
                             osmBicycle=tags.get("bicycle"), paths=[path]))
    actual = layers[1]["features"]
    if actual != expected:
        raise ValueError("OSM filtering, normalization or response order differs from raw source")
    for layer in layers:
        if not layer["features"] or layer["featureCount"] != len(layer["features"]):
            raise ValueError("Normalized feature count mismatch")
    return dict(layerCounts={str(layer["id"]): len(layer["features"]) for layer in layers},
                osmRawCount=len(ids), osmExclusions=dict(excluded),
                osmBaseTimestamp=osm.get("osm3s", {}).get("timestamp_osm_base"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--responses-from", type=Path, help="Re-audit a completed public-response capture offline; never contacts a server")
    args = parser.parse_args()
    prior = None
    if args.responses_from:
        prior_bytes = (args.responses_from / "capture.json").read_bytes()
        prior = json.loads(prior_bytes)
        if prior.get("status") != "captured-and-audited-not-admitted":
            raise ValueError("Offline re-audit requires a completed capture")
        if not prior.get("normalizedSha256") or not prior.get("orderedResponsesSha256"):
            raise ValueError("Offline re-audit requires the prior reviewed identities")
    archive = ROOT / "data/generated" / ("access-review-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
    archive.mkdir(parents=True, exist_ok=False)
    capture = dict(schemaVersion=1, startedAtUtc=now(), boundingBoxWgs84=BBOX,
                   includedMtfcc=CLASSES, overpassQuery=QUERY, requests=[])
    try:
        if prior:
            capture["offlineReauditOfCaptureSha256"] = sha(prior_bytes)
            (archive / "prior-capture.json").write_bytes(prior_bytes)
        capture["extractorBlob"] = subprocess.check_output(
            ["git", "hash-object", "tools/fetch-tigerweb-access-roads.ps1"], cwd=ROOT, text=True).strip()
        expected_blob = subprocess.check_output(["git", "rev-parse", "HEAD:tools/fetch-tigerweb-access-roads.ps1"], cwd=ROOT, text=True).strip()
        if capture["extractorBlob"] != expected_blob:
            raise ValueError("Native extractor differs from committed HEAD")
        capture["tools"] = []
        tool_paths = ["tools/" + filename for filename in
                      (Path(__file__).name, "replay-access-road-responses.ps1", "canonicalize-access-road-review.py",
                       "fetch-tigerweb-access-roads.ps1", "Write-GeneratedAsset.ps1")]
        tool_paths += ["webApp/tools/compare-access-review.mjs", "webApp/tools/lib/access-package.mjs"]
        for tool_path in tool_paths:
            subprocess.run(["git", "ls-files", "--error-unmatch", tool_path], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
            subprocess.run(["git", "diff", "--quiet", "HEAD", "--", tool_path], cwd=ROOT, check=True)
            raw = (ROOT / tool_path).read_bytes()
            capture["tools"].append(dict(file=tool_path, sha256=sha(raw)))
            archived_tool = archive / tool_path
            archived_tool.parent.mkdir(parents=True, exist_ok=True)
            archived_tool.write_bytes(raw)
        helper = "tools/Write-GeneratedAsset.ps1"
        if subprocess.check_output(["git", "hash-object", helper], cwd=ROOT) != subprocess.check_output(["git", "rev-parse", "HEAD:" + helper], cwd=ROOT):
            raise ValueError("Native serialization helper differs from committed HEAD")
        capture["pythonVersion"] = sys.version
        capture["powershellVersion"] = subprocess.check_output(["pwsh", "-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], text=True).strip()
        capture["workingTreeStatus"] = subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True).splitlines()
        capture["sourceCommit"] = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
        if prior:
            capture["reviewRevisionChange"] = dict(priorSourceCommit=prior["sourceCommit"], priorTools=prior["tools"],
                                                 meaning="Fresh independent review of identical archived public responses; tool revision changes are explicit and never change source or normalized identity.")

        def fetch(url, label):
            if prior:
                candidates = [r for r in prior["requests"] if r["file"] == label + ".json" and r["url"] == url]
                if len(candidates) != 1:
                    raise ValueError("Offline archive does not identify the exact original query")
                record = candidates[0]
                raw = (args.responses_from / record["file"]).read_bytes()
                if record["status"] != 200 or len(raw) != record["bytes"] or sha(raw) != record["sha256"]:
                    raise ValueError("Offline source response failed integrity")
                (archive / record["file"]).write_bytes(raw)
                capture["requests"].append(record)
                value = json.loads(raw)
                if value.get("error") or value.get("remark"):
                    raise ValueError("Archived source reported incomplete data")
                validate_response(record, value)
                return value
            started = now()
            request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "TrailMapperDevelopment/1.0 (local routing-data prototype)"})
            try:
                response = urllib.request.urlopen(request, timeout=180)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                raw = response.read()
                record = dict(url=url, file=label + ".json", startedAtUtc=started,
                              finishedAtUtc=now(), status=response.status, bytes=len(raw), sha256=sha(raw),
                              finalUrl=response.url, headers={key: response.headers.get(key) for key in
                                                             ("Content-Type", "Date", "ETag", "Last-Modified")})
            (archive / record["file"]).write_bytes(raw)
            capture["requests"].append(record)
            write_json(archive / "capture.json", capture)
            if record["status"] != 200:
                capture["status"] = "failed-http-response"
                write_json(archive / "capture.json", capture)
                raise ValueError(f"Public source returned HTTP {record['status']}; response archived, no source admitted")
            value = json.loads(raw)
            if value.get("error") or value.get("remark"):
                raise ValueError("Source reported an error or incomplete response")
            validate_response(record, value)
            print(f'{label}: {len(raw)} bytes {record["sha256"]}', flush=True)
            return value

        metadata = fetch(LAYER + "?f=json", "metadata")
        if metadata.get("geometryType") != "esriGeometryPolyline":
            raise ValueError("TIGER geometry type changed")
        if not metadata.get("advancedQueryCapabilities", {}).get("supportsPagination"):
            raise ValueError("TIGER source no longer supports pagination")
        before = snapshot(fetch, "before")
        tiger = []
        offset = 0
        while True:
            # Match the unchanged extractor's exact URL encoding and parameter order.
            url = (LAYER + "/query?where=" + urllib.parse.quote(WHERE, safe="")
                   + "&geometry=-89.2,40.4,-88.9,40.6&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects"
                   + "&outFields=OBJECTID,OID,NAME,BASENAME,MTFCC,RTTYP&returnGeometry=true&outSR=4326&f=json&orderByFields=OBJECTID"
                   + f"&resultOffset={offset}&resultRecordCount=2000")
            page = fetch(url, f"page-{offset}")
            sr = page.get("spatialReference", {})
            if sr.get("latestWkid", sr.get("wkid")) != 4326:
                raise ValueError("TIGER page is not WGS84")
            features = page["features"]
            if not features and page.get("exceededTransferLimit"):
                raise ValueError("Pagination stalled")
            tiger.extend(features)
            offset += len(features)
            if not page.get("exceededTransferLimit"):
                break
        ids = [f["attributes"]["OBJECTID"] for f in tiger]
        if ids != before:
            raise ValueError("Paginated TIGER IDs differ from complete snapshot or ordering")
        osm = fetch(OVERPASS + "?data=" + urllib.parse.quote(QUERY, safe=""), "overpass")
        if snapshot(fetch, "after") != before:
            raise ValueError("TIGER selection changed during extraction")
        output = archive / "mclean-access-roads.normalized.json"
        capture["normalizationTimestampUtc"] = max(r["finishedAtUtc"] for r in capture["requests"])
        capture["status"] = "responses-captured"
        capture["orderedResponsesSha256"] = sha(json.dumps(
            [[r["file"], r["url"], r["sha256"]] for r in capture["requests"]], separators=(",", ":")).encode())
        if prior:
            if (capture["orderedResponsesSha256"] != prior["orderedResponsesSha256"] or
                    capture["normalizationTimestampUtc"] != prior["normalizationTimestampUtc"] or
                    capture["extractorBlob"] != prior["extractorBlob"] or
                    len(capture["requests"]) != len(prior["requests"])):
                raise ValueError("Offline re-audit changed source identity, timestamp, extractor or response set")
        write_json(archive / "capture.json", capture)
        subprocess.run(["pwsh", "-NoProfile", "-File", str(ROOT / "tools/replay-access-road-responses.ps1"),
                        "-Archive", str(archive), "-OutputPath", str(output)], cwd=ROOT, check=True)
        capture["audit"] = audit(tiger, osm, json.loads(output.read_text(encoding="utf-8-sig")), capture["normalizationTimestampUtc"])
        capture["normalizedSha256"] = sha(output.read_bytes())
        if prior and capture["normalizedSha256"] != prior["normalizedSha256"]:
            raise ValueError("Offline re-audit changed normalized source identity")
        capture["finishedAtUtc"] = now()
        capture["status"] = "captured-and-audited-not-admitted"
        write_json(archive / "capture.json", capture)
        print(json.dumps(dict(archive=str(archive), **capture["audit"], normalizedSha256=capture["normalizedSha256"]), indent=2))
    except BaseException as error:
        capture["status"] = "failed-review"
        capture["failure"] = dict(type=type(error).__name__, reason=str(error), atUtc=now())
        write_json(archive / "capture.json", capture)
        (archive / "mclean-access-roads.normalized.json").unlink(missing_ok=True)
        raise


if __name__ == "__main__":
    main()
