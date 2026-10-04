import { defineConfig } from "vite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { repoRoot, verifyCoreManifest } from "./tools/lib/core.mjs";
import { verifyPackageDir } from "./tools/lib/dataset-package.mjs";
import { distDir } from "./tools/lib/provenance.mjs";

// Automated runs own their port (TRAIL_TEST_PORT) and fail if it is taken instead of reusing another server.
const port = Number(process.env.TRAIL_TEST_PORT ?? 4173);

// Which dataset a build carries is decided here and nowhere at runtime: a county build has no fixture path.
const datasetKind = process.env.TRAIL_DATASET ?? "fixture";
if (datasetKind !== "fixture" && datasetKind !== "county")
  throw new Error(
    `TRAIL_DATASET must be "fixture" or "county" (got "${datasetKind}").`,
  );
const channel = process.env.TRAIL_CHANNEL ?? "review";
if (channel !== "review" && channel !== "public")
  throw new Error(
    `TRAIL_CHANNEL must be "review" or "public" (got "${channel}").`,
  );
const git = (...args: string[]) => {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
};
const status = git("status", "--porcelain", "--untracked-files=all");
let coreHash: string | null = null;
try {
  coreHash = (await verifyCoreManifest()).inputs.sha256.slice(0, 12);
} catch {
  /* dev servers may run before the core is built; Help then omits it */
}
const buildInfo = {
  commit: git("rev-parse", "--short=12", "HEAD") ?? "unknown",
  dirty: status === null ? null : status.length > 0,
  core: coreHash,
};
// OPT-IN county address index (review builds only). It is never part of a default build: the index is data the owner has not
// approved for any composition, so it is added only when a file is named, only in the review channel, and only if its bytes
// are exactly the pinned index in data/web-address-index.manifest.json. Hash-named, and fetched by the page on demand.
const addressIndexFile = process.env.TRAIL_ADDRESS_INDEX_FILE;
let addressIndex: { file: string; sha256: string; bytes: Buffer } | null = null;
if (addressIndexFile) {
  if (channel !== "review")
    throw new Error(
      "The county address index can only be added to a review build.",
    );
  const bytes = readFileSync(resolve(addressIndexFile));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const pinned = JSON.parse(
    readFileSync(
      resolve(repoRoot, "data/web-address-index.manifest.json"),
      "utf8",
    ),
  ).index.sha256;
  if (sha256 !== pinned)
    throw new Error(
      "The address index is not the one pinned in data/web-address-index.manifest.json.",
    );
  addressIndex = {
    file: `data/address-index.${sha256.slice(0, 12)}.json`,
    sha256,
    bytes,
  };
}
const countyPackage = resolve(
  process.env.TRAIL_COUNTY_DIR ?? "generated/county",
);

// Review data is a loopback-only dev endpoint. It is NEVER a public asset or build input.
export default defineConfig({
  define: {
    __TRAIL_DATASET__: JSON.stringify(datasetKind),
    __TRAIL_CHANNEL__: JSON.stringify(channel),
    __TRAIL_BUILD__: JSON.stringify(buildInfo),
    __TRAIL_ADDRESS_INDEX__: JSON.stringify(
      addressIndex
        ? { file: addressIndex.file, sha256: addressIndex.sha256 }
        : null,
    ),
  },
  build: { outDir: distDir, emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    fs: { allow: [".."] },
  },
  preview: { host: "127.0.0.1", port, strictPort: true },
  resolve: {
    alias: {
      "@trail-core": resolve(
        "../webBridge/build/dist/js/productionLibrary/TrailMapper-webBridge.mjs",
      ),
    },
  },
  worker: { format: "es" },
  plugins: [
    {
      // A production bundle must never silently contain a Kotlin core that does not match the current sources.
      name: "verify-kotlin-core",
      apply: "build",
      async buildStart() {
        await verifyCoreManifest();
      },
    },
    {
      // Emits the verified county package next to the app. The private extract is never a build input: only the
      // hash-checked package produced by tools/package-dataset.mjs, and only when this is a county build.
      name: "county-dataset-assets",
      apply: "build",
      async generateBundle() {
        if (datasetKind !== "county") return;
        let verified;
        try {
          verified = await verifyPackageDir(countyPackage);
        } catch (error) {
          throw new Error(
            `County build needs a verified dataset package: ${(error as Error).message} Run \`npm run package:dataset\` first.`,
          );
        }
        this.emitFile({
          type: "asset",
          fileName: "data/dataset.json",
          source: JSON.stringify(verified.record, null, 2) + "\n",
        });
        this.emitFile({
          type: "asset",
          fileName: `data/${verified.record.content.file}`,
          source: verified.body,
        });
        // Ordinary-road access parts (base roads, tile index and service-road tiles), each named by its hash.
        for (const [name, bytes] of verified.accessFiles)
          this.emitFile({
            type: "asset",
            fileName: `data/${name}`,
            source: bytes,
          });
      },
    },
    {
      name: "opt-in-address-index",
      apply: "build",
      generateBundle() {
        if (!addressIndex) return;
        this.emitFile({
          type: "asset",
          fileName: addressIndex.file,
          source: addressIndex.bytes,
        });
      },
    },
    {
      name: "private-local-review-data",
      configureServer(server) {
        const directory = process.env.TRAIL_LOCAL_DATA_DIR;
        if (!directory) return;
        server.middlewares.use("/local-review-data", async (req, res) => {
          if (
            !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
              req.socket.remoteAddress ?? "",
            )
          ) {
            res.statusCode = 403;
            res.end();
            return;
          }
          try {
            const [trails, supplement, access] = await Promise.all(
              [
                "mcgis-trails.normalized.json",
                "verified-trail-additions.normalized.json",
                "mclean-access-roads.normalized.json",
              ].map((f) => readFile(resolve(directory, f), "utf8")),
            );
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "no-store");
            res.end(
              JSON.stringify({
                trails,
                supplement,
                access,
                mode: "local",
                label: "Local county routing data — redistribution not cleared",
              }),
            );
          } catch {
            res.statusCode = 503;
            res.end(
              JSON.stringify({
                error:
                  "Local review assets are missing. Run the documented extractors in the active checkout.",
              }),
            );
          }
        });
      },
    },
  ],
});
