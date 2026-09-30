"""Extract only the reviewed, CC BY 4.0 county trails for local web review.

The output path is fixed under ignored data/generated/. Source changes require
a deliberate manifest review; this command never expands the reviewed network.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import tempfile
import urllib.parse
import urllib.request


ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = ROOT / "data/web-reviewed-trails.manifest.json"
OUTPUT_PATH = ROOT / "data/generated/web-licensed-trails.normalized.json"
ITEM_ID = "a2a54b1f94704061abc90686fbc5c220"
ITEM_URL = f"https://www.arcgis.com/sharing/rest/content/items/{ITEM_ID}?f=json"
LICENSED_URL = "https://www.mcgisweb.org/mcgc/rest/services/OpenData/OpenData/MapServer/8"
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
ATTRIBUTION = "McLean County GIS Consortium (McGIS) and members"
SELECTION_LAYERS = {
    54: "https://www.mcgisweb.org/mcgc/rest/services/Recreation/Trails/MapServer/54",
    16: "https://www.mcgisweb.org/mcgc/rest/services/Recreation/Trails/MapServer/16",
}
ATTRIBUTE_FIELDS = (
    "OBJECTID", "FACILITYID", "NAME", "LENGTH", "SURFTYPE",
    "loc", "facilitytype", "activitytype", "systemname",
)
DOMAIN_FIELDS = {
    "SURFTYPE": ("surfaceTypeCode", "surfaceType"),
    "loc": ("comfortCode", "comfort"),
    "facilitytype": ("facilityTypeCode", "facilityType"),
    "activitytype": ("activityTypeCode", "activityType"),
    "systemname": ("systemNameCode", "systemName"),
}


def digest(value):
    return hashlib.sha256(json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")).hexdigest()


def attributes_digest(feature):
    attributes = feature["attributes"]
    return digest({field: attributes[field] for field in ATTRIBUTE_FIELDS})


def domains(metadata):
    result = {}
    for field in metadata.get("fields", []):
        if field["name"] in DOMAIN_FIELDS:
            values = (field.get("domain") or {}).get("codedValues", [])
            result[field["name"]] = {
                str(value["code"]): value["name"] for value in values
            }
    if set(result) != set(DOMAIN_FIELDS) or any(not values for values in result.values()):
        raise ValueError("Licensed source is missing a required coded-value domain")
    return result


def route_roles(layer_id, attributes):
    roles = []
    if layer_id == 54:
        roles.append("TrailBranches")
        if str(attributes["facilitytype"]) in ("1", "4"):
            roles.append("SharedRoadways")
    elif layer_id == 16:
        if str(attributes["systemname"]) in ("3", "4") and str(attributes["activitytype"]) == "2":
            roles.append("ParkConnectors")
        if str(attributes["systemname"]) == "4" and str(attributes["activitytype"]) == "1":
            roles.append("SharedRoadways")
    return roles


def feature_index(query):
    if query.get("error") or query.get("exceededTransferLimit"):
        raise ValueError("Source query failed or returned an incomplete feature set")
    if not isinstance(query.get("features"), list):
        raise ValueError("Source query has no feature collection")
    indexed = {}
    for feature in query["features"]:
        object_id = feature["attributes"]["OBJECTID"]
        if not isinstance(object_id, int) or isinstance(object_id, bool) or object_id in indexed:
            raise ValueError("Source contains invalid or duplicate object IDs")
        indexed[object_id] = feature
    return indexed


def validate_paths(paths):
    if not isinstance(paths, list) or not paths:
        raise ValueError("Reviewed feature has no paths")
    for path in paths:
        if not isinstance(path, list) or len(path) < 2:
            raise ValueError("Reviewed path needs at least two points")
        for point in path:
            if not isinstance(point, list) or len(point) != 2:
                raise ValueError("Reviewed path must contain longitude/latitude pairs")
            if any(isinstance(value, bool) or not isinstance(value, (int, float))
                   or not math.isfinite(value) for value in point):
                raise ValueError("Reviewed path has invalid coordinates")
            if not (-180 <= point[0] <= 180 and -90 <= point[1] <= 90):
                raise ValueError("Reviewed path coordinates are outside WGS84 bounds")


def normalize(manifest, source, generated_at):
    if manifest.get("schemaVersion") != 1:
        raise ValueError("Unsupported reviewed manifest version")
    if manifest.get("licensedItemId") != ITEM_ID or manifest.get("licensedSourceUrl") != LICENSED_URL:
        raise ValueError("Manifest does not identify the reviewed licensed source")
    item = source["licenseItem"]
    license_info = item.get("licenseInfo") or ""
    if (item.get("id") != ITEM_ID or item.get("url") != LICENSED_URL
            or item.get("access") != "public" or LICENSE_URL not in license_info
            or "This work is licensed" not in license_info):
        raise ValueError("The official item no longer confirms the reviewed CC BY 4.0 grant")
    domain_values = domains(source["licensedMetadata"])
    if digest(domain_values) != manifest["licensedDomainsSha256"]:
        raise ValueError("Licensed field domains changed; review before updating the manifest")
    licensed = feature_index(source["licensedQuery"])
    selections = {}
    for layer_id in SELECTION_LAYERS:
        selected_source = source["selectionSources"][str(layer_id)]
        status_fields = [
            field for field in selected_source["metadata"]["fields"]
            if field["name"] == "status"
        ]
        status_values = {
            str(value["code"]): value["name"]
            for field in status_fields
            for value in (field.get("domain") or {}).get("codedValues", [])
        }
        if status_values.get("1") != "Existing" or status_values.get("2") != "Proposed":
            raise ValueError("Selection source status meanings changed; review is required")
        selections[layer_id] = feature_index(selected_source["query"])

    entries = manifest["features"]
    if not entries or len(entries) != manifest["reviewedFeatureCount"]:
        raise ValueError("Reviewed manifest count does not match its entries")
    seen = set()
    features = []
    for entry in sorted(entries, key=lambda value: (value["selectionLayerId"], value["objectId"])):
        object_id = entry["objectId"]
        layer_id = entry["selectionLayerId"]
        if object_id in seen or layer_id not in SELECTION_LAYERS:
            raise ValueError("Reviewed manifest contains a duplicate ID or unknown layer")
        seen.add(object_id)
        if object_id not in licensed or object_id not in selections[layer_id]:
            raise ValueError(f"Reviewed feature {object_id} is missing upstream")
        feature = licensed[object_id]
        selection = selections[layer_id][object_id]
        attributes = feature["attributes"]
        paths = feature["geometry"]["paths"]
        validate_paths(paths)
        if str(selection["attributes"].get("status")) != "1":
            raise ValueError(f"Reviewed feature {object_id} is no longer existing")
        if (digest(paths) != entry["geometrySha256"]
                or digest(selection["geometry"]["paths"]) != entry["geometrySha256"]
                or attributes_digest(feature) != entry["attributesSha256"]
                or attributes_digest(selection) != entry["attributesSha256"]):
            raise ValueError(f"Reviewed feature {object_id} changed; review before updating the manifest")
        roles = route_roles(layer_id, attributes)
        if not roles or roles != entry["routeRoles"]:
            raise ValueError(f"Reviewed feature {object_id} has different routing roles")
        normalized = {
            "id": f"{layer_id}:{object_id}",
            "sourceLayerId": 8,
            "sourceLayerName": "Trails (McGIS Open Data)",
            "objectId": object_id,
            "facilityId": attributes["FACILITYID"],
            "name": (attributes["NAME"] or "").strip() or None,
            "lengthMiles": attributes["LENGTH"],
            "statusCode": "1",
            "status": "Existing",
            "routeRoles": roles,
            "enabledByDefault": True,
            "paths": paths,
            "provenance": {
                "sourceUrl": LICENSED_URL,
                "license": "CC BY 4.0",
                "licenseUrl": LICENSE_URL,
                "geometrySha256": entry["geometrySha256"],
                "attributesSha256": entry["attributesSha256"],
                # The exact values that hash covers, so packaging and audits can recompute it instead of trusting the label.
                "attributes": {field: attributes[field] for field in ATTRIBUTE_FIELDS},
                "selectionLayerId": layer_id,
                "selectionSourceUrl": SELECTION_LAYERS[layer_id],
                "reviewedOn": manifest["reviewedOn"],
            },
        }
        for field, (code_key, label_key) in DOMAIN_FIELDS.items():
            code = None if attributes[field] is None else str(attributes[field])
            if code is not None and code not in domain_values[field]:
                raise ValueError(f"Reviewed feature {object_id} uses an unknown {field} code")
            normalized[code_key] = code
            normalized[label_key] = domain_values[field].get(code)
        features.append(normalized)
    return {
        "job": "Constitution Trail Mapper reviewed licensed county trails",
        "generatedAtUtc": generated_at,
        "reviewedOn": manifest["reviewedOn"],
        "sources": {
            "attribution": ATTRIBUTION,
            "license": "CC BY 4.0",
            "licenseUrl": LICENSE_URL,
            "licensedItemId": ITEM_ID,
            "licenseEvidenceUrl": ITEM_URL,
            "licenseEvidenceSha256": digest(license_info),
            "licenseItemModified": item.get("modified"),
            "licensedSourceUrl": LICENSED_URL,
            "reviewManifestSha256": digest(manifest),
            # The coded-value meanings the manifest pins by digest (licensedDomainsSha256): decoded labels are checked against them.
            "domains": domain_values,
            "changes": "Reviewed subset selected; attributes decoded and normalized; source geometry retained.",
            "selectionSources": SELECTION_LAYERS,
            "disclaimer": "Source data is for display and reference. Current access and accuracy are not guaranteed.",
        },
        "layers": [{
            "id": 8,
            "name": "Reviewed licensed McGIS trails",
            "url": LICENSED_URL,
            "geometryType": "esriGeometryPolyline",
            "featureCount": len(features),
            "features": features,
        }],
        "excludedUntilVerified": manifest["excludedUntilVerified"],
    }


def fetch_json(url):
    request = urllib.request.Request(url, headers={
        "User-Agent": "ConstitutionTrailMapperWebReviewExtractor/1.0",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(request, timeout=45) as response:
        result = json.load(response)
    if result.get("error"):
        raise ValueError(f"ArcGIS request failed for {url}: {result['error']}")
    return result


def fetch_query(url):
    query = urllib.parse.urlencode({
        "where": "1=1", "outFields": "*", "returnGeometry": "true",
        "outSR": "4326", "f": "json",
    })
    return fetch_json(f"{url}/query?{query}")


def fetch_sources():
    return {
        "licenseItem": fetch_json(ITEM_URL),
        "licensedMetadata": fetch_json(f"{LICENSED_URL}?f=json"),
        "licensedQuery": fetch_query(LICENSED_URL),
        "selectionSources": {
            str(layer_id): {"metadata": fetch_json(f"{url}?f=json"), "query": fetch_query(url)}
            for layer_id, url in SELECTION_LAYERS.items()
        },
    }


def write_output(result, output_path=OUTPUT_PATH):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=output_path.parent,
            prefix=".web-licensed-trails-", suffix=".tmp", delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            json.dump(result, temporary, indent=2, ensure_ascii=False, allow_nan=False)
            temporary.write("\n")
        temporary_path.replace(output_path)
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-json", type=Path,
        help="Read a saved fetch_sources() bundle for reproducible offline verification",
    )
    args = parser.parse_args()
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    source = (json.loads(args.source_json.read_text(encoding="utf-8"))
              if args.source_json else fetch_sources())
    generated_at = datetime.now(timezone.utc).isoformat()
    result = normalize(manifest, source, generated_at)
    write_output(result)
    print(f"Wrote {len(result['layers'][0]['features'])} reviewed licensed trails to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
