// How tools/run-emulator-tests.mjs starts the Firestore emulator on each platform: pure, so it can be tested without
// starting anything. Two platform facts it gets right:
//  * Windows exposes the search path as `Path`, and a spread copy of process.env keeps only that spelling. Setting
//    `PATH` beside it (or prepending to an undefined `PATH`) leaves the child without a usable path, so there must be
//    exactly one path variable, in the spelling the platform already used.
//  * On Windows the command goes through a shell, where spaces in paths need quotes; on POSIX it does not, and quote
//    characters would be passed through literally (so a path with spaces is simply one argument).
import { posix, win32 } from "node:path";

const isPathKey = (key) => key.toLowerCase() === "path";

/** A copy of `env` with exactly one path variable, with the JDK's bin directory first when `javaHome` is given. */
export function normalizePath(env, platform, javaHome) {
  const keys = Object.keys(env).filter(isPathKey);
  const spelling = keys[0] ?? (platform === "win32" ? "Path" : "PATH");
  const existing = keys.map((key) => env[key]).find((value) => value) ?? "";
  const copy = Object.fromEntries(
    Object.entries(env).filter(([key]) => !isPathKey(key)),
  );
  // The TARGET platform's path rules, not the ones of the machine running the tests.
  const rules = platform === "win32" ? win32 : posix;
  const parts = [javaHome ? rules.join(javaHome, "bin") : "", existing].filter(
    Boolean,
  );
  copy[spelling] = parts.join(rules.delimiter);
  return copy;
}

const quote = (value, platform) =>
  platform === "win32" ? `"${value}"` : value;

/**
 * The spawn arguments for `npx firebase-tools emulators:exec`. `command` is the single shell command the emulator runs
 * once it is up (it receives FIRESTORE_EMULATOR_HOST).
 */
export function buildInvocation({
  platform = process.platform,
  env,
  config,
  command,
  project,
  firebaseTools,
}) {
  const javaHome = env.JAVA_HOME || undefined;
  return {
    command: "npx",
    args: [
      "--yes",
      firebaseTools,
      "emulators:exec",
      "--only",
      "firestore",
      "--project",
      project,
      "--config",
      quote(config, platform),
      quote(command, platform),
    ],
    options: {
      shell: platform === "win32",
      env: normalizePath(env, platform, javaHome),
    },
  };
}
