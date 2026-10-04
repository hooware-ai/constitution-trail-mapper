import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  cacheControlFor,
  mimeTypes,
  securityHeaders,
} from "../../hosting/headers.mjs";
import {
  PREVIEW_CONTROL_FILES,
  createPreviewHandler,
  previewBindingPath,
  previewPath,
} from "../../hosting/preview-adapter.mjs";
import { buildWorkerSource } from "../../tools/lib/stage-hosting.mjs";

// The inert Pages advanced-mode adapter, against a SYNTHETIC `env.ASSETS` binding: no Cloudflare, no network, no tiles. Every
// case runs twice, against the adapter module and against the generated `_worker.js` text a staging run would write, so what
// is tested is what would be staged.

const exact = new Uint8Array([0x00, 0xff, 0x10, 0x80, 0x7f, 0x0a, 0x61]);
const html = new TextEncoder().encode("<!doctype html><title>shell</title>\n");
const inventory = [
  "index.html",
  "assets/app.0123456789ab.js",
  "assets/app.0123456789ab.css",
  "assets/worker.0123456789ab.js",
  "data/trails.0123456789ab.json",
  "data/dataset.json",
  "provenance.json",
];
const files: Record<string, Uint8Array> = {
  "index.html": html,
  "assets/app.0123456789ab.js": exact,
  "assets/app.0123456789ab.css": new TextEncoder().encode("a{}\n"),
  "assets/worker.0123456789ab.js": new TextEncoder().encode("export{};\n"),
  "data/trails.0123456789ab.json": new TextEncoder().encode("{}\n"),
  "data/dataset.json": new TextEncoder().encode("{}\n"),
  "provenance.json": new TextEncoder().encode("{}\n"),
};
type Override = (path: string, request: Request) => Response | undefined;
function binding(
  options: {
    spaFallback?: boolean;
    override?: Override;
    present?: string[];
  } = {},
) {
  const calls: {
    method: string;
    path: string;
    headers: Record<string, string>;
  }[] = [];
  const present = new Set(options.present ?? Object.keys(files));
  return {
    calls,
    env: {
      ASSETS: {
        async fetch(request: Request) {
          const url = new URL(request.url);
          calls.push({
            method: request.method,
            path: url.pathname,
            headers: Object.fromEntries(request.headers),
          });
          const override = options.override?.(url.pathname, request);
          if (override) return override;
          const key =
            url.pathname === "/"
              ? "index.html"
              : url.pathname.endsWith("/")
                ? url.pathname.slice(1) + "index.html"
                : url.pathname.slice(1);
          let body: Uint8Array | undefined = present.has(key)
            ? files[key]
            : undefined;
          let name = key;
          if (!body && options.spaFallback) {
            body = files["index.html"];
            name = "index.html";
          }
          if (!body) return new Response("not found", { status: 404 });
          const type =
            mimeTypes[name.slice(name.lastIndexOf("."))] ??
            "application/octet-stream";
          return new Response(
            request.method === "HEAD" ? null : (body as unknown as BodyInit),
            {
              status: 200,
              headers: {
                "content-type": type,
                "content-length": String(body.length),
              },
            },
          );
        },
      },
    },
  };
}

const headersSource = await readFile(
  join(import.meta.dirname, "../../hosting/headers.mjs"),
  "utf8",
);
const adapterSource = await readFile(
  join(import.meta.dirname, "../../hosting/preview-adapter.mjs"),
  "utf8",
);
const workerSource = buildWorkerSource({
  headersSource,
  adapterSource,
  inventory,
});
const scratch = await mkdtemp(join(tmpdir(), "trail-worker-"));
await writeFile(join(scratch, "_worker.js"), workerSource);
const generated: any = await import(
  pathToFileURL(join(scratch, "_worker.js")).href + "?v=1"
);
process.on("exit", () => {
  void rm(scratch, { recursive: true, force: true });
});
type Handler = (request: Request, env: any) => Promise<Response>;
const handlers: [string, Handler][] = [
  [
    "adapter module",
    createPreviewHandler({
      inventory,
      policy: { securityHeaders, cacheControlFor, mimeTypes },
    }) as Handler,
  ],
  [
    "generated _worker.js",
    (request, env) => generated.default.fetch(request, env),
  ],
];

const get = (path: string, init: RequestInit = {}) =>
  new Request("https://preview.invalid" + path, init);
