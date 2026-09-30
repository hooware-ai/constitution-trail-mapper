// Emulated mobile measurement of the BUILT artifact: transfer size (as a static host with gzip/brotli would send it)
// and startup/route timings on a Pixel 7 profile with CPU and network throttling. These are EMULATOR numbers: they
// size the work and catch regressions, they are not a substitute for physical iPhone Safari / Android Chrome runs (#41).
//
//   node tools/measure-dist.mjs [--runs 5] [--county]
//
// --county measures a county-mode artifact (build one with TRAIL_DATASET=county, or the synthetic lattice from
// `node tests/support/serve-county.mjs --scale 254 --build-only`, and point TRAIL_DIST_DIR at it). It plans between two
// seeded places on the lattice. Numbers from the synthetic lattice size the loading path; they are not county numbers.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:net";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { chromium, devices } from "@playwright/test";
import { artifactFiles, distDir } from "./lib/provenance.mjs";

const runs = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 5;
const countyMode = process.argv.includes("--county");
// Start and destination for --county: `--from lat,lon --to lat,lon`, else the synthetic lattice nodes (0,0) and (5,5)
// (tests/support/county-fixture.mjs scaledList). Both must lie on the artifact's trails.
const coordinates = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  if (index < 0) return fallback;
  const [latitude, longitude] = process.argv[index + 1].split(",").map(Number);
  return { latitude, longitude };
};
const from = coordinates("--from", { latitude: 40.45, longitude: -89.03 });
const to = coordinates("--to", { latitude: 40.475, longitude: -89.0 });
// --loop <miles> (county mode; a preset of 3, 5, 10 or 15) measures making an exercise loop from the start instead.
const loopIndex = process.argv.indexOf("--loop");
const loopMiles = loopIndex > 0 ? Number(process.argv[loopIndex + 1]) : 0;
const seededPlaces = [
  { key: "a", label: "Measured start", createdAt: 1, ...from },
  { key: "b", label: "Measured finish", createdAt: 1, ...to },
];
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
    if (countyMode)
      await page.addInitScript((places) => {
        localStorage.setItem(
          "trail-mapper.county:trail-mapper.web.library.v1",
          JSON.stringify({ version: 1, saved: [], recent: [], places }),
        );
      }, seededPlaces);
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
    await page
      .getByRole("button", {
        name: loopMiles ? /Make an exercise loop/ : /Go somewhere/,
      })
      .click();
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
    await choose(
      "Start",
      countyMode ? "Measured start" : "Review trailhead · East",
    );
    if (loopMiles)
      await page
        .getByRole("button", { name: `${loopMiles} mi`, exact: true })
        .click();
    else
      await choose(
        "Destination",
        countyMode ? "Measured finish" : "Review trailhead · South",
      );
    const route = Date.now();
    await page
      .getByRole("button", {
        name: loopMiles ? "Make loop" : "Find route",
        exact: true,
      })
      .click();
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
  profile: `Pixel 7 emulation, 4x CPU throttle, 1.6 Mbps / 150 ms RTT, cold cache, ${countyMode ? "county-mode artifact" : "fixture network"}`,
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
    [loopMiles ? `${loopMiles}MileLoopPlan` : "firstRoutePlan"]: median(
      samples.firstRoute,
    ),
  },
  allMs: samples,
};
console.log(JSON.stringify(result, null, 2));
