"""Offline fixture driver for the real #105 module, not a duplicate detector implementation.

python generate-detector-admission-fixture.py --detector-dir <checkout>/tools --out <fixture.json>
Producer must match the pinned implementation; no network transport or schedule is used.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile

PRODUCER_COMMIT = "1c56268ec60a9f58498f4c01aa9574b844c4dffc"
parser = argparse.ArgumentParser()
parser.add_argument("--detector-dir", type=Path, required=True)
parser.add_argument("--out", type=Path, required=True)
args = parser.parse_args()
module_path = args.detector_dir / "source_candidates.py"
EXPECTED_PRODUCER_SHA256 = "6ca6a1cc30858109c6b2400480b6236d937df03ce3470b1d9ba5ce0a5490b7cc"
if hashlib.sha256(module_path.read_bytes()).hexdigest() != EXPECTED_PRODUCER_SHA256:
    raise SystemExit("Producer differs from the pinned reviewed detector implementation")
spec = importlib.util.spec_from_file_location("actual_source_candidates", module_path)
detector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(detector)

class Response:
    status = 200
    def __init__(self, raw):
        self.raw, self.offset = raw, 0
        self.headers = {"Content-Length": str(len(raw))}
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def read(self, count):
        part = self.raw[self.offset:self.offset + count]
        self.offset += len(part)
        return part

source = {
    "sourceId": "synthetic-détecteur-🚴", "url": "https://example.test/detector-fixture",
    "geographicScope": "Self-authored fixture only", "license": "Synthetic",
    "termsUrl": "https://example.test/fixture-terms", "expectedUpdateCadence": "none",
    "reviewOwner": "fixture-reviewer", "limitations": "Not production evidence",
    "manifestPath": "synthetic.manifest.json", "reviewedOn": "2026-01-01",
    "executionApproved": False,
    "fetchLimits": {"timeoutSeconds": 1.0, "maxBytes": 4096, "minIntervalSeconds": 1.0},
}
controls = {"whole": 1.0, "small": 1e-7, "negativeZero": -0.0, "text": "réouverture 🚴", "\ue000": 2, "𐀀": 3}
records_a = {"notice-é": detector.digest({"state": "A", **controls})}
records_b = {"notice-é": detector.digest({"state": "B", **controls}), "notice-retiré": detector.digest("removed fixture")}

def parse(raw):
    body = json.loads(raw)
    return {"records": records_a if body["state"] == "A" else records_b,
            "sourcePublishedAtUtc": "2026-01-01T00:00:00Z",
            "componentHashes": {"synthetic-notice": hashlib.sha256(raw).hexdigest()},
            "sourceTimes": {"notice": {"publishedAtUtc": "2026-01-01T00:00:00Z"}, "canonicalControls": controls}}

with tempfile.TemporaryDirectory(prefix="genuine-detector-fixture-") as directory:
    results = []
    previous = None
    for index, state in enumerate(["A", "B", "A"], 2):
        raw = detector.canonical({"state": state, **controls})
        result = detector.observe(source, transport=lambda *unused, raw=raw: Response(raw), parser=parse,
            parser_version="synthetic-adapter/1", schema_version=1.0,
            retrieved_at_utc=f"2026-01-0{index}T00:00:00Z", now_seconds=index,
            previous=previous, directory=directory)
        assert result["status"] == "candidate", result
        text = (Path(directory) / (result["candidate"]["candidateId"] + ".json")).read_text()
        results.append({"result": result, "candidateText": text,
                        "previousObservationText": None if previous is None else (detector.canonical(previous).decode() + "\n")})
        previous = result["observation"]
    assert results[0]["candidateText"] == results[2]["candidateText"]
    assert results[2]["result"]["runDiff"] != results[2]["result"]["candidate"]["diff"]
    output = {"schema": "trail-mapper.detector-admission-fixture/1",
              "producer": {"commit": PRODUCER_COMMIT, "path": "tools/source_candidates.py", "sha256": hashlib.sha256(module_path.read_bytes()).hexdigest()},
              "source": source, "runs": results}
    args.out.write_bytes(detector.canonical(output) + b"\n")
