import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { extname, join, normalize, sep } from "node:path";
import { execFileSync } from "node:child_process";
import {
  cacheControlFor,
  mimeTypes,
  securityHeaders,
} from "../../hosting/headers.mjs";
import { browserPort } from "./browser-port.mjs";

// Only socket states and numeric PIDs are returned, never process arguments or environments.
export function socketOwnership(port) {
  if (process.platform !== "linux")
    return { available: false, states: [], pids: [] };
  try {
    const output = execFileSync(
      "ss",
      ["-H", "-tanp", "sport", "=", `:${browserPort(port)}`],
      {
        encoding: "utf8",
        timeout: 1000,
        maxBuffer: 32768,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const states = [
      ...new Set(
        output
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => line.trim().split(/\s+/)[0])
          .filter((state) => /^[A-Z-]+$/.test(state)),
      ),
    ];
    const pids = [
      ...new Set(
        [...output.matchAll(/\bpid=(\d+)/g)].map((match) => Number(match[1])),
      ),
    ];
    return {
      available: true,
      states: states.slice(0, 16),
      pids: pids.slice(0, 16),
    };
  } catch {
    return { available: false, states: [], pids: [] };
  }
}

function createDistServer({ directory, isReady }) {
  async function resolveFile(urlPath) {
    const clean = normalize(decodeURIComponent(urlPath.split("?")[0])).replace(
      /^[/\\]+/,
      "",
    );
    const full = join(directory, clean);
    if (full !== directory && !full.startsWith(directory + sep)) return null;
    try {
      const info = await stat(full);
      if (info.isFile()) return full;
      if (info.isDirectory()) return resolveFile(join(clean, "index.html"));
    } catch {
      return null;
    }
    return null;
  }

  return createServer(async (request, response) => {
    if (!isReady()) {
      response.writeHead(503, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end("Artifact is being prepared");
      return;
    }
    const urlPath = request.url ?? "/";
    let file;
    try {
      file = await resolveFile(urlPath);
    } catch (error) {
      // A malformed percent-escape (for example "/%") is a bad request, never a reason to stop the server.
      if (error instanceof URIError) {
        response.writeHead(400, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end("Bad request");
        return;
      }
      throw error;
    }
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
    let body = await readFile(file);
    const headers = {};
    // A real host compresses text assets; doing the same keeps size and timing measurements representative.
    const accepts = String(request.headers["accept-encoding"] ?? "")
      .split(",")
      .map((token) => token.trim().split(";")[0]);
    const compressible = /\.(html|js|mjs|css|json|svg|webmanifest|map)$/.test(
      file,
    );
    if (compressible && body.length > 512) {
      if (accepts.includes("br")) {
        body = brotliCompressSync(body);
        headers["Content-Encoding"] = "br";
      } else if (accepts.includes("gzip")) {
        body = gzipSync(body);
        headers["Content-Encoding"] = "gzip";
      }
      headers["Vary"] = "Accept-Encoding";
    }
    response.writeHead(status, {
      ...headers,
      "Content-Type": mimeTypes[extname(file)] ?? "application/octet-stream",
      "Cache-Control": cacheControlFor(
        "/" +
          file
            .slice(directory.length + 1)
            .split(sep)
            .join("/"),
      ),
      ...securityHeaders({ https: false }),
    });
    response.end(request.method === "HEAD" ? undefined : body);
  });
}

// The caller owns this listener through preparation and serving. A busy port refuses once, without retry or reuse.
export async function listenDistServer({
  port,
  directory,
  isReady = () => true,
}) {
  browserPort(port);
  const server = createDistServer({ directory, isReady });
  try {
    await new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      server.once("error", onError);
      server.listen(port, "127.0.0.1", () => {
        server.removeListener("error", onError);
        resolve();
      });
    });
  } catch (error) {
    const details = socketOwnership(port);
    error.message += `; socket ownership ${details.available ? JSON.stringify({ states: details.states, pids: details.pids }) : "unavailable"}`;
    throw error;
  }
  return server;
}
