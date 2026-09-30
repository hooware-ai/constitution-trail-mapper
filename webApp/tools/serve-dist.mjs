// Serves the built artifact (dist/) with the production header set. For preview and smoke tests only: it binds to
// loopback, refuses to start if the port is taken (never reuses another tree's server) and is not a hosting choice.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import {
  cacheControlFor,
  mimeTypes,
  securityHeaders,
} from "../hosting/headers.mjs";
import { distDir } from "./lib/provenance.mjs";

const portArg = process.argv.indexOf("--port");
const port = Number(
  portArg > 0
    ? process.argv[portArg + 1]
    : (process.env.TRAIL_TEST_PORT ?? 4173),
);
if (!Number.isInteger(port) || port <= 0) {
  console.error("serve-dist needs a valid --port <n> (or TRAIL_TEST_PORT).");
  process.exit(2);
}

async function resolveFile(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split("?")[0])).replace(
    /^[/\\]+/,
    "",
  );
  const full = join(distDir, clean);
  if (full !== distDir && !full.startsWith(distDir + sep)) return null;
  try {
    const info = await stat(full);
    if (info.isFile()) return full;
    if (info.isDirectory()) return resolveFile(join(clean, "index.html"));
  } catch {
    return null;
  }
  return null;
}

const server = createServer(async (request, response) => {
  const urlPath = request.url ?? "/";
  let file = await resolveFile(urlPath);
  let status = 200;
  // Unknown *navigations* get the app shell; a missing asset must be a real 404, never HTML.
  const wantsHtml = (request.headers.accept ?? "").includes("text/html");
  if (!file && wantsHtml && !extname(urlPath.split("?")[0]))
    file = await resolveFile("/index.html");
  if (!file) {
    status = 404;
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end("Not found");
    return;
  }
  const body = await readFile(file);
  response.writeHead(status, {
    "Content-Type": mimeTypes[extname(file)] ?? "application/octet-stream",
    "Cache-Control": cacheControlFor(
      "/" +
        file
          .slice(distDir.length + 1)
          .split(sep)
          .join("/"),
    ),
    ...securityHeaders({ https: false }),
  });
  response.end(request.method === "HEAD" ? undefined : body);
});
server.on("error", (error) => {
  console.error(
    `serve-dist could not listen on 127.0.0.1:${port}: ${error.message}`,
  );
  process.exit(1);
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Serving dist/ on http://127.0.0.1:${port}`),
);
