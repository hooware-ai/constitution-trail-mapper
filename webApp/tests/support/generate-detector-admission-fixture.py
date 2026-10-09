"""Offline fixture driver for the real #105 module, not a duplicate detector implementation.

python generate-detector-admission-fixture.py --detector-dir <checkout>/tools --out <fixture.json>
Producer must match the pinned implementation; no network transport or schedule is used.
"""
import argparse
import hashlib
import json
from pathlib import Path
import tempfile
import sys

PRODUCER_COMMIT = "4dea6720411fbc46d56496fd994fcfc969a39fd3"
parser = argparse.ArgumentParser()
parser.add_argument("--detector-dir", type=Path, required=True)
parser.add_argument("--out", type=Path, required=True)
args = parser.parse_args()
module_path = args.detector_dir / "source_candidates.py"
EXPECTED_PRODUCER_SHA256 = "10da2ac2d74b0a08d317328aba0c23786e60dce5f6cda5b57af1235ed94a1743"
if hashlib.sha256(module_path.read_bytes()).hexdigest() != EXPECTED_PRODUCER_SHA256:
    raise SystemExit("Producer differs from the pinned reviewed detector implementation")
state_path=args.detector_dir / 'source_candidate_state.py'
EXPECTED_STATE_SHA256='91dd78eaf24341aa1b4606191abb7af8df0e32585ad4b724fca9799c770ce347'
if hashlib.sha256(state_path.read_bytes()).hexdigest()!=EXPECTED_STATE_SHA256:
    raise SystemExit('State producer differs from pinned implementation')
sys.path.insert(0,str(args.detector_dir))
import source_candidates as detector
import source_candidate_state as state_store

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
    return {"records": records_a if body["state"] in ("A", "P") else records_b,
            "sourcePublishedAtUtc": "2026-01-01T00:00:00Z",
            "sourceTimes": {"notice": {"publishedAtUtc": "2026-01-01T00:00:00Z"}, "canonicalControls": controls}}

with tempfile.TemporaryDirectory(prefix="genuine-detector-fixture-") as directory:
    results = []
    previous = None
    for index, state in enumerate(["A", "B", "A", "P"], 2):
        raw = detector.canonical({"state": state, **controls})
        result = state_store.run_serialized(source, store=directory, transport=lambda *unused, raw=raw: Response(raw), parser=parse,
            parser_version="synthetic-adapter/1", schema_version=1.0,
            retrieved_at_utc=f"2026-01-0{index}T00:00:00Z", now_seconds=index,
            )
        assert result["status"] == "candidate", result
        text = (Path(directory) / "candidates" / (result["candidate"]["candidateId"] + ".json")).read_text()
        loaded=state_store.load_transition(Path(directory),result['transitionId'])
        assert loaded==result['transition']
        transition_text=(Path(directory)/'transitions'/(result['transitionId']+'.json')).read_text()
        previous_text=None if previous is None else (Path(directory)/'candidates'/(previous['candidateId']+'.json')).read_text()
        results.append({"result": result, "candidateText": text, "currentTransitionText":transition_text, "previousCandidateText":previous_text,
                        "previousObservationText": None if previous is None else (detector.canonical(previous).decode() + "\n")})
        previous = result["observation"]
    assert results[0]["candidateText"] == results[2]["candidateText"]
    assert results[2]["result"]["runDiff"] != results[2]["result"]["candidate"]["diff"]
    output = {"schema": "trail-mapper.detector-admission-fixture/1",
              "producer": {"commit": PRODUCER_COMMIT, "path": "tools/source_candidates.py", "sha256": hashlib.sha256(module_path.read_bytes()).hexdigest(), "stateSha256": hashlib.sha256(state_path.read_bytes()).hexdigest()},
              "source": source, "runs": results}
    args.out.write_bytes(detector.canonical(output) + b"\n")
