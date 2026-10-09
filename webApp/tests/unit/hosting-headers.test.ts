import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TILE_ORIGIN,
  cacheControlFor,
  contentSecurityPolicy,
  securityHeaders,
} from "../../hosting/headers.mjs";

// The production header policy is pinned exactly, and checked against the runbook table that tells a host what to send, so
// neither can loosen or drift without a test failing. Pure data: no server, network or browser.
const runbook = readFileSync(
  join(process.cwd(), "..", "docs", "web", "hosting-runbook.md"),
  "utf8",
);
const parse = (policy: string): Record<string, string[]> =>
  Object.fromEntries(
    policy.split("; ").map((part) => {
      const [name, ...values] = part.split(" ");
      return [name, values];
    }),
  );

test("the CSP is exactly the documented policy and nothing in it is a wildcard or unsafe", () => {
  const csp = parse(contentSecurityPolicy());
  assert.deepEqual(
    { ...csp },
    {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'"],
      "style-src-attr": ["'unsafe-inline'"],
      "img-src": ["'self'", "data:", "blob:", TILE_ORIGIN],
      "font-src": ["'self'", "data:"],
      "connect-src": ["'self'", TILE_ORIGIN],
      "worker-src": ["'self'", "blob:"],
      "manifest-src": ["'self'"],
      "object-src": ["'none'"],
      "base-uri": ["'none'"],
      "form-action": ["'self'"],
      "frame-ancestors": ["'none'"],
    },
  );
  // Only inline style ATTRIBUTES are allowed; scripts and style elements never are.
  for (const name of ["script-src", "style-src", "default-src"])
    assert.ok(!csp[name].some((value) => /unsafe|\*/.test(value)), name);
  const foreign = Object.values(csp)
    .flat()
    .filter((value) => value.startsWith("https:") || value.includes("//"));
  assert.deepEqual(
    foreign,
    [TILE_ORIGIN, TILE_ORIGIN],
    "the optional basemap host is the only outside origin",
  );
});

test("extra connect origins are added to connect-src only, and HTTPS adds upgrade-insecure-requests only", () => {
  const extra = parse(
    contentSecurityPolicy({ extraConnect: ["https://example.invalid"] }),
  );
  assert.deepEqual(extra["connect-src"], [
    "'self'",
    TILE_ORIGIN,
    "https://example.invalid",
  ]);
  assert.deepEqual(
    { ...extra, "connect-src": ["'self'", TILE_ORIGIN] },
    parse(contentSecurityPolicy()),
  );
  const https = parse(contentSecurityPolicy({ https: true }));
  assert.deepEqual(https["upgrade-insecure-requests"], []);
  delete https["upgrade-insecure-requests"];
  assert.deepEqual(https, parse(contentSecurityPolicy()));
});

test("the other security headers are exactly the documented set, and HSTS is HTTPS-only", () => {
  const http = securityHeaders();
  assert.deepEqual(Object.keys(http).sort(), [
    "Content-Security-Policy",
    "Cross-Origin-Opener-Policy",
    "Cross-Origin-Resource-Policy",
    "Permissions-Policy",
    "Referrer-Policy",
    "X-Content-Type-Options",
  ]);
  assert.equal(http["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.equal(http["X-Content-Type-Options"], "nosniff");
  assert.equal(http["Cross-Origin-Opener-Policy"], "same-origin-allow-popups");
  assert.equal(http["Cross-Origin-Resource-Policy"], "same-origin");
  const permissions = http["Permissions-Policy"].split(", ");
  assert.deepEqual(permissions, [
    "geolocation=(self)",
    "camera=()",
    "microphone=()",
    "payment=()",
    "usb=()",
    "bluetooth=()",
    "serial=()",
  ]);
  assert.equal("Strict-Transport-Security" in http, false, "never over HTTP");
  assert.equal(
    securityHeaders({ https: true })["Strict-Transport-Security"],
    "max-age=31536000; includeSubDomains",
  );
});

test("the runbook table names every header and value the policy sends", () => {
  const https = securityHeaders({ https: true });
  const row = (name: string) => {
    const line = runbook.split("\n").find((l) => l.startsWith(`| \`${name}\``));
    assert.ok(line, `${name} has a row in hosting-runbook.md`);
    return line;
  };
  for (const name of Object.keys(https)) row(name);
  const csp = row("Content-Security-Policy");
  for (const directive of [
    "default-src 'self'",
    "img-src 'self' data: blob: https://tile.openstreetmap.org",
    "connect-src 'self' https://tile.openstreetmap.org",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ])
    assert.ok(csp.includes(directive), `runbook CSP row has ${directive}`);
  assert.ok(row("Referrer-Policy").includes("strict-origin-when-cross-origin"));
  assert.ok(row("X-Content-Type-Options").includes("nosniff"));
  assert.ok(
    row("Cross-Origin-Opener-Policy").includes("same-origin-allow-popups"),
  );
  assert.ok(row("Cross-Origin-Resource-Policy").includes("same-origin"));
  assert.ok(
    row("Strict-Transport-Security").includes(
      "max-age=31536000; includeSubDomains",
    ),
  );
  const permissions = row("Permissions-Policy");
  assert.ok(permissions.includes("geolocation=(self)"));
  for (const feature of [
    "camera",
    "microphone",
    "payment",
    "usb",
    "bluetooth",
    "serial",
  ])
    assert.ok(permissions.includes(feature), feature);
});

test("caching: hashed assets and hash-named data are immutable; anything that names them revalidates", () => {
  assert.equal(
    cacheControlFor("/assets/index-abc123.js"),
    "public, max-age=31536000, immutable",
  );
  assert.equal(
    cacheControlFor("/data/trails.0123456789ab.json"),
    "public, max-age=31536000, immutable",
  );
  for (const path of [
    "/",
    "/index.html",
    "/provenance.json",
    "/manifest.webmanifest",
    "/data/dataset.json",
    "/data/trails.json",
  ])
    assert.equal(cacheControlFor(path), "no-cache", path);
});
