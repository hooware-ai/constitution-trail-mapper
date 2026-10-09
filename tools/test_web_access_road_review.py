"""Negative controls for fresh extraction quality checks (no network)."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("access_review", Path(__file__).with_name("fetch-web-access-road-review.py"))
extractor = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(extractor)
audit, snapshot, validate_paths, BBOX = extractor.audit, extractor.snapshot, extractor.validate_paths, extractor.BBOX


class RoadReviewTests(unittest.TestCase):
    def source(self):
        path = [[-89.1, 40.5], [-89.09, 40.51]]
        tiger = [{"attributes": {"OBJECTID": 1, "MTFCC": "S1400"}, "geometry": {"paths": [path]}}]
        osm = {"osm3s": {"timestamp_osm_base": "2026-10-09T04:02:51Z"}, "elements": [
            {"type": "way", "id": 2, "tags": {"highway": "service", "access": "private", "bicycle": "YES"},
             "geometry": [{"lon": p[0], "lat": p[1]} for p in path]},
            {"type": "way", "id": 3, "tags": {"highway": "service", "access": "private"}},
        ]}
        normalized = {"job": "Trail Mapper normalized ordinary endpoint access roads", "generatedAtUtc": "2026-10-09T04:04:11Z",
            "sources": copy.deepcopy(extractor.SOURCES), "layers": [
            {"id": 8, "name": "Local Roads", "url": extractor.LAYER, "geometryType": "esriGeometryPolyline",
             "featureCount": 1, "features": [{"id": "8:1", "sourceLayerId": 8,
             "sourceLayerName": "Local Roads", "objectId": 1, "oid": None, "name": None,
             "baseName": None, "mtfcc": "S1400", "routeType": None, "paths": [path]}]},
            {"id": "osm-service", "name": "OpenStreetMap Service Roads", "url": extractor.OVERPASS,
             "geometryType": "polyline", "attribution": "OpenStreetMap contributors", "featureCount": 1,
             "features": [{"id": "osm:way:2", "sourceLayerId": "osm-service",
             "sourceLayerName": "OpenStreetMap Service Roads", "objectId": 2, "oid": 2, "name": None,
             "baseName": None, "mtfcc": "OSM_SERVICE", "routeType": None, "osmHighway": "service",
             "osmAccess": "private", "osmBicycle": "YES", "osmService": None, "paths": [path]}]},
        ]}
        return tiger, osm, normalized

    def test_bicycle_allowance_and_private_exclusion(self):
        result = audit(*self.source())
        self.assertEqual(result["layerCounts"], {"8": 1, "osm-service": 1})
        self.assertEqual(result["osmExclusions"], {"access-or-service": 1})

    def test_tampered_geometry(self):
        tiger, osm, normalized = self.source()
        normalized = copy.deepcopy(normalized)
        normalized["layers"][1]["features"][0]["paths"] = [[[-89.099, 40.5], [-89.09, 40.51]]]
        with self.assertRaisesRegex(ValueError, "OSM filtering"):
            audit(tiger, osm, normalized)

    def test_duplicate_osm_way(self):
        tiger, osm, normalized = self.source()
        osm["elements"].append(osm["elements"][0])
        with self.assertRaisesRegex(ValueError, "duplicate OSM"):
            audit(tiger, osm, normalized)

    def test_all_original_exclusions(self):
        for tags in ({"bicycle": "no"}, {"bicycle": "private"}, {"service": "drive-through"},
                     {"service": "emergency_access"}, {"access": "NO"}):
            tiger, osm, normalized = self.source()
            osm["elements"].append({"type": "way", "id": 4, "tags": {"highway": "service", **tags}})
            with self.subTest(tags=tags):
                self.assertEqual(audit(tiger, osm, normalized)["osmExclusions"], {"access-or-service": 2})

    def test_response_redirect_and_type(self):
        for record in ({"url": "original", "finalUrl": "other", "headers": {"Content-Type": "application/json"}},
                       {"url": "original", "finalUrl": "original", "headers": {"Content-Type": "text/html"}}):
            with self.subTest(record=record), self.assertRaises(ValueError):
                extractor.validate_response(record, {})

    def test_empty_osm_and_missing_timestamp(self):
        for change in ({"elements": []}, {"osm3s": {}}):
            tiger, osm, normalized = self.source()
            osm.update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                audit(tiger, osm, normalized)

    def test_source_metadata_change(self):
        tiger, osm, normalized = self.source()
        normalized["sources"]["includedOsmHighways"] = ["residential"]
        with self.assertRaisesRegex(ValueError, "metadata changed"):
            audit(tiger, osm, normalized)

    def test_canonical_serialization_preserves_arrays(self):
        with tempfile.TemporaryDirectory() as directory:
            first, second = Path(directory) / "first.json", Path(directory) / "second.json"
            first.write_text('{"z":1,"features":[{"id":2,"path":[[3,4],[1,2]]},{"id":1}],"a":2}')
            second.write_text('{"a":2,"features":[{"path":[[3,4],[1,2]],"id":2},{"id":1}],"z":1}')
            script = Path(__file__).with_name("canonicalize-access-road-review.py")
            for path in (first, second):
                subprocess.run([sys.executable, str(script), str(path)], check=True)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            self.assertEqual(json.loads(first.read_text())["features"],
                             [{"id": 2, "path": [[3, 4], [1, 2]]}, {"id": 1}])

    def test_layer_order(self):
        tiger, osm, normalized = self.source()
        normalized["layers"].reverse()
        with self.assertRaisesRegex(ValueError, "Layer order"):
            audit(tiger, osm, normalized)

    def test_tampered_access_tag(self):
        tiger, osm, normalized = self.source()
        normalized["layers"][1]["features"][0]["osmAccess"] = "yes"
        with self.assertRaisesRegex(ValueError, "OSM filtering"):
            audit(tiger, osm, normalized)

    def test_geometry_crosses_bounds_without_clipping(self):
        validate_paths([[[-89.3, 40.5], [-88.8, 40.5]]])
        with self.assertRaisesRegex(ValueError, "selection bounds"):
            validate_paths([[[-89.3, 40.3], [-89.2, 40.3]]])

    def test_forbidden_class(self):
        tiger, osm, normalized = self.source()
        tiger[0]["attributes"]["MTFCC"] = "S1100"
        with self.assertRaisesRegex(ValueError, "TIGER class"):
            audit(tiger, osm, normalized)

    def test_invalid_and_degenerate_geometry(self):
        for path in ([[0, 0], [0, 0]], [[0, 0], [float("nan"), 0]], [[0, 0], [0, 57]], [[True, 0], [1, 0]]):
            with self.subTest(path=path), self.assertRaises(ValueError):
                validate_paths([path])

    def test_incomplete_snapshot(self):
        for reply in ({"objectIds": [1]}, {"objectIds": [1, 1]},
                      {"objectIds": [1, 2], "exceededTransferLimit": True}):
            responses = iter([{"count": 2}, reply])
            with self.subTest(reply=reply), self.assertRaises(ValueError):
                snapshot(lambda *_: next(responses), "test")


if __name__ == "__main__":
    unittest.main()
