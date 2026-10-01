// Runs the Firestore rules tests against a LOCAL emulator, with no Firebase account, credentials or network project.
//
//   node tools/run-emulator-tests.mjs [test files...]        (default: every tests/rules/*.test.ts)
//   node tools/run-emulator-tests.mjs --prefetch             (only download the pinned emulator, then exit)
//   npm run test:rules
//
// It checks for JDK 21+, picks a free loopback port this run owns (the emulator is never reused), writes a throwaway
// emulator config that points at cloud/firestore.rules, and runs the tests inside `firebase emulators:exec` using the
// demo project id `demo-trail-mapper` (the `demo-` prefix means the emulator can never reach a real project). Credential
// and project variables are removed from the child's environment, so it cannot authenticate even if the caller has them.
//
// Environment (all optional):
//   TRAIL_RULES_FILE         rules to test instead of cloud/firestore.rules (used by the negative controls; never committed)
//   TRAIL_EMULATOR_LOG       also write everything the run prints to this file (hosted runs upload it on failure)
//   TRAIL_EMULATOR_TIMEOUT_MS  stop the run after this long (default 600000); the emulator is stopped and the run fails
//
// First use downloads the Firestore emulator jar (about 60 MB) into ~/.cache/firebase/emulators through the pinned
// firebase-tools (tools/lib/emulator-invocation.mjs); a developer's cache is a convenience, never a requirement.
import { spawn, spawnSync } from "node:child_process";
import {
  createWriteStream,
  mkdtempSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIREBASE_TOOLS,
  PROJECT_ID,
  buildInvocation,
  buildPrefetchInvocation,
  normalizePath,
  withoutCredentials,
} from "./lib/emulator-invocation.mjs";

const webRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const windows = process.platform === "win32";

function javaMajor(env) {
  const java = env.JAVA_HOME ? join(env.JAVA_HOME, "bin", "java") : "java";
  const result = spawnSync(java, ["-version"], {
    encoding: "utf8",
    shell: windows && java === "java",
  });
  const match = /version "(\d+)/.exec(`${result.stderr}${result.stdout}`);
  return match ? Number(match[1]) : 0;
}
function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

const env = { ...process.env, NO_UPDATE_NOTIFIER: "1", CI: "1" };
// Gradle uses JAVA_HOME while a bare `java` on PATH may be older: check, and later run with, the JDK JAVA_HOME names.
const major = javaMajor(normalizePath(env, process.platform, env.JAVA_HOME));
if (major < 21) {
  console.error(
    `The Firestore emulator needs JDK 21 or newer (found ${major || "no java"}). Set JAVA_HOME to a JDK 21+ and retry.`,
  );
  process.exit(2);
}

const logPath = env.TRAIL_EMULATOR_LOG;
const log = logPath ? createWriteStream(logPath) : null;
const say = (text) => {
  process.stdout.write(text);
  log?.write(text);
};
const timeoutMs = Number(env.TRAIL_EMULATOR_TIMEOUT_MS ?? 600_000);

/** Runs a child with output copied to the log, a time limit, and signal forwarding so the emulator is always stopped. */
function run(invocation) {
  return new Promise((done) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: webRoot,
      stdio: ["ignore", "pipe", "pipe"],
      ...invocation.options,
    });
    child.stdout.on("data", (chunk) => say(chunk.toString()));
    child.stderr.on("data", (chunk) => say(chunk.toString()));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      say(`\nTimed out after ${timeoutMs} ms: stopping the emulator run.\n`);
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
    }, timeoutMs);
    const forward = (signal) => () => child.kill(signal);
    for (const signal of ["SIGINT", "SIGTERM"])
      process.on(signal, forward(signal));
    child.on("error", (error) => {
      say(`Could not start: ${error.message}\n`);
      clearTimeout(timer);
      done(1);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done(timedOut ? 124 : (code ?? 1));
    });
  });
}
const finish = (code) => {
  if (log) log.end(() => process.exit(code));
  else process.exit(code);
};

if (process.argv.includes("--prefetch")) {
  say(`Fetching the pinned Firestore emulator through ${FIREBASE_TOOLS}\n`);
  finish(await run(buildPrefetchInvocation({ env: withoutCredentials(env) })));
} else {
  const files = process.argv.slice(2).length
    ? process.argv.slice(2)
    : readdirSync(join(webRoot, "tests", "rules"))
        .filter((name) => name.endsWith(".test.ts"))
        .map((name) => `tests/rules/${name}`);
  const port = await freePort();
  const directory = mkdtempSync(join(tmpdir(), "trail-emulator-"));
  const config = join(directory, "firebase.json");
  const rules = env.TRAIL_RULES_FILE
    ? resolve(env.TRAIL_RULES_FILE)
    : join(webRoot, "cloud", "firestore.rules");
  writeFileSync(
    config,
    JSON.stringify({
      firestore: {
        rules,
        indexes: join(webRoot, "cloud", "firestore.indexes.json"),
      },
      emulators: {
        firestore: { host: "127.0.0.1", port },
        ui: { enabled: false },
        singleProjectMode: true,
      },
    }),
  );
  say(
    `Firestore emulator on 127.0.0.1:${port} (project ${PROJECT_ID}), JDK ${major}, ${FIREBASE_TOOLS}, rules ${rules}\n`,
  );
  finish(
    await run(
      buildInvocation({
        env,
        config,
        command: `node --import tsx --test ${files.join(" ")}`,
      }),
    ),
  );
}
