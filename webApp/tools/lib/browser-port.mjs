import { createServer } from "node:net";

// HTTP(S) bad-port table, checked 2026-10-09 against the Fetch Standard:
// https://fetch.spec.whatwg.org/#port-blocking
// A listening TCP server is not proof that Chromium/WebKit can navigate to it.
export const COUNTY_BROWSER_PORT_COUNT = 6;

const blocked = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77,
  79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135,
  137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531,
  532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720,
  1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6679, 6697, 10080,
]);

class BrowserPortError extends Error {
  code = "ERR_BROWSER_PORT";
}

export function browserPort(value, label = "TRAIL_TEST_PORT") {
  if (
    !["number", "string"].includes(typeof value) ||
    (typeof value === "string" && !/^\d+$/.test(value)) ||
    !Number.isInteger(Number(value)) ||
    Number(value) < 1 ||
    Number(value) > 65535
  ) {
    throw new BrowserPortError(
      `${label} must be a decimal integer from 1 to 65535.`,
    );
  }
  const port = Number(value);
  if (blocked.has(port)) {
    throw new BrowserPortError(
      `${label}: HTTP port ${port} is browser-blocked by the Fetch Standard. Choose a browser-usable port (for example 4173); TCP/curl readiness is insufficient.`,
    );
  }
  return port;
}

export function browserPortRange(value, count, label = "TRAIL_TEST_PORT") {
  if (!Number.isInteger(count) || count < 1 || count > 65535)
    throw new Error("Browser port range count must be from 1 to 65535.");
  const base = browserPort(value, label);
  for (let offset = 1; offset < count; offset++)
    browserPort(base + offset, `${label}+${offset}`);
  return base;
}

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function ephemeralPort() {
  const server = await listen(0);
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Checks the entire range while holding all successful binds, then releases it.
 * Servers still use strict ports: a later race fails instead of reusing a server.
 * nextCandidate is injectable to exercise busy/blocked candidates with real sockets.
 */
export async function freeBrowserPortRange(
  count = 1,
  nextCandidate = ephemeralPort,
) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const servers = [];
    try {
      const base = browserPortRange(await nextCandidate(), count);
      for (let offset = 0; offset < count; offset++)
        servers.push(await listen(base + offset));
      return base;
    } catch (error) {
      // A blocked/out-of-range candidate or a competing listener is retryable;
      // permission/resource failures are not disguised as busy ports.
      if (!["EADDRINUSE", "ERR_BROWSER_PORT"].includes(error.code)) throw error;
    } finally {
      await Promise.all(
        servers.map(
          (server) => new Promise((resolve) => server.close(resolve)),
        ),
      );
    }
  }
  throw new Error(
    `Could not find ${count} adjacent free browser-usable ports.`,
  );
}
