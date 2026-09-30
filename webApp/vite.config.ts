import { defineConfig } from "vite";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { verifyCoreManifest } from "./tools/lib/core.mjs";

// Automated runs own their port (TRAIL_TEST_PORT) and fail if it is taken instead of reusing another server.
const port = Number(process.env.TRAIL_TEST_PORT ?? 4173);

// Review data is a loopback-only dev endpoint. It is NEVER a public asset or build input.
export default defineConfig({
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
