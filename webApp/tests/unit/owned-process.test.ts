import test from "node:test";
import assert from "node:assert/strict";
import { createConnection, createServer } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runOwned } from "../../tools/lib/owned-process.mjs";

// A stand-in for `npx -> firebase-tools -> emulator`: a launcher that starts a grandchild which listens on a loopback port,
// ignores SIGTERM (a hung descendant), and shares the launcher's stdout pipe. On Windows it goes through cmd.exe, exactly
// like the real invocation, so only a tree-wide stop can release the listener.
const launcher = `
const { spawn } = require("node:child_process");
const port = process.argv[2];
const grandchild = spawn(process.execPath, ["-e", \`
  process.on("SIGTERM", () => {});
  require("node:net").createServer().listen(\${port}, "127.0.0.1", () => console.log("listening"));
  setInterval(() => {}, 1000);
\`], { stdio: "inherit" });
process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
`;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}
const listening = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
async function released(port: number, withinMs: number) {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline) {
    if (!(await listening(port))) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function start() {
  const directory = mkdtempSync(join(tmpdir(), "trail-owned-process-"));
  const script = join(directory, "launcher.cjs");
  writeFileSync(script, launcher);
  const port = await freePort();
  const windows = process.platform === "win32";
  const invocation = {
    command: windows ? "node" : process.execPath,
    args: [windows ? `"${script}"` : script, String(port)],
    options: { shell: windows },
  };
  let output = "";
  const say = (text: string) => {
    output += text;
  };
  const ready = async () => {
    const deadline = Date.now() + 15_000;
    while (!output.includes("listening") && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(
      output.includes("listening"),
      `grandchild never listened: ${output}`,
    );
    assert.equal(await listening(port), true);
  };
  return {
    port,
    invocation,
    say,
    ready,
    output: () => output,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test("a timeout stops the whole owned tree (including a descendant that ignores SIGTERM), releases its listener, and exits 124", async () => {
  const run = await start();
  try {
    const started = Date.now();
    const code = await runOwned(run.invocation, {
      timeoutMs: 4_000,
      graceMs: 1_000,
      say: run.say,
    });
    assert.equal(code, 124, run.output());
    assert.match(run.output(), /Timed out after 4000 ms/);
    // The listener existed (the grandchild really ran) and is gone now; the whole thing is bounded.
    assert.ok(run.output().includes("listening"), run.output());
    assert.equal(await released(run.port, 5_000), true, "listener still bound");
    assert.ok(Date.now() - started < 20_000);
  } finally {
    run.cleanup();
  }
});

test("a cancel (SIGINT / SIGTERM) stops the owned tree, releases the listener, and exits 130 / 143", async () => {
  for (const [reason, expected] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const) {
    const run = await start();
    try {
      const cancel = new AbortController();
      const result = runOwned(run.invocation, {
        timeoutMs: 60_000,
        graceMs: 1_000,
        say: run.say,
        signal: cancel.signal,
      });
      await run.ready();
      cancel.abort(reason);
      assert.equal(await result, expected, run.output());
      assert.equal(
        await released(run.port, 5_000),
        true,
        `${reason}: listener still bound`,
      );
    } finally {
      run.cleanup();
    }
  }
});

test("a child that finishes on its own keeps its exit code and leaves nothing to stop", async () => {
  let output = "";
  const code = await runOwned(
    {
      command: process.execPath,
      args: ["-e", "console.log('done'); process.exit(7)"],
      options: {},
    },
    { timeoutMs: 30_000, say: (text) => (output += text) },
  );
  assert.equal(code, 7);
  assert.match(output, /done/);
});