const nav = { headers: { accept: "text/html,application/xhtml+xml" } };
const bytesOf = async (response: Response) =>
  new Uint8Array(await response.arrayBuffer());
const secure = securityHeaders({ https: true });
const hasSecurity = (response: Response) => {
  for (const [name, value] of Object.entries(secure))
    assert.equal(response.headers.get(name), value, name);
};
const failed = async (response: Response, status: number) => {
  assert.equal(response.status, status);
  hasSecurity(response);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-type")!, /^text\/plain/);
  assert.doesNotMatch(await response.text(), /<html|<!doctype/i);
};

for (const [label, handle] of handlers) {
  const t = (name: string, run: () => Promise<void>) =>
    test(`${label}: ${name}`, run);

  t(
    "a successful file carries exactly the shared policy and the exact bytes, for GET and HEAD",
    async () => {
      const { env, calls } = binding();
      const response = await handle(get("/assets/app.0123456789ab.js"), env);
      assert.equal(response.status, 200);
      assert.deepEqual(await bytesOf(response), exact);
      assert.deepEqual(Object.fromEntries(response.headers), {
        ...Object.fromEntries(
          Object.entries(secure).map(([k, v]) => [k.toLowerCase(), v]),
        ),
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "public, max-age=31536000, immutable",
        "content-length": String(exact.length),
      });
      const head = await handle(
        get("/assets/app.0123456789ab.js", { method: "HEAD" }),
        env,
      );
      assert.equal(head.status, 200);
      assert.equal((await bytesOf(head)).length, 0);
      for (const name of [
        "content-type",
        "cache-control",
        "content-length",
        ...Object.keys(secure).map((k) => k.toLowerCase()),
      ])
        assert.equal(head.headers.get(name), response.headers.get(name), name);
      assert.deepEqual(
        calls.map((c) => c.method),
        ["GET", "HEAD"],
      );
    },
  );

  t(
    "cache policy follows the resolved artifact path and nothing is guessed",
    async () => {
      const { env } = binding();
      for (const [path, cache, type] of [
        [
          "/data/trails.0123456789ab.json",
          "public, max-age=31536000, immutable",
          "application/json; charset=utf-8",
        ],
        ["/data/dataset.json", "no-cache", "application/json; charset=utf-8"],
        ["/provenance.json", "no-cache", "application/json; charset=utf-8"],
        [
          "/assets/app.0123456789ab.css",
          "public, max-age=31536000, immutable",
          "text/css; charset=utf-8",
        ],
      ]) {
        const response = await handle(get(path), env);
        assert.equal(response.status, 200, path);
        assert.equal(response.headers.get("cache-control"), cache, path);
        assert.equal(response.headers.get("content-type"), type, path);
        assert.equal(cacheControlFor(path), cache, path);
      }
    },
  );

  t(
    "the root, /index.html and an unknown extensionless navigation get the shell, no-cache, HEAD included",
    async () => {
      const { env, calls } = binding();
      for (const path of ["/", "/index.html", "/saved/route", "/some-page"]) {
        const response = await handle(get(path, nav), env);
        assert.equal(response.status, 200, path);
        assert.equal(
          response.headers.get("content-type"),
          "text/html; charset=utf-8",
          path,
        );
        assert.equal(response.headers.get("cache-control"), "no-cache", path);
        assert.deepEqual(await bytesOf(response), html, path);
        hasSecurity(response);
        const head = await handle(get(path, { ...nav, method: "HEAD" }), env);
        assert.equal(head.status, 200, path);
        assert.equal((await bytesOf(head)).length, 0, path);
        assert.equal(head.headers.get("cache-control"), "no-cache", path);
      }
      // Clean URLs only: the platform's own /index.html redirect is never provoked.
      assert.ok(calls.every((c) => c.path === "/"));
      assert.equal(previewBindingPath("index.html"), "/");
      assert.equal(previewBindingPath("a/index.html"), "/a/");
    },
  );

  t(
    "an unknown extensionless URL not asked for as HTML is a real 404",
    async () => {
      const { env } = binding();
      await failed(await handle(get("/saved/route"), env), 404);
      await failed(
        await handle(
          get("/saved/route", { headers: { accept: "application/json" } }),
          env,
        ),
        404,
      );
      await failed(
        await handle(get("/saved/route", { method: "HEAD" }), env),
        404,
      );
    },
  );

  t(
    "missing assets and data are a real non-HTML 404 and never fall back to the shell, even for an HTML Accept",
    async () => {
      const { env, calls } = binding({ spaFallback: true });
      for (const path of [
        "/assets/missing.js",
        "/assets/worker",
        "/assets/app.0123456789ab.js/",
        "/data/unknown",
        "/data/x.json",
        "/data",
        "/Assets/anything",
        "/DATA/anything",
        "/missing.js",
        "/missing.json",
        "/favicon.ico",
      ]) {
        await failed(await handle(get(path, nav), env), 404);
        await failed(
          await handle(get(path, { ...nav, method: "HEAD" }), env),
          404,
        );
      }
      assert.equal(
        calls.length,
        0,
        "a path outside the audited inventory is never even asked of the binding",
      );
    },
  );

  t(
    "hosting control files are never served and never become the shell",
    async () => {
      const { env } = binding({ spaFallback: true });
      for (const name of [
        ...PREVIEW_CONTROL_FILES,
        "_WORKER.JS",
        "_Headers",
        "_worker.js/index.js",
      ])
        await failed(await handle(get("/" + name, nav), env), 404);
    },
  );

  t(
    "only GET and HEAD: everything else is 405 with Allow, no-store and security headers, before any lookup",
    async () => {
      const { env, calls } = binding();
      for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
        const response = await handle(
          get("/assets/app.0123456789ab.js", {
            method,
            body:
              method === "POST" || method === "PUT" || method === "PATCH"
                ? "x"
                : undefined,
          }),
          env,
        );
        assert.equal(response.headers.get("allow"), "GET, HEAD", method);
        await failed(response, 405);
      }
      assert.equal(calls.length, 0);
    },
  );

  t(
    "malformed escapes and decoded separators, controls and dot segments are 400 and never reach the binding",
    async () => {
      const { env, calls } = binding();
      for (const path of [
        "/%",
        "/%E0%A4%A",
        "/assets/%zz",
        "/a%2Fb",
        "/a%2fb",
        "/a%5Cb",
        "/a%00b",
        "/a%0Ab",
        "/a%7Fb",
      ])
        await failed(await handle(get(path, nav), env), 400);
      await failed(await handle(get("/%", { method: "HEAD" }), env), 400);
      assert.equal(calls.length, 0);
      for (const bad of ["/a/../b", "/a/./b"])
        assert.equal(previewPath(bad), null);
    },
  );

  t(
    "percent-encoded names, double slashes and URL-normalized dot segments resolve to the audited file only",
    async () => {
      const { env } = binding();
      const served = async (path: string) => handle(get(path), env);
      assert.equal((await served("/assets/%61pp.0123456789ab.js")).status, 200);
      assert.equal((await served("//assets//app.0123456789ab.js")).status, 200);
      // The URL parser removes dot segments (even %2e) before the adapter sees them: they cannot climb out.
      const climbed = await served("/assets/%2e%2e/data/dataset.json");
      assert.equal(climbed.status, 200);
      await failed(await served("/assets/%252e%252e/data/dataset.json"), 404);
      await failed(await served("/assets/app.0123456789ab.JS"), 404);
    },
  );

  t(
    "the client's range, cookie and authorization never reach the binding; encoding and conditional headers do",
    async () => {
      const { env, calls } = binding();
      await handle(
        get("/assets/app.0123456789ab.js", {
          headers: {
            range: "bytes=0-1",
            "if-range": "x",
            cookie: "a=b",
            authorization: "Bearer x",
            "accept-encoding": "br, gzip",
            "if-none-match": '"abc"',
          },
        }),
        env,
      );
      assert.deepEqual(Object.keys(calls[0].headers).sort(), [
        "accept-encoding",
        "if-none-match",
      ]);
    },
  );

  t(
    "binding faults on a declared file are 502 no-store, never the shell and never a relabelled 200/404",
    async () => {
      const cases: [string, Override][] = [
        ["404", () => new Response("nope", { status: 404 })],
        ["500", () => new Response("boom", { status: 500 })],
        ["403", () => new Response("no", { status: 403 })],
        [
          "206",
          () =>
            new Response(exact, {
              status: 206,
              headers: { "content-type": "text/javascript" },
            }),
        ],
        [
          "throws",
          () => {
            throw new Error("binding down");
          },
        ],
        [
          "unexpected redirect",
          () =>
            new Response(null, {
              status: 302,
              headers: { location: "https://elsewhere.invalid/x" },
            }),
        ],
        [
          "redirect elsewhere",
          () =>
            new Response(null, {
              status: 301,
              headers: { location: "/other" },
            }),
        ],
        [
          "304 without a conditional request",
          () => new Response(null, { status: 304 }),
        ],
        [
          "HTML for a JavaScript file",
          () =>
            new Response(html, {
              status: 200,
              headers: { "content-type": "text/html; charset=utf-8" },
            }),
        ],
        [
          "JavaScript for the shell",
          () =>
            new Response(exact, {
              status: 200,
              headers: { "content-type": "text/javascript" },
            }),
        ],
        [
          "unknown content encoding",
          () =>
            new Response(exact, {
              status: 200,
              headers: {
                "content-type": "text/javascript",
                "content-encoding": "weird",
              },
            }),
        ],
      ];
      for (const [name, override] of cases) {
        const target =
          name === "JavaScript for the shell"
            ? "/"
            : "/assets/app.0123456789ab.js";
        const { env } = binding({
          override: (path) =>
            path === target ? override(path, get(path)) : undefined,
        });
        await failed(await handle(get(target, nav), env), 502);
      }
      await failed(await handle(get("/assets/app.0123456789ab.js"), {}), 502);
    },
  );

  t(
    "the binding's own SPA fallback is detected: a declared module missing from it is never served as HTML",
    async () => {
      const { env } = binding({ spaFallback: true, present: ["index.html"] });
      await failed(await handle(get("/assets/app.0123456789ab.js"), env), 502);
      await failed(await handle(get("/data/dataset.json"), env), 502);
      // The shell itself is still served.
      assert.equal((await handle(get("/", nav), env)).status, 200);
    },
  );

  t(
    "one same-origin redirect onto the same file is followed (clean URLs); a second is not",
    async () => {
      const once = binding({
        override: (path) =>
          path === "/"
            ? new Response(null, {
                status: 308,
                headers: { location: "/index" },
              })
            : undefined,
      });
      // The redirect target /index is accepted as the extension-less form of the shell, but the binding has no such file: 502.
      await failed(await handle(get("/", nav), once.env), 502);
      let hops = 0;
      const same = binding({
        override: (path) => {
          if (path !== "/assets/app.0123456789ab.js") return undefined;
          hops++;
          return hops === 1
            ? new Response(null, {
                status: 308,
                headers: { location: "/assets/app.0123456789ab.js" },
              })
            : new Response(null, {
                status: 308,
                headers: { location: "/assets/app.0123456789ab.js" },
              });
        },
      });
      await failed(
        await handle(get("/assets/app.0123456789ab.js"), same.env),
        502,
      );
      assert.equal(hops, 2);
      let first = true;
      const followed = binding({
        override: (path) => {
          if (path !== "/assets/app.0123456789ab.js" || !first)
            return undefined;
          first = false;
          return new Response(null, {
            status: 308,
            headers: { location: "/assets/app.0123456789ab.js" },
          });
        },
      });
      const ok = await handle(get("/assets/app.0123456789ab.js"), followed.env);
      assert.equal(ok.status, 200);
      assert.deepEqual(await bytesOf(ok), exact);
    },
  );

  t(
    "a conditional request may be answered 304 with the shared policy and validators, and no body",
    async () => {
      const { env, calls } = binding({
        override: (path, request) =>
          path === "/assets/app.0123456789ab.js" &&
          request.headers.get("if-none-match") === '"v1"'
            ? new Response(null, {
                status: 304,
                headers: {
                  etag: '"v1"',
                  "set-cookie": "x=y",
                  vary: "Accept-Encoding",
                },
              })
            : undefined,
      });
      const response = await handle(
        get("/assets/app.0123456789ab.js", {
          headers: { "if-none-match": '"v1"' },
        }),
        env,
      );
      assert.equal(response.status, 304);
      assert.equal(response.headers.get("etag"), '"v1"');
      assert.equal(
        response.headers.get("cache-control"),
        "public, max-age=31536000, immutable",
      );
      assert.equal(response.headers.get("set-cookie"), null);
      hasSecurity(response);
      assert.equal((await bytesOf(response)).length, 0);
      assert.equal(calls[0].headers["if-none-match"], '"v1"');
    },
  );

  t(
    "only valid encoding, length, ETag and Vary metadata passes through; everything else the binding says is dropped",
    async () => {
      const compressed = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02]);
      const { env } = binding({
        override: (path) =>
          path === "/assets/app.0123456789ab.js"
            ? new Response(compressed, {
                status: 200,
                headers: {
                  "content-type": "text/javascript",
                  "content-encoding": "gzip",
                  "content-length": String(compressed.length),
                  etag: 'W/"abc"',
                  vary: "Cookie, Accept-Language, bad token!",
                  "cache-control": "max-age=1",
                  "set-cookie": "a=b",
                  server: "x",
                  "x-extra": "1",
                  "access-control-allow-origin": "*",
                },
              })
            : undefined,
      });
      const response = await handle(
        get("/assets/app.0123456789ab.js", {
          headers: { "accept-encoding": "gzip" },
        }),
        env,
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await bytesOf(response), compressed);
      assert.equal(response.headers.get("content-encoding"), "gzip");
      assert.equal(
        response.headers.get("content-length"),
        String(compressed.length),
      );
      assert.equal(response.headers.get("etag"), 'W/"abc"');
      assert.equal(
        response.headers.get("vary"),
        "Cookie, Accept-Language, Accept-Encoding",
      );
      assert.equal(
        response.headers.get("cache-control"),
        "public, max-age=31536000, immutable",
      );
      for (const dropped of [
        "set-cookie",
        "server",
        "x-extra",
        "access-control-allow-origin",
      ])
        assert.equal(response.headers.get(dropped), null, dropped);
      // Invalid length and ETag are dropped, not repeated.
      const bad = binding({
        override: (path) =>
          path === "/data/dataset.json"
            ? new Response(files["data/dataset.json"] as unknown as BodyInit, {
                status: 200,
                headers: {
                  "content-type": "application/json",
                  etag: "not quoted",
                },
              })
            : undefined,
      });
      const plain = await handle(get("/data/dataset.json"), bad.env);
      assert.equal(plain.headers.get("etag"), null);
    },
  );

  t(
    "error responses are never cacheable and never carry the binding's headers or body",
    async () => {
      const { env } = binding({
        override: () =>
          new Response("<html>secret binding page</html>", {
            status: 500,
            headers: {
              "content-type": "text/html",
              "set-cookie": "a=b",
              "cache-control": "public, max-age=999",
            },
          }),
      });
      const response = await handle(get("/provenance.json"), env);
      assert.equal(response.status, 502);
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.doesNotMatch(await response.text(), /secret/);
    },
  );
}

