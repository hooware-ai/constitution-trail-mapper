"""Fetch only reviewed OSM bicycle paths missing from the county network.

The manifest pins way versions, geometry, and access tags. Changed upstream data
requires a new review rather than silently changing usable routing infrastructure.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parent.parent


def fetch_way(way_id):
    request = urllib.request.Request(
        f"https://api.openstreetmap.org/api/0.6/way/{way_id}/full",
        headers={"User-Agent": "TrailMapperVerifiedTrailExtractor/1.0"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        root = ET.fromstring(response.read())
    nodes = {
        node.attrib["id"]: {
            "lat": float(node.attrib["lat"]),
            "lon": float(node.attrib["lon"]),
        }
        for node in root.findall("node")
    }
    way = root.find("way")
    if way is None or int(way.attrib["id"]) != way_id:
        raise ValueError(f"OSM way {way_id} is missing")
    return {
        "id": way_id,
        "version": int(way.attrib["version"]),
        "timestamp": way.attrib["timestamp"],
        "tags": {tag.attrib["k"]: tag.attrib["v"] for tag in way.findall("tag")},
        "geometry": [nodes[node.attrib["ref"]] for node in way.findall("nd")],
    }


def normalize(entry, way, manifest):
    way_id = entry["wayId"]
    if way["id"] != way_id or way["version"] != entry["version"]:
        raise ValueError(f"OSM way {way_id} changed version; review before updating the manifest")
    tags = way["tags"]
    prohibited = {"no", "private", "customers", "destination", "use_sidepath", "dismount"}
    if any(tags.get(key) in prohibited for key in ("access", "vehicle", "bicycle")):
        raise ValueError(f"OSM way {way_id} restricts bicycle access")
    if tags.get("highway") != "path" or any(key in tags for key in ("construction", "proposed", "disused", "abandoned")):
        raise ValueError(f"OSM way {way_id} is not a reviewed existing path")
    if any(tags.get(key) != value for key, value in entry["requiredTags"].items()):
        raise ValueError(f"OSM way {way_id} changed its reviewed use or surface tags")
    if entry["routeRole"] not in ("TrailBranches", "ParkConnectors"):
        raise ValueError(f"OSM way {way_id} has an unreviewed routing role")
    points = [[point["lon"], point["lat"]] for point in way["geometry"]]
    if len(points) < 2 or any(not all(math.isfinite(value) for value in point) for point in points):
        raise ValueError(f"OSM way {way_id} has invalid geometry")
    digest = hashlib.sha256(json.dumps(points, separators=(",", ":")).encode()).hexdigest()
    if digest != entry["geometrySha256"]:
        raise ValueError(f"OSM way {way_id} geometry changed; review before updating the manifest")
    return {
        "id": f"verified-osm:way:{way_id}",
        "name": entry["name"],
        "status": "Existing",
        "routeRoles": [entry["routeRole"]],
        "facilityType": "Off-Road Trail",
        "comfort": "Unknown",
        "surfaceType": "paved",
        "enabledByDefault": True,
        "paths": [points],
        "provenance": {
            "source": "OpenStreetMap",
            "sourceUrl": f"https://www.openstreetmap.org/way/{way_id}",
            "wayId": way_id,
            "version": way["version"],
            "sourceTimestamp": way["timestamp"],
            "geometrySha256": digest,
            "sourceTags": tags,
            "reviewedOn": manifest["reviewedOn"],
            "bicycleEvidence": entry["bicycleEvidence"],
            "openingSources": entry["sources"],
            "attribution": manifest["attribution"],
            "license": manifest["license"],
            "licenseUrl": manifest["licenseUrl"],
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "data/verified-trail-additions.manifest.json")
    parser.add_argument("--output", type=Path, default=ROOT / "data/generated/verified-trail-additions.normalized.json")
    parser.add_argument("--source-json", type=Path, help="Use a saved OSM elements response for reproducible offline verification")
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8-sig"))
    if manifest["schemaVersion"] != 1:
        raise ValueError("Unsupported manifest version")
    entries = manifest["features"]
    if len({entry["wayId"] for entry in entries}) != len(entries):
        raise ValueError("Duplicate way IDs in the reviewed manifest")
    cached = None
    if args.source_json:
        cached = {way["id"]: way for way in json.loads(args.source_json.read_text(encoding="utf-8-sig"))["elements"]}
    features = [normalize(entry, cached[entry["wayId"]] if cached is not None else fetch_way(entry["wayId"]), manifest) for entry in entries]
    result = {
        "job": "Trail Mapper verified local additions; separate from the unchanged county source",
        "reviewedOn": manifest["reviewedOn"],
        "sources": {"attribution": manifest["attribution"], "license": manifest["license"], "licenseUrl": manifest["licenseUrl"]},
        "layers": [{"id": "verified-osm", "name": "Verified local trail additions", "features": features}],
        "excludedUntilVerified": manifest["excludedUntilVerified"],
    }
    # Complete every source/validation step before replacing the last usable output.
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(args.output)
    print(f"Wrote {len(features)} verified paths to {args.output}")


if __name__ == "__main__":
    main()
