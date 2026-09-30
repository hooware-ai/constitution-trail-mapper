"""Offline safety checks for the reviewed web trail-data extraction."""

import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("fetch-web-review-data.py")
SPEC = importlib.util.spec_from_file_location("web_review_data", SCRIPT)
extractor = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(extractor)


def feature(object_id, system="1", activity="2", facility="3"):
    return {
        "attributes": {
            "OBJECTID": object_id, "FACILITYID": str(object_id),
            "NAME": " Review trail ", "LENGTH": 0.1, "SURFTYPE": "1",
            "loc": "1", "facilitytype": facility,
            "activitytype": activity, "systemname": system,
        },
        "geometry": {"paths": [[[-89.0, 40.5], [-88.999, 40.501]]]},
    }


class WebReviewDataTests(unittest.TestCase):
    def setUp(self):
        values = {
            "SURFTYPE": {"1": "paved"}, "loc": {"1": "All Ages and Abilities"},
            "facilitytype": {"1": "Bike Lane", "3": "Separated Trail", "4": "Shared Lane"},
            "activitytype": {"1": "Bikeway", "2": "Multiuse"},
            "systemname": {"1": "Constitution Trail", "3": "Park Trail", "4": "Other"},
        }
        metadata = {"fields": [
            {"name": name, "domain": {"codedValues": [
                {"code": code, "name": label} for code, label in labels.items()
            ]}} for name, labels in values.items()
        ]}
        status_metadata = {"fields": [{
            "name": "status", "domain": {"codedValues": [
                {"code": "1", "name": "Existing"}, {"code": "2", "name": "Proposed"},
            ]},
        }]}
        branches = [feature(1305)]
        others = [feature(203, "3"), feature(204, "4", "1", "4")]
        licensed = copy.deepcopy(branches + others + [feature(999)])
        for current in branches + others:
            current["attributes"]["status"] = "1"
        proposed = feature(777)
        proposed["attributes"]["status"] = "2"
        self.source = {
            "licenseItem": {
                "id": extractor.ITEM_ID, "url": extractor.LICENSED_URL,
                "access": "public", "modified": 1,
                "licenseInfo": f"This work is licensed under {extractor.LICENSE_URL}",
            },
            "licensedMetadata": metadata,
            "licensedQuery": {"features": licensed},
            "selectionSources": {
                "54": {"metadata": copy.deepcopy(status_metadata), "query": {"features": branches + [proposed]}},
                "16": {"metadata": copy.deepcopy(status_metadata), "query": {"features": others}},
            },
        }
        self.manifest = {
            "schemaVersion": 1, "reviewedOn": "2026-09-28",
            "licensedItemId": extractor.ITEM_ID, "licensedSourceUrl": extractor.LICENSED_URL,
            "licensedDomainsSha256": extractor.digest(extractor.domains(metadata)),
            "reviewedFeatureCount": 3, "features": [],
            "excludedUntilVerified": [{"selectionLayerId": 54, "objectIds": [777]}],
        }
        for layer_id, features in ((54, branches), (16, others)):
            for current in features:
                self.manifest["features"].append({
                    "selectionLayerId": layer_id, "objectId": current["attributes"]["OBJECTID"],
                    "geometrySha256": extractor.digest(current["geometry"]["paths"]),
                    "attributesSha256": extractor.attributes_digest(current),
                    "routeRoles": extractor.route_roles(layer_id, current["attributes"]),
                })

    def normalize(self):
        return extractor.normalize(self.manifest, self.source, "2026-09-28T00:00:00+00:00")

    def test_only_reviewed_existing_features_use_licensed_geometry(self):
        result = self.normalize()
        features = result["layers"][0]["features"]
        self.assertEqual({1305, 203, 204}, {item["objectId"] for item in features})
        for item in features:
            original = next(item_ for item_ in self.source["licensedQuery"]["features"]
                            if item_["attributes"]["OBJECTID"] == item["objectId"])
            self.assertIs(original["geometry"]["paths"], item["paths"])
            self.assertEqual("Existing", item["status"])
            self.assertTrue(item["enabledByDefault"])
            self.assertEqual("Review trail", item["name"])
            self.assertEqual(extractor.LICENSED_URL, item["provenance"]["sourceUrl"])
            # The raw values the attributes hash covers travel with the feature so it can be recomputed later.
            raw = item["provenance"]["attributes"]
            self.assertEqual(set(extractor.ATTRIBUTE_FIELDS), set(raw))
            self.assertEqual(item["provenance"]["attributesSha256"], extractor.digest(raw))
            self.assertEqual(item["provenance"]["geometrySha256"], extractor.digest(item["paths"]))
        self.assertEqual("CC BY 4.0", result["sources"]["license"])
        self.assertEqual(extractor.LICENSE_URL, result["sources"]["licenseUrl"])

    def test_canonical_ids_keep_existing_closure_rules_addressable(self):
        features = {item["id"]: item for item in self.normalize()["layers"][0]["features"]}
        self.assertEqual({"54:1305", "16:203", "16:204"}, set(features))
        self.assertEqual(["TrailBranches"], features["54:1305"]["routeRoles"])
        self.assertEqual(["ParkConnectors"], features["16:203"]["routeRoles"])
        self.assertEqual(["SharedRoadways"], features["16:204"]["routeRoles"])
        self.assertEqual(8, features["54:1305"]["sourceLayerId"])
        self.assertEqual(54, features["54:1305"]["provenance"]["selectionLayerId"])

    def test_reordered_sources_have_identical_output(self):
        expected = self.normalize()
        self.source["licensedQuery"]["features"].reverse()
        for value in self.source["selectionSources"].values():
            value["query"]["features"].reverse()
        self.assertEqual(expected, self.normalize())

    def test_changed_geometry_attributes_status_roles_or_domains_fail_closed(self):
        mutations = (
            lambda: self.source["licensedQuery"]["features"][0]["geometry"]["paths"][0][0].__setitem__(0, -88.0),
            lambda: self.source["licensedQuery"]["features"][0]["attributes"].__setitem__("facilitytype", "4"),
            lambda: self.source["selectionSources"]["54"]["query"]["features"][0]["attributes"].__setitem__("status", "2"),
            lambda: self.manifest["features"][0].__setitem__("routeRoles", ["ProposedTrails"]),
            lambda: self.source["licensedMetadata"]["fields"][0]["domain"]["codedValues"][0].__setitem__("name", "changed"),
        )
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                self.setUp()
                mutation()
                with self.assertRaises(ValueError):
                    self.normalize()

    def test_missing_duplicate_or_truncated_sources_are_rejected(self):
        mutations = (
            lambda: self.source["licensedQuery"]["features"].pop(0),
            lambda: self.source["licensedQuery"]["features"].append(self.source["licensedQuery"]["features"][0]),
            lambda: self.source["licensedQuery"].__setitem__("exceededTransferLimit", True),
            lambda: self.source["selectionSources"]["16"]["query"].__setitem__("exceededTransferLimit", True),
            lambda: self.source["selectionSources"]["54"]["query"]["features"].pop(0),
        )
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                self.setUp()
                mutation()
                with self.assertRaises(ValueError):
                    self.normalize()

    def test_reviewed_null_domain_value_preserves_unknown_semantics(self):
        self.source["licensedQuery"]["features"][0]["attributes"]["loc"] = None
        current = self.source["selectionSources"]["54"]["query"]["features"][0]
        current["attributes"]["loc"] = None
        self.manifest["features"][0]["attributesSha256"] = extractor.attributes_digest(current)
        item = next(item for item in self.normalize()["layers"][0]["features"] if item["id"] == "54:1305")
        self.assertIsNone(item["comfortCode"])
        self.assertIsNone(item["comfort"])
    def test_license_must_apply_to_exact_public_source(self):
        for key, value in (("id", "different"), ("url", "https://example.org"),
                           ("licenseInfo", ""), ("access", "private")):
            with self.subTest(key=key):
                self.setUp()
                self.source["licenseItem"][key] = value
                with self.assertRaises(ValueError):
                    self.normalize()

    def test_proposed_feature_cannot_be_allowed_by_pinning_its_hash(self):
        proposed = self.source["selectionSources"]["54"]["query"]["features"][-1]
        self.source["licensedQuery"]["features"].append(copy.deepcopy(proposed))
        self.manifest["features"].append({
            "selectionLayerId": 54, "objectId": 777,
            "geometrySha256": extractor.digest(proposed["geometry"]["paths"]),
            "attributesSha256": extractor.attributes_digest(proposed),
            "routeRoles": ["TrailBranches"],
        })
        self.manifest["reviewedFeatureCount"] += 1
        with self.assertRaisesRegex(ValueError, "no longer existing"):
            self.normalize()

    def test_invalid_geometry_is_rejected_even_with_updated_hashes(self):
        for point in ([200, 40], [-89, 91], [True, 40], ["-89", 40], [-89], [-89, float("inf")]):
            with self.subTest(point=point):
                with self.assertRaises(ValueError):
                    extractor.validate_paths([[point, [-88.999, 40.501]]])

    def test_write_failure_preserves_last_good_asset_and_cleans_temporary(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "asset.json"
            output.write_text("last good asset", encoding="utf-8")
            with patch.object(extractor.json, "dump", side_effect=ValueError("serialization failure")):
                with self.assertRaises(ValueError):
                    extractor.write_output(self.normalize(), output)
            self.assertEqual("last good asset", output.read_text(encoding="utf-8"))
            self.assertEqual([output], list(Path(directory).iterdir()))
            extractor.write_output(self.normalize(), output)
            self.assertEqual(3, json.loads(output.read_text(encoding="utf-8"))["layers"][0]["featureCount"])


if __name__ == "__main__":
    unittest.main()
