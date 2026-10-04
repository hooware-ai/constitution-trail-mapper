// INERT request adapter for a Cloudflare Pages advanced-mode `_worker.js` (a documented technical option; no host, account,
// origin or upload is chosen or implied). It is the request-dependent half of the CURRENT tested response contract that a
// static `_headers` file cannot express, applied to a synthetic or real `env.ASSETS` binding:
//
//   successful files   exact bytes from the binding, with the SHARED policy of hosting/headers.mjs (security headers, MIME,
//                      cache by the RESOLVED artifact path) and only valid encoding/length/ETag/Vary metadata passed on
//   missing assets     a real 404 (text/plain, no-store), never HTML; /assets/** and /data/** never fall back to the shell
//   navigations        an unknown extensionless URL asked for as text/html gets the app shell (200, no-cache)
//   errors             method/status-aware no-store, plus the security headers (strengthening: the local server omits them)
//
// This file must stay import-free and use only `export function`/`export const`: tools/lib/stage-hosting.mjs inlines its text,
// and the verbatim text of hosting/headers.mjs, into one self-contained `_worker.js`. The policy functions are injected.
//
// Strengthenings over today's local server, stated as such and not as existing behavior: GET and HEAD only (405 with Allow),
// reserved asset/data namespaces and hosting control files have no navigation fallback, decoded path checks, security
// headers on errors, and resolution against the AUDITED original file inventory rather than status 200 alone.

export const PREVIEW_RESERVED_NAMESPACES = ["assets", "data"];
export const PREVIEW_CONTROL_FILES = [
  "_worker.js",
  "_routes.json",
  "_headers",
  "_redirects",
  "hosting-manifest.json",
  "stage-manifest.json",
  "original-audit.json",
];
const PREVIEW_ENCODINGS = ["gzip", "br", "zstd", "deflate"];

function previewExtension(segment) {
  const dot = segment.lastIndexOf(".");
  return dot > 0 ? segment.slice(dot).toLowerCase() : "";
}

/** The decoded canonical path, or null for anything that must be refused (400) before it reaches any lookup. */
export function previewPath(pathname) {
  const out = [];
  const parts = pathname.split("/").slice(1);
  for (const part of parts) {
    let decoded;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      return null;
    }
    if (/[\\/\u0000-\u001f\u007f]/.test(decoded)) return null;
    if (decoded === "." || decoded === "..") return null;
    if (decoded !== "") out.push(decoded);
  }
  return { path: out.join("/"), trailingSlash: parts[parts.length - 1] === "" };
}

/** The URL the binding is asked for: clean URLs for index files, so the platform's own HTML redirects are not triggered. */
export function previewBindingPath(resolved) {
  if (resolved === "index.html") return "/";
  if (resolved.endsWith("/index.html"))
    return "/" + resolved.slice(0, -"index.html".length);
  return "/" + resolved;
}

function previewRedirectTarget(location, base, resolved) {
  if (!location) return null;
  let target;
  try {
    target = new URL(location, base);
  } catch {
    return null;
  }
  if (target.origin !== new URL(base).origin) return null;
  const clean = previewBindingPath(resolved);
  const stripped = "/" + resolved.replace(/\.html$/, "");
  return target.pathname === clean || target.pathname === stripped
    ? target
    : null;
}

