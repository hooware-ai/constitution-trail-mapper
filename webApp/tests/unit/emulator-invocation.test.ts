import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInvocation,
  normalizePath,
} from "../../tools/lib/emulator-invocation.mjs";

const common = {
  project: "demo-trail-mapper",
  firebaseTools: "firebase-tools@15.32.1",
  command: "node --import tsx --test tests/rules/saved-library.test.ts",
};

test("Windows: an inherited environment with only `Path` keeps exactly one path variable, JDK first, and never `undefined`", () => {
  const env = {
    Path: "C:\\Windows\\system32;C:\\Program Files\\nodejs",
    JAVA_HOME: "C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.5.11-hotspot",
    SystemRoot: "C:\\Windows",
  };
  const normalized = normalizePath(env, "win32", env.JAVA_HOME);
  const pathKeys = Object.keys(normalized).filter(
    (k) => k.toLowerCase() === "path",
  );
  assert.deepEqual(pathKeys, ["Path"]);
  assert.equal(
    normalized.Path,
    "C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.5.11-hotspot\\bin;C:\\Windows\\system32;C:\\Program Files\\nodejs",
  );
  assert.doesNotMatch(normalized.Path, /undefined/);
  // Nothing else was lost or invented.
  assert.equal(normalized.SystemRoot, "C:\\Windows");
  assert.equal(normalized.PATH, undefined);
});

test("Windows: a PATH spelling is kept as it came, duplicates collapse to one, and a missing path still gets the JDK", () => {
  assert.deepEqual(
    Object.keys(
      normalizePath({ PATH: "C:\\a", Path: "C:\\b" }, "win32", "C:\\jdk"),
    ).filter((k) => k.toLowerCase() === "path"),
    ["PATH"],
  );
  const bare = normalizePath({}, "win32", "C:\\jdk");
  assert.equal(bare.Path, "C:\\jdk\\bin");
  const noJdk = normalizePath({ Path: "C:\\x" }, "win32", undefined);
  assert.equal(noJdk.Path, "C:\\x");
});

test("Windows: the invocation goes through a shell and quotes the paths that contain spaces", () => {
  const invocation = buildInvocation({
    platform: "win32",
    env: { Path: "C:\\Windows", JAVA_HOME: "C:\\Program Files\\jdk-21" },
    config:
      "C:\\Users\\Jesse Donahoo\\AppData\\Local\\Temp\\trail-emulator-1\\firebase.json",
    ...common,
  });
  assert.equal(invocation.command, "npx");
  assert.equal(invocation.options.shell, true);
  assert.deepEqual(invocation.args.slice(0, 8), [
    "--yes",
    "firebase-tools@15.32.1",
    "emulators:exec",
    "--only",
    "firestore",
    "--project",
    "demo-trail-mapper",
    "--config",
  ]);
  assert.equal(
    invocation.args[8],
    '"C:\\Users\\Jesse Donahoo\\AppData\\Local\\Temp\\trail-emulator-1\\firebase.json"',
  );
  assert.equal(invocation.args[9], `"${common.command}"`);
  assert.ok(
    invocation.options.env.Path!.startsWith("C:\\Program Files\\jdk-21\\bin;"),
  );
});

test("POSIX: no shell, no quote characters, and a path with spaces is a single literal argument", () => {
  const config = "/tmp/trail emulator 1/firebase.json";
  const invocation = buildInvocation({
    platform: "linux",
    env: { PATH: "/usr/local/bin:/usr/bin", JAVA_HOME: "/opt/jdk 21" },
    config,
    ...common,
  });
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.args[8], config);
  assert.equal(invocation.args[9], common.command);
  for (const arg of invocation.args) assert.doesNotMatch(arg, /^".*"$/);
  assert.equal(
    invocation.options.env.PATH,
    "/opt/jdk 21/bin:/usr/local/bin:/usr/bin",
  );
  assert.equal(invocation.options.env.Path, undefined);
});

test("POSIX: without JAVA_HOME the inherited PATH is left exactly as it was", () => {
  const invocation = buildInvocation({
    platform: "darwin",
    env: { PATH: "/usr/bin:/bin" },
    config: "/tmp/x/firebase.json",
    ...common,
  });
  assert.equal(invocation.options.env.PATH, "/usr/bin:/bin");
});
