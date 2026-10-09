"""Canonical web-review serialization; keeps feature/path order and every value."""
import json
import os
from pathlib import Path
import sys

path = Path(sys.argv[1])
value = json.loads(path.read_text(encoding="utf-8-sig"))
temporary = path.with_name(path.name + ".canonical.tmp")
try:
    temporary.write_text(json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    os.replace(temporary, path)
finally:
    temporary.unlink(missing_ok=True)
