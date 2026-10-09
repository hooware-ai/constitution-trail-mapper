import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:net";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  browserPort,
  browserPortRange,
  freeBrowserPortRange,
} from "../../tools/lib/browser-port.mjs";

const webRoot = fileURLToPath(new URL("../../", import.meta.url));
async function bind(port: number): Promise<Server> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}
const close = (server: Server) =>
  new Promise<void>((resolve) => server.close(() => resolve()));

test("default and selected safe browser ports stay usable; known HTTP-blocked ports refuse", () => {
  for (const port of [4173, 4174, 4175, 4186, 4192, 4194, 4196, 65535])
    assert.equal(browserPort(String(port)), port);
  for (const port of [4190, 6000, 6679, 10080])
    assert.throws(
      () => browserPort(port),
      new RegExp(`HTTP port ${port} is browser-blocked`),
    );
});

test("malformed/range-invalid values cannot be silently coerced into a test port", () => {
  for (const value of [
    undefined,
    null,
    "",
    " ",
    "4173.0",
    "1e3",
    "0x104d",
    "-1",
    "NaN",
    Infinity,
    65536,
    0,
    1.5,
  ])
    assert.throws(() => browserPort(value), /decimal integer from 1 to 65535/);
});

test("all six county ports are checked before startup, including the sixth blocked port and overflow", () => {
  assert.equal(browserPortRange(4196, 6), 4196);
  assert.throws(
    () => browserPortRange(4185, 6),
    /TRAIL_TEST_PORT\+5: HTTP port 4190/,
  );
  assert.throws(
    () => browserPortRange(4189, 6),
    /TRAIL_TEST_PORT\+1: HTTP port 4190/,
  );
  assert.throws(() => browserPortRange(65531, 6), /TRAIL_TEST_PORT\+5 must be/);
});

test("automatic allocation skips a sixth-port collision and blocked candidate, releasing every probe socket", async () => {
  const occupiedBase = await freeBrowserPortRange(6);
  const blocker = await bind(occupiedBase + 5);
  const sockets: Server[] = [];
  try {
    let attempts = 0;
    const selected = await freeBrowserPortRange(6, async () => {
      attempts++;
      if (attempts === 1) return 4185;
      if (attempts === 2) return occupiedBase;
      // Prove the failed candidate released its first five probes, then hold
      // them beside the sixth-port blocker so the next range cannot overlap.
      if (sockets.length === 0)
        for (let offset = 0; offset < 5; offset++)
          sockets.push(await bind(occupiedBase + offset));
      return await freeBrowserPortRange(6);
    });
    assert(attempts >= 3 && attempts <= 20);
    assert(selected + 5 < occupiedBase || selected > occupiedBase + 5);
    // The selected six probe sockets must also have been released.
    for (let offset = 0; offset < 6; offset++)
      sockets.push(await bind(selected + offset));
  } finally {
    await Promise.all(sockets.map(close));
    await close(blocker);
  }
});

test("automatic allocation is bounded and does not hide non-port failures", async () => {
  let attempts = 0;
  await assert.rejects(
    freeBrowserPortRange(1, async () => {
      attempts++;
      return 4190;
    }),
    /Could not find 1 adjacent/,
  );
  assert.equal(attempts, 20);
  const failure = new Error("candidate provider failed");
  await assert.rejects(
    freeBrowserPortRange(1, async () => {
      throw failure;
    }),
    failure,
  );
});

test("each Playwright/Vite entry point fails on a blocked port before any browser/server is launched", () => {
  for (const config of [
    "playwright.config.ts",
    "playwright.replay.config.ts",
    "playwright.webkit.config.ts",
    "playwright.dist.config.ts",
    "playwright.county.config.ts",
    "vite.config.ts",
  ]) {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "-e", `import('./${config}')`],
      {
        cwd: webRoot,
        env: { ...process.env, TRAIL_TEST_PORT: "4190" },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    assert.notEqual(result.status, 0, config);
    assert.match(result.stderr, /HTTP port 4190 is browser-blocked/, config);
    assert.equal(result.signal, null, config);
  }
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "-e", "import('./playwright.county.config.ts')"],
    {
      cwd: webRoot,
      env: { ...process.env, TRAIL_TEST_PORT: "4185" },
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.match(result.stderr, /TRAIL_TEST_PORT\+5: HTTP port 4190/);
});

test("direct artifact and county servers reject blocked CLI ports before build or listening", () => {
  for (const script of [
    "tools/serve-dist.mjs",
    "tests/support/serve-county.mjs",
  ]) {
    const result = spawnSync(process.execPath, [script, "--port", "4190"], {
      cwd: webRoot,
      encoding: "utf8",
      timeout: 10000,
    });
    assert.notEqual(result.status, 0, script);
    assert.match(
      result.stderr,
      /--port: HTTP port 4190 is browser-blocked/,
      script,
    );
    assert.equal(result.signal, null, script);
    assert.doesNotMatch(result.stdout, /Built |Serving dist|package-dataset/);
  }
});

test("county allocation count matches every actual default server URL and command", () => {
  const env = { ...process.env };
  delete env.TRAIL_TEST_PORT;
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "-e",
      "import('./playwright.county.config.ts').then(({default:c})=>console.log(JSON.stringify(c.webServer)))",
    ],
    { cwd: webRoot, env, encoding: "utf8", timeout: 10000 },
  );
  assert.equal(result.status, 0, result.stderr);
  const servers = JSON.parse(result.stdout) as Array<{
    url: string;
    command: string;
    reuseExistingServer: boolean;
  }>;
  assert.deepEqual(
    servers.map((s) => Number(new URL(s.url).port)).sort((a, b) => a - b),
    [4175, 4176, 4177, 4178, 4179, 4180],
  );
  for (const server of servers) {
    assert.equal(new URL(server.url).hostname, "127.0.0.1");
    assert(server.command.includes(`--port ${new URL(server.url).port}`));
    assert.equal(server.reuseExistingServer, false);
  }
});
