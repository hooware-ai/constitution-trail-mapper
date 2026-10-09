// Proves the emulator security tests can fail: it weakens a THROWAWAY copy of cloud/firestore.rules in many ways (never
// the committed file) and requires the rules test suite to detect every one.
//
//   node tools/rules-negative-control.mjs [--skip-baseline] [--only <name>]
//   npm run test:rules:controls
//
// A permissive or malformed rules file that the suite still passes would make the CI gate meaningless, so each control
// must make `tools/run-emulator-tests.mjs` exit non-zero for the right reason: tests failing (rules accepted but wrong)
// or the emulator refusing to compile the rules (malformed). A baseline run of the unmodified rules comes first, so a
// failing control cannot be blamed on the harness. Same environment as the runner: local emulator, demo project, no
// credentials. Weakened copies live in the OS temp directory and are deleted afterwards.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { controls } from "./lib/rules-controls.mjs";

const webRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rulesPath = join(webRoot, "cloud", "firestore.rules");
const original = readFileSync(rulesPath, "utf8");

function runSuite(rules, log) {
  return spawnSync(
    process.execPath,
    ["tools/run-emulator-tests.mjs", "tests/rules/saved-library.test.ts"],
    {
      cwd: webRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        TRAIL_RULES_FILE: rules,
        TRAIL_EMULATOR_LOG: log,
        TRAIL_EMULATOR_TIMEOUT_MS: "300000",
      },
    },
  );
}
const output = (result) => `${result.stdout ?? ""}${result.stderr ?? ""}`;
const failedTests = (text) => Number(/ℹ fail (\d+)/.exec(text)?.[1] ?? 0);
const ranTests = (text) => /ℹ tests \d+/.test(text);

{
  const only = process.argv.includes("--only")
    ? process.argv[process.argv.indexOf("--only") + 1]
    : null;
  const directory = mkdtempSync(join(tmpdir(), "trail-rules-controls-"));
  let problems = 0;
  try {
    if (!process.argv.includes("--skip-baseline") && !only) {
      const baseline = runSuite(rulesPath, join(directory, "baseline.log"));
      const ok =
        baseline.status === 0 &&
        ranTests(output(baseline)) &&
        failedTests(output(baseline)) === 0;
      console.log(
        `${ok ? "ok  " : "FAIL"} baseline: the unmodified rules pass the suite`,
      );
      if (!ok) {
        console.error(output(baseline).split("\n").slice(-40).join("\n"));
        process.exit(1);
      }
    }
    for (const control of controls.filter((c) => !only || c.name === only)) {
      const weakened = join(directory, `${control.name}.rules`);
      writeFileSync(weakened, control.change(original));
      const result = runSuite(weakened, join(directory, `${control.name}.log`));
      const text = output(result);
      const detected =
        result.status !== 0 &&
        (control.detects === "tests-fail"
          ? ranTests(text) && failedTests(text) > 0
          : /Error compiling rules/.test(text));
      console.log(
        `${detected ? "ok  " : "FAIL"} ${control.name}: ${control.why}` +
          (detected
            ? control.detects === "tests-fail"
              ? ` -> detected (${failedTests(text)} tests failed)`
              : " -> detected (the emulator refused to compile the rules)"
            : ` -> NOT DETECTED (exit ${result.status}, tests ran: ${ranTests(text)}, failed: ${failedTests(text)})`),
      );
      if (!detected) {
        problems++;
        console.error(text.split("\n").slice(-30).join("\n"));
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  if (problems) {
    console.error(`${problems} weakened rules were NOT detected by the suite.`);
    process.exit(1);
  }
  console.log("Every weakened or malformed copy of the rules was detected.");
}