test("the generated worker inlines hosting/headers.mjs verbatim except for the export prefixes, and only those", () => {
  const stripped = headersSource.replace(/^export (const|function) /gm, "$1 ");
  assert.ok(workerSource.includes(stripped));
  assert.ok(
    workerSource.includes(
      adapterSource.replace(/^export (const|function) /gm, "$1 "),
    ),
  );
  assert.equal(
    workerSource.match(/^export /gm)?.length,
    1,
    "only the Pages entry point is exported",
  );
  assert.match(workerSource, /^const PREVIEW_INVENTORY = \[.*\];$/m);
  assert.doesNotMatch(workerSource, /^\s*import\b/m);
});

test("inlining refuses a module form it cannot represent", () => {
  assert.throws(
    () =>
      buildWorkerSource({
        headersSource: headersSource + "\nexport default {};\n",
        adapterSource,
        inventory,
      }),
    /cannot be inlined/,
  );
  assert.throws(
    () =>
      buildWorkerSource({
        headersSource,
        adapterSource: 'import x from "y";\n' + adapterSource,
        inventory,
      }),
    /cannot be inlined/,
  );
});

test("the adapter is inert: it has no global network access, storage, process or credential code", () => {
  const code = adapterSource
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
  assert.equal(code.match(/\bfetch\b/g)?.length, 2, "only env.ASSETS.fetch");
  for (const forbidden of [
    /node:/,
    /\bprocess\b/,
    /\bglobalThis\b/,
    /\bself\b/,
    /\bcaches\b/,
    /\bconsole\b/,
    /XMLHttpRequest|WebSocket|sendBeacon/,
    /firebase|api[_-]?key|\bsecret|password|bearer/i,
    /^\s*import\b/m,
  ])
    assert.doesNotMatch(code, forbidden, String(forbidden));
});