export function createPreviewHandler({ inventory, policy }) {
  const files = new Set(inventory);
  const secure = policy.securityHeaders({ https: true });
  const expectedType = (resolved) =>
    policy.mimeTypes[previewExtension(resolved)] ?? null;

  function failure(status, message, head, extra = {}) {
    return new Response(head ? null : message, {
      status,
      headers: {
        ...secure,
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        ...extra,
      },
    });
  }

  async function fromBinding(env, request, resolved, head) {
    if (!env || !env.ASSETS || typeof env.ASSETS.fetch !== "function")
      return failure(502, "Asset binding unavailable", head);
    const forward = new Headers();
    for (const name of [
      "accept-encoding",
      "if-none-match",
      "if-modified-since",
    ]) {
      const value = request.headers.get(name);
      if (value !== null) forward.set(name, value);
    }
    const conditional =
      forward.has("if-none-match") || forward.has("if-modified-since");
    let target = new URL(previewBindingPath(resolved), request.url);
    let response;
    for (let hop = 0; ; hop++) {
      try {
        response = await env.ASSETS.fetch(
          new Request(target, {
            method: head ? "HEAD" : "GET",
            headers: forward,
          }),
        );
      } catch {
        return failure(502, "Asset unavailable", head);
      }
      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.status !== 304
      ) {
        // One same-origin redirect that lands on the same file (the platform's clean-URL handling) is followed; any
        // other redirect, or a second one, is not part of the contract.
        const next =
          hop === 0
            ? previewRedirectTarget(
                response.headers.get("location"),
                target,
                resolved,
              )
            : null;
        if (!next) return failure(502, "Asset unavailable", head);
        target = next;
        continue;
      }
      break;
    }
    const type = expectedType(resolved);
    if (!type) return failure(502, "Asset unavailable", head);
    const headers = {
      ...secure,
      "Content-Type": type,
      "Cache-Control": policy.cacheControlFor("/" + resolved),
    };
    const etag = response.headers.get("etag");
    if (etag && /^(W\/)?"[!#-~]*"$/.test(etag)) headers.ETag = etag;
    const encoding = response.headers.get("content-encoding");
    let encoded = false;
    if (encoding !== null && encoding.trim().toLowerCase() !== "identity") {
      const tokens = encoding
        .split(",")
        .map((token) => token.trim().toLowerCase());
      if (!tokens.every((token) => PREVIEW_ENCODINGS.includes(token)))
        return failure(502, "Asset unavailable", head);
      headers["Content-Encoding"] = tokens.join(", ");
      encoded = true;
    }
    const vary = new Set();
    for (const token of (response.headers.get("vary") ?? "").split(",")) {
      const name = token.trim();
      if (/^[A-Za-z0-9-]+$/.test(name) || name === "*") vary.add(name);
    }
    if (encoded) vary.add("Accept-Encoding");
    if (vary.size) headers.Vary = [...vary].join(", ");
    if (response.status === 304) {
      // Only a conditional request can have a 304 answer; anything else is a binding fault.
      if (!conditional) return failure(502, "Asset unavailable", head);
      return new Response(null, { status: 304, headers });
    }
    if (response.status !== 200) return failure(502, "Asset unavailable", head);
    const returned = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const bindingHtml =
      returned === "text/html" || returned === "application/xhtml+xml";
    if (bindingHtml !== type.startsWith("text/html"))
      return failure(502, "Asset unavailable", head);
    const length = response.headers.get("content-length");
    if (length !== null && /^\d+$/.test(length))
      headers["Content-Length"] = length;
    return new Response(head ? null : response.body, { status: 200, headers });
  }

  return async function previewHandler(request, env) {
    const head = request.method === "HEAD";
    if (request.method !== "GET" && !head)
      return failure(405, "Method not allowed", false, { Allow: "GET, HEAD" });
    const parsed = previewPath(new URL(request.url).pathname);
    if (!parsed) return failure(400, "Bad request", head);
    const { path, trailingSlash } = parsed;
    let resolved = null;
    if (path === "") resolved = files.has("index.html") ? "index.html" : null;
    else if (!trailingSlash && files.has(path)) resolved = path;
    else if (files.has(path + "/index.html")) resolved = path + "/index.html";
    if (resolved) return fromBinding(env, request, resolved, head);
    const lower = path.toLowerCase();
    const first = lower.split("/")[0];
    if (
      PREVIEW_CONTROL_FILES.includes(lower) ||
      lower.startsWith("_worker.js/") ||
      PREVIEW_RESERVED_NAMESPACES.includes(first) ||
      previewExtension(path.split("/").pop() ?? "")
    )
      return failure(404, "Not found", head);
    const wantsHtml = (request.headers.get("accept") ?? "")
      .toLowerCase()
      .includes("text/html");
    if (wantsHtml && files.has("index.html"))
      return fromBinding(env, request, "index.html", head);
    return failure(404, "Not found", head);
  };
}
