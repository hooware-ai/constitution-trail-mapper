import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  readFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { gzipSync } from "node:zlib";
import {
  listenDistServer,
  socketOwnership,
} from "../../tools/lib/dist-server.mjs";
import { freeBrowserPortRange } from "../../tools/lib/browser-port.mjs";

const webRoot = fileURLToPath(new URL("../../", import.meta.url));
const close = (server: Server) =>
  new Promise<void>((resolve) => server.close(() => resolve()));
async function collision(port: number) {
  const contender = createServer();
  try {
    await assert.rejects(
      new Promise<void>((resolve, reject) => {
        contender.once("error", reject);
        contender.listen(port, "127.0.0.1", resolve);
      }),
      { code: "EADDRINUSE" },
    );
  } finally {
    if (contender.listening) await close(contender);
  }
}

test("preparing artifacts own their listener, hide stale files, and become ready without rebinding", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trail-server-control-"));
  const port = await freeBrowserPortRange();
  let ready = false;
  const server = await listenDistServer({
    port,
    directory,
    isReady: () => ready,
  });
  const url = `http://127.0.0.1:${port}`;
  try {
    await writeFile(join(directory, "index.html"), "stale artifact");
    const pending = await fetch(url);
    assert.equal(pending.status, 503);
    assert.equal(pending.headers.get("cache-control"), "no-store");
    assert.equal(await pending.text(), "Artifact is being prepared");
    await collision(port);
    const ownership = socketOwnership(port);
    if (process.platform === "linux" && spawnSync("ss", ["-V"]).status === 0) {
      assert.equal(ownership.available, true);
      assert(ownership.states.includes("LISTEN"));
    }
    const content = "fresh artifact ".repeat(100);
    await writeFile(join(directory, "index.html"), content);
    ready = true;
    const response = await fetch(url + "/route", {
      headers: { accept: "text/html" },
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), content);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(
      response.headers.get("content-security-policy") ?? "",
      /worker-src/,
    );
    const head = await fetch(url, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal(
      (
        await fetch(url + "/assets/missing.js", {
          headers: { accept: "text/html" },
        })
      ).status,
      404,
    );
    assert.equal((await fetch(url + "/%")).status, 400);
    // Fetch decodes gzip automatically; also check that compression was actually selected.
    const compressed = await fetch(url, {
      headers: { "accept-encoding": "gzip" },
    });
    assert.equal(compressed.headers.get("content-encoding"), "gzip");
    assert.equal(await compressed.text(), content);
    assert(gzipSync(content).length < content.length);
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
  const replacement = await listenDistServer({ port, directory });
  await close(replacement);
});

test("busy county startup refuses before preparing files and leaves the other owner intact", async () => {
  const port = await freeBrowserPortRange();
  const owner = createServer((_request, response) =>
    response.end("independent owner"),
  );
  await new Promise<void>((resolve) =>
    owner.listen(port, "127.0.0.1", resolve),
  );
  const work = join(webRoot, "generated", "synthetic-review");
  await mkdir(work, { recursive: true });
  const marker = join(work, `ownership-control-${process.pid}.txt`);
  await writeFile(marker, "must survive refusal");
  try {
    const child = spawn(
      process.execPath,
      ["tests/support/serve-county.mjs", "--port", String(port)],
      { cwd: webRoot },
    );
    let output = "";
    child.stdout.on("data", (data) => (output += data));
    child.stderr.on("data", (data) => (output += data));
    const [status, signal] = await once(child, "close");
    assert.equal(status, 1);
    assert.equal(signal, null);
    assert.match(output, /EADDRINUSE/);
    assert.match(output, /socket ownership/);
    assert.doesNotMatch(output, /Built |Serving county|packaged|VITE/);
    assert.equal(await readFile(marker, "utf8"), "must survive refusal");
    assert.equal(
      await (await fetch(`http://127.0.0.1:${port}`)).text(),
      "independent owner",
    );
  } finally {
    await close(owner);
    await rm(marker, { force: true });
  }
});

test(
  "failed county build serves only 503 during preparation and releases its owned listener",
  { skip: process.platform === "win32" },
  async () => {
    const port = await freeBrowserPortRange();
    const commands = await mkdtemp(join(tmpdir(), "trail-build-control-"));
    await symlink(process.execPath, join(commands, "node"));
    // Fault injection at the existing child-command boundary, with no application test override.
    await writeFile(
      join(commands, "npx"),
      '#!/usr/bin/env node\nconsole.log("CONTROL_BUILD_HELD");process.stdin.once("data",()=>process.exit(19));process.stdin.resume();\n',
      { mode: 0o755 },
    );
    const child = spawn(
      process.execPath,
      ["tests/support/serve-county.mjs", "--port", String(port)],
      { cwd: webRoot, env: { ...process.env, PATH: commands } },
    );
    let output = "";
    const ended = once(child, "close");
    const held = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Controlled build did not start within 10s")),
        10000,
      );
      child.stdout.on("data", (data) => {
        output += data;
        if (output.includes("CONTROL_BUILD_HELD")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.stderr.on("data", (data) => (output += data));
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", () => {
        clearTimeout(timer);
        if (!output.includes("CONTROL_BUILD_HELD")) reject(new Error(output));
      });
    });
    try {
      await held;
      const response = await fetch(`http://127.0.0.1:${port}/provenance.json`);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "no-store");
      await collision(port);
      child.stdin.end("fail build\n");
      const [status, signal] = await ended;
      assert.equal(status, 19);
      assert.equal(signal, null);
      assert.match(output, /serve-county: build failed/);
      assert.doesNotMatch(output, /Serving county/);
      const replacement = await listenDistServer({ port, directory: commands });
      await close(replacement);
    } finally {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await ended;
      }
      await rm(commands, { recursive: true, force: true });
    }
  },
);
