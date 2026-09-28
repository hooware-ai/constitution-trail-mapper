import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest


script = Path(__file__).resolve().parents[1] / "fetch-verified-trail-additions.py"
spec = importlib.util.spec_from_file_location("verified_trail_additions", script)
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)


class VerifiedTrailAdditionsTests(unittest.TestCase):
    def setUp(self):
        self.way = {
            "id": 1, "version": 2, "timestamp": "2026-09-07T00:00:00Z",
            "tags": {"highway": "path", "surface": "asphalt", "bicycle": "designated"},
            "geometry": [{"lon": -89.0, "lat": 40.5}, {"lon": -89.001, "lat": 40.5}],
        }
        points = [[point["lon"], point["lat"]] for point in self.way["geometry"]]
        self.entry = {
            "wayId": 1, "version": 2,
            "geometrySha256": hashlib.sha256(json.dumps(points, separators=(",", ":")).encode()).hexdigest(),
            "name": "Test path", "routeRole": "ParkConnectors",
            "requiredTags": self.way["tags"].copy(), "bicycleEvidence": "Reviewed bicycle use", "sources": ["https://example.org/opening"],
        }
        self.manifest = {"reviewedOn": "2026-09-07", "attribution": "© OpenStreetMap contributors", "license": "ODbL 1.0", "licenseUrl": "https://www.openstreetmap.org/copyright"}

    def test_changed_version_or_node_geometry_requires_review(self):
        for change in ("version", "geometry"):
            with self.subTest(change=change):
                way = copy.deepcopy(self.way)
                if change == "version":
                    way["version"] += 1
                else:
                    way["geometry"][0]["lon"] += 0.0001
                with self.assertRaises(ValueError):
                    extractor.normalize(self.entry, way, self.manifest)

    def test_restriction_or_future_status_rejects_even_when_required_tags_match(self):
        for tag, value in (("access", "private"), ("vehicle", "no"), ("construction", "path")):
            with self.subTest(tag=tag):
                way = copy.deepcopy(self.way)
                way["tags"][tag] = value
                with self.assertRaises(ValueError):
                    extractor.normalize(self.entry, way, self.manifest)

    def test_reviewed_geometry_is_not_closed_or_extended(self):
        feature = extractor.normalize(self.entry, self.way, self.manifest)
        self.assertEqual([[[-89.0, 40.5], [-89.001, 40.5]]], feature["paths"])
        self.assertEqual("ODbL 1.0", feature["provenance"]["license"])


if __name__ == "__main__":
    unittest.main()
