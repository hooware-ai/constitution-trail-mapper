"""Cloud/POSIX-only reproduction and negative pin controls; never a source observer."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[3]
DRIVER = ROOT / "webApp/tests/support/generate-detector-admission-fixture.py"
EXPECTED = ROOT / "webApp/tests/support/detector-admission.fixture.json"


def generate(detector_dir, output):
    return subprocess.run(
        [sys.executable, str(DRIVER), "--detector-dir", str(detector_dir), "--out", str(output)],
        capture_output=True, text=True, timeout=30,
    )


with tempfile.TemporaryDirectory(prefix="verified-detector-fixture-") as directory:
    temporary = Path(directory)
    for name in ("first", "repeat"):
        output = temporary / (name + ".json")
        result = generate(ROOT / "tools", output)
        if result.returncode or output.read_bytes() != EXPECTED.read_bytes():
            raise SystemExit("Pinned genuine producer fixture does not reproduce: " + result.stderr)

    for module in ("source_candidates.py", "source_candidate_state.py"):
        altered = temporary / module
        altered.mkdir()
        for filename in ("source_candidates.py", "source_candidate_state.py"):
            shutil.copyfile(ROOT / "tools" / filename, altered / filename)
        with (altered / module).open("ab") as file:
            file.write(b"\n# Deliberate producer-pin negative control.\n")
        output = altered / "refused.json"
        result = generate(altered, output)
        if not result.returncode or "differs from" not in result.stderr or output.exists():
            raise SystemExit("Changed producer was not refused before fixture generation: " + module)

print(json.dumps({"fixtureReproductions": 2, "changedProducerRefusals": 2,
                  "networkUsed": False, "scheduleActivated": False,
                  "producer": json.loads(EXPECTED.read_text())["producer"]}))
