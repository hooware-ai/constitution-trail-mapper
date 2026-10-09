// The response headers a host must send for this app. Provider-neutral: tools/serve-dist.mjs applies exactly these
// to the built artifact so smoke tests (CSP violations, worker/module delivery, caching) run against the real policy,
// and docs/web/hosting-runbook.md maps them onto whichever provider is approved.

/** Tile host of the optional basemap (see docs/web/data-rights.md for the OSM tile policy). */
export const TILE_ORIGIN = "https://tile.openstreetmap.org";

export function contentSecurityPolicy({
  https = false,
  extraConnect = [],
} = {}) {
  const directives = {
    "default-src": ["'self'"],
    "script-src": ["'self'"],
    // React, Leaflet and the MapLibre navigation camera set inline style attributes.
    "style-src": ["'self'"],
    "style-src-attr": ["'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", TILE_ORIGIN],
    "font-src": ["'self'", "data:"],
    // Routing runs in a same-origin module worker; add auth/sync origins here when #31-#33 decide them.
    // MapLibre loads the same optional OSM raster tiles via fetch from its worker rather than an <img>.
    "connect-src": ["'self'", TILE_ORIGIN, ...extraConnect],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  if (https) directives["upgrade-insecure-requests"] = [];
  return Object.entries(directives)
    .map(([name, values]) => [name, ...values].join(" "))
    .join("; ");
}

export function securityHeaders({ https = false, extraConnect = [] } = {}) {
  const headers = {
    "Content-Security-Policy": contentSecurityPolicy({ https, extraConnect }),
    // The OSM tile policy requires a valid Referer, so do not send "no-referrer".
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    // Location is the app's purpose; nothing else is needed. Other features stay off.
    "Permissions-Policy":
      "geolocation=(self), camera=(), microphone=(), payment=(), usb=(), bluetooth=(), serial=()",
    // Popup sign-in (#32) needs same-origin-allow-popups; a stricter value would break it.
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  if (https)
    headers["Strict-Transport-Security"] =
      "max-age=31536000; includeSubDomains";
  return headers;
}

/** Hashed build assets never change under their name; everything that names them must revalidate. */
export function cacheControlFor(path) {
  if (path.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  // The network file is named by its content hash; the record that points at it must always be revalidated so a
  // new dataset (or a rollback) is picked up on the next load.
  if (/^\/data\/trails\.[0-9a-f]{12}\.json$/.test(path))
    return "public, max-age=31536000, immutable";
  return "no-cache";
}

export const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};
