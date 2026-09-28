"""Job: Verify generated routing assets are replaced only after a complete write, in each available PowerShell."""
import shutil
import subprocess
import tempfile
from pathlib import Path
import unittest


HELPER = Path(__file__).resolve().parents[1] / "Write-GeneratedAsset.ps1"
SHELLS = [shell for shell in ("powershell", "pwsh") if shutil.which(shell)]
PREVIOUS = '{"previous":true}'


def run_powershell(shell, script):
    command = [shell, "-NoProfile", "-NonInteractive"]
    if shell == "powershell":
        command += ["-ExecutionPolicy", "Bypass"]
    command += ["-Command", f". '{HELPER}'; $ErrorActionPreference = 'Stop'; {script}"]
    return subprocess.run(command, capture_output=True, text=True, timeout=120)


@unittest.skipUnless(SHELLS, "PowerShell is not installed")
class WriteGeneratedAssetTests(unittest.TestCase):
    def setUp(self):
        self.directory = Path(tempfile.mkdtemp())
        self.asset = self.directory / "asset.normalized.json"
        self.temporary = Path(f"{self.asset}.tmp")

    def tearDown(self):
        shutil.rmtree(self.directory, ignore_errors=True)

    def test_replaces_an_existing_asset_with_the_same_bytes_as_the_previous_pipeline(self):
        for shell in SHELLS:
            with self.subTest(shell=shell):
                self.asset.write_text(PREVIOUS, encoding="utf-8")
                expected = self.directory / "expected.json"
                value = "[ordered]@{ job = 'test'; layers = @(@{ id = 'a'; paths = @(,@(@(-89.0, 40.5), @(-89.1, 40.6))) }) }"
                result = run_powershell(
                    shell,
                    f"$value = {value}; "
                    f"$value | ConvertTo-Json -Depth 100 | Set-Content -Path '{expected}' -Encoding UTF8; "
                    f"Write-GeneratedAsset -Value $value -Path '{self.asset}'",
                )
                self.assertEqual(0, result.returncode, result.stderr)
                self.assertEqual(expected.read_bytes(), self.asset.read_bytes())
                self.assertFalse(self.temporary.exists())

    def test_creates_a_missing_asset(self):
        for shell in SHELLS:
            with self.subTest(shell=shell):
                self.asset.unlink(missing_ok=True)
                result = run_powershell(shell, f"Write-GeneratedAsset -Value @{{ ok = $true }} -Path '{self.asset}'")
                self.assertEqual(0, result.returncode, result.stderr)
                self.assertIn('"ok"', self.asset.read_text(encoding="utf-8-sig"))
                self.assertFalse(self.temporary.exists())

    def test_serialization_failure_keeps_the_previous_asset(self):
        for shell in SHELLS:
            with self.subTest(shell=shell):
                self.asset.write_text(PREVIOUS, encoding="utf-8")
                # ConvertTo-Json rejects dictionaries with non-string keys.
                result = run_powershell(shell, f"Write-GeneratedAsset -Value @{{ 1 = 'a' }} -Path '{self.asset}'")
                self.assertNotEqual(0, result.returncode)
                self.assertEqual(PREVIOUS, self.asset.read_text(encoding="utf-8"))
                self.assertFalse(self.temporary.exists())

    def test_write_failure_keeps_the_previous_asset(self):
        for shell in SHELLS:
            with self.subTest(shell=shell):
                self.asset.write_text(PREVIOUS, encoding="utf-8")
                # A directory where the temporary file belongs makes the write itself fail.
                self.temporary.mkdir()
                try:
                    result = run_powershell(shell, f"Write-GeneratedAsset -Value @{{ ok = $true }} -Path '{self.asset}'")
                    self.assertNotEqual(0, result.returncode)
                    self.assertEqual(PREVIOUS, self.asset.read_text(encoding="utf-8"))
                    self.assertTrue(self.temporary.is_dir())
                finally:
                    self.temporary.rmdir()


if __name__ == "__main__":
    unittest.main()
