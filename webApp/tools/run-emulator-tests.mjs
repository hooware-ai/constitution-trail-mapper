// Runs the Firestore rules tests against a LOCAL emulator, with no Firebase account, credentials or network project.
//
//   node tools/run-emulator-tests.mjs [test files...]        (default: every tests/rules/*.test.ts)
//   npm run test:rules
//
// It checks for JDK 21+, picks a free loopback port this run owns (the emulator is never reused), writes a throwaway
// emulator config that points at cloud/firestore.rules, and runs the tests inside `firebase emulators:exec` using the
// demo project id `demo-trail-mapper` (the `demo-` prefix means the emulator can never reach a real project).
//
// First use downloads the Firestore emulator jar (about 60 MB) into ~/.cache/firebase/emulators through firebase-tools;
// after that the run works offline. firebase-tools is pinned here and fetched through npx, as docs/google-account-routes.md
// does for the Auth CLI, so no global install and no lockfile change are needed.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FIREBASE_TOOLS = "firebase-tools@15.32.1";
const PROJECT = "demo-trail-mapper";
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
// Gradle uses JAVA_HOME while a bare `java` on PATH may be older: make the one we check the one the emulator uses.
if (env.JAVA_HOME)
  env.PATH = `${join(env.JAVA_HOME, "bin")}${delimiter}${env.PATH}`;
const major = javaMajor(env);
if (major < 21) {
  console.error(
    `The Firestore emulator needs JDK 21 or newer (found ${major || "no java"}). Set JAVA_HOME to a JDK 21+ and retry.`,
  );
  process.exit(2);
}

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(join(webRoot, "tests", "rules"))
      .filter((name) => name.endsWith(".test.ts"))
      .map((name) => `tests/rules/${name}`);
const port = await freePort();
const directory = mkdtempSync(join(tmpdir(), "trail-emulator-"));
const config = join(directory, "firebase.json");
writeFileSync(
  config,
  JSON.stringify({
    firestore: {
      rules: join(webRoot, "cloud", "firestore.rules"),
      indexes: join(webRoot, "cloud", "firestore.indexes.json"),
    },
    emulators: {
      firestore: { host: "127.0.0.1", port },
      ui: { enabled: false },
      singleProjectMode: true,
    },
  }),
);

console.log(
  `Firestore emulator on 127.0.0.1:${port} (project ${PROJECT}), JDK ${major}, ${FIREBASE_TOOLS}`,
);
const command = `node --import tsx --test ${files.join(" ")}`;
const result = spawnSync(
  "npx",
  [
    "--yes",
    FIREBASE_TOOLS,
    "emulators:exec",
    "--only",
    "firestore",
    "--project",
    PROJECT,
    "--config",
    `"${config}"`,
    `"${command}"`,
  ],
  { cwd: webRoot, stdio: "inherit", shell: windows, env },
);
process.exit(result.status ?? 1);
