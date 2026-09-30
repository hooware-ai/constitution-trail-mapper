// Emulated mobile measurement of the BUILT artifact: transfer size (as a static host with gzip/brotli would send it)
// and startup/route timings on a Pixel 7 profile with CPU and network throttling. These are EMULATOR numbers: they
// size the work and catch regressions, they are not a substitute for physical iPhone Safari / Android Chrome runs (#41).
//
//   node tools/measure-dist.mjs [--runs 5]
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:net";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { chromium, devices } from "@playwright/test";
import { artifactFiles, distDir } from "./lib/provenance.mjs";

const runs = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 5;
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

// Static weight: what a host that compresses would transfer for a cold load.
const files = await artifactFiles();
let raw = 0,
  gzip = 0,
  brotli = 0;
const breakdown = [];
for (const file of files) {
  if (/\.map$/.test(file.path)) continue;
  const bytes = await readFile(join(distDir, ...file.path.split("/")));
  const g = gzipSync(bytes).length,
    b = brotliCompressSync(bytes).length;
  raw += bytes.length;
  gzip += g;
  brotli += b;
  breakdown.push({ path: file.path, raw: bytes.length, gzip: g, brotli: b });
}
breakdown.sort((a, b) => b.raw - a.raw);

const port = await freePort();
const server = spawn(
  process.execPath,
  ["tools/serve-dist.mjs", "--port", String(port)],
  {
    stdio: "ignore",
  },
);
await new Promise((resolve) => setTimeout(resolve, 800));
const browser = await chromium.launch();
const samples = { domContentLoaded: [], interactive: [], firstRoute: [] };
try {
  for (let index = 0; index < runs; index++) {
    const context = await browser.newContext({ ...devices["Pixel 7"] });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    // Roughly a mid-range phone on a good mobile connection: 4x CPU slowdown, 1.6 Mbps down / 750 kbps up, 150 ms RTT.
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    const started = Date.now();
    await page.goto(`http://127.0.0.1:${port}/`, {
      waitUntil: "domcontentloaded",
    });
    samples.domContentLoaded.push(Date.now() - started);
    await page.getByRole("button", { name: /Go somewhere/ }).waitFor();
    samples.interactive.push(Date.now() - started);
    await page.getByRole("button", { name: /Go somewhere/ }).click();
    const choose = async (field, name) => {
      await page
        .getByRole("button", { name: new RegExp("^" + field + ":") })
        .click();
      await page.getByRole("textbox", { name: "Search places" }).fill(name);
      await page
        .getByRole("dialog")
        .getByRole("button", { name: new RegExp(name) })
        .click();
    };
    await choose("Start", "Review trailhead · East");
    await choose("Destination", "Review trailhead · South");
    const route = Date.now();
    await page.getByRole("button", { name: "Find route", exact: true }).click();
    await page
      .getByRole("heading", { name: "Route preview", exact: true })
      .waitFor();
    samples.firstRoute.push(Date.now() - route);
    await context.close();
  }
} finally {
  await browser.close();
  server.kill();
}
const result = {
  measuredAt: new Date().toISOString(),
  profile:
    "Pixel 7 emulation, 4x CPU throttle, 1.6 Mbps / 150 ms RTT, cold cache, fixture network",
  runs,
  staticWeightBytes: {
    raw,
    gzip,
    brotli,
    files: breakdown.length,
    largest: breakdown.slice(0, 5),
  },
  medianMs: {
    domContentLoaded: median(samples.domContentLoaded),
    interactive: median(samples.interactive),
    firstRoutePlan: median(samples.firstRoute),
  },
  allMs: samples,
};
console.log(JSON.stringify(result, null, 2));
