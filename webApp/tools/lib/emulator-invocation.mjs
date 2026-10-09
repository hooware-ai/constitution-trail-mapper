// How tools/run-emulator-tests.mjs starts the Firestore emulator on each platform: pure, so it can be tested without
// starting anything. Facts it gets right:
//  * Windows exposes the search path as `Path`, and a spread copy of process.env keeps only that spelling. Setting
//    `PATH` beside it (or prepending to an undefined `PATH`) leaves the child without a usable path, so there must be
//    exactly one path variable, in the spelling the platform already used.
//  * On Windows the command goes through a shell, where spaces in paths need quotes; on POSIX it does not, and quote
//    characters would be passed through literally (so a path with spaces is simply one argument).
//  * The emulator run is local and demo-only: any credential or project variable inherited from a developer's shell
//    or a CI environment is removed from the child's environment, so nothing here can authenticate or reach a project.
import { posix, win32 } from "node:path";

/** The one place the emulator tooling version and demo project id are pinned. */
export const FIREBASE_TOOLS = "firebase-tools@15.32.1";
export const PROJECT_ID = "demo-trail-mapper";

const isPathKey = (key) => key.toLowerCase() === "path";

/** Variables that could point firebase-tools or a Google client at a real account or project. */
const CREDENTIAL_PATTERN =
  /^(GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_CLOUD_PROJECT|GCLOUD_PROJECT|GCP_PROJECT|CLOUDSDK_CORE_PROJECT|FIREBASE_TOKEN|FIREBASE_CONFIG|FIREBASE_PROJECT|FIREBASE_AUTH_EMULATOR_HOST|FIREBASE_SERVICE_ACCOUNT.*|GOOGLE_OAUTH_.*|GOOGLE_CLIENT_.*)$/i;

/** A copy of `env` without credential or project variables (nothing else is touched). */
export function withoutCredentials(env) {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !CREDENTIAL_PATTERN.test(key)),
  );
}

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

function childEnvironment(env, platform) {
  return normalizePath(
    withoutCredentials(env),
    platform,
    env.JAVA_HOME || undefined,
  );
}

/**
 * The spawn arguments for `npx firebase-tools emulators:exec`. `command` is the single shell command the emulator runs
 * once it is up (it receives FIRESTORE_EMULATOR_HOST).
 */
export function buildInvocation({
  platform = process.platform,
  env,
  config,
  command,
  project = PROJECT_ID,
  firebaseTools = FIREBASE_TOOLS,
}) {
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
      env: childEnvironment(env, platform),
    },
  };
}

/**
 * The pinned emulator download as its own step (`setup:emulators:firestore`), so a hosted run can fetch the jar first,
 * with its own time limit and a clear failure, and then run the tests without any network step in the middle.
 */
export function buildPrefetchInvocation({
  platform = process.platform,
  env,
  firebaseTools = FIREBASE_TOOLS,
}) {
  return {
    command: "npx",
    args: ["--yes", firebaseTools, "setup:emulators:firestore"],
    options: {
      shell: platform === "win32",
      env: childEnvironment(env, platform),
    },
  };
}
