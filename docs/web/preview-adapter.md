# Inert preview adapter and local stager (UNAPPROVED preparation, nothing deployed)

Recorded 2026-10-04 in the local release-candidate worktree (`codex/web-release-candidate`). **This selects no host, account, origin or plan, and uploads, deploys, provisions and accepts nothing.** It prepares an optional Cloudflare Pages advanced-mode `_worker.js` as a documented technical option and checks it against a SYNTHETIC `env.ASSETS` binding. Preparation is not a configured or protected preview, and a preview is not public publication. Fixture and county approval, the six Proposed rights, public ODbL composition, the Start-policy difference and the physical phone and outdoor gates are unchanged, and the committed approval stays `approved: false`, `approvedComposition: null`.

## Why an adapter, and what it does not claim

The tested response contract is request-dependent (a real non-HTML 404 for a missing module or data file, but the app shell for an unknown extensionless navigation), which a static `_headers` file cannot express, and `_headers` does not apply to responses a Function produces. So the adapter applies the shared policy itself: `webApp/hosting/headers.mjs` is **unchanged** and is inlined verbatim (only `export ` prefixes removed) into the generated worker, whose text the tests import. Nothing is guessed about caching: the `Cache-Control` of a response is `cacheControlFor` of the RESOLVED artifact path, exactly as today.

Not verified here, and only an authorized real preview can show them: the platform's actual compressed delivery, its clean-URL redirects, CSP behavior at a real origin, geolocation, protected access, the Direct Upload versus Git integration route for advanced mode (the advanced-mode page says to deploy through Git integration; whether Direct Upload honors `_worker.js` is not established), and any plan or billing behavior. Every request invokes the Function (the generated `_routes.json` includes everything on purpose: excluding `/assets/*` would let the platform fall back to HTML for a missing module). Documented Workers Free allowances are not evidence of anyone's account.

## Request contract (all covered by `tests/unit/preview-adapter.test.ts`, run against the module and against the generated `_worker.js`)

| Request | Result |
| --- | --- |
| a file in the audited original inventory | exact bytes from the binding; `Content-Type` from `mimeTypes`, `Cache-Control` from `cacheControlFor("/" + resolved path)`, the security headers with HSTS; HEAD gives the same headers and no body |
| `/`, `/index.html`, an unknown extensionless URL asked for as `text/html` | the shell, 200, `no-cache` (the binding is asked for the clean `/`, never `/index.html`) |
| unknown extensionless URL not asked for as HTML | real 404, `text/plain`, `no-store`, security headers |
| a missing `/assets/**` or `/data/**` path, a path with an extension, a trailing-slash file, a hosting control file (`_worker.js`, `_routes.json`, `_headers`, `_redirects`, `hosting-manifest.json`, `stage-manifest.json`, `original-audit.json`, any case) | real 404, never the shell, never asked of the binding |
| any method but GET and HEAD | 405 with `Allow: GET, HEAD`, `no-store`, security headers, before any lookup |
| malformed percent escape, a decoded `/`, `\`, NUL or control character, a `.` or `..` segment | 400, never reaches the binding. Dot segments (even `%2e`) are removed by URL parsing first; double slashes collapse; names are decoded once and matched exactly (case-sensitive) |
| binding status for a declared file other than the cases below (404, 5xx, 403, 206, a redirect elsewhere, a second redirect, a thrown error, a missing binding) | 502 `no-store`, `text/plain`, security headers; a declared-file 404 is a binding fault and is never relabelled as the shell or as a 404 for the client |
| binding SPA fallback (200 HTML for a declared JavaScript or JSON file) or JavaScript for the shell | 502: the binding's content type must agree with the file's type; HTML is never served or cached as a module or data file |
| one same-origin redirect onto the same file | followed once (clean-URL handling); anything else is 502 |
| conditional request (`If-None-Match`, `If-Modified-Since`) | forwarded; a 304 is passed with the shared policy, ETag and no body; a 304 to an unconditional request is 502 |
| `Range` and `If-Range`, cookies, authorization | never forwarded; the response is the full 200 |
| response metadata | only a valid `Content-Encoding` (gzip, br, zstd, deflate), digits-only `Content-Length`, a quoted `ETag` and valid `Vary` tokens (plus `Accept-Encoding` when encoded) pass; an unknown encoding is 502; every other binding header and the binding's own error body are dropped |

These are explicit **strengthenings** over the current local `serve-dist.mjs` (GET and HEAD only with a 405, reserved namespaces with no fallback, security headers on errors, resolution against the audited inventory), not claims about existing behavior. The adapter has no network, storage, process or credential code beyond `env.ASSETS.fetch`, and a test scans for it.

## Stager (`webApp/tools/stage-hosting.mjs`, `tools/lib/stage-hosting.mjs`)

`node tools/stage-hosting.mjs [--dist <dir>] [--out <new dir>] [--public]` and `--audit <staged dir>`. There is no deploy or upload command.

- The target must not exist: an existing directory, empty or not, one this tool wrote, or a file is refused and never replaced or merged (the earlier "marked directory may be replaced" behavior is removed).
- Containment is checked on real and case-folded paths (no ancestor, descendant or case-equivalent spelling), and a link, junction or alias in the target's ancestry, or as the artifact itself, is refused. Any link, junction or special file inside the artifact, a case-equivalent path pair, and any file that collides with a hosting control name are refused.
- The artifact's provenance is verified, the original files and `provenance.json` are hashed before the copy, each file is re-hashed as it is read, the source is re-inventoried and re-verified afterwards, and the staged tree is compared with the audited inventory; a change during the copy, in the source, or in the staged copy fails and removes only the directory this call created.
- The original audit (`original-audit.json`) and the wrapper inventory (`hosting-manifest.json`: `_worker.js`, `_routes.json`, the hashes of the policy sources) are separate, bound by `stage-manifest.json`, and `auditStage` reports three independent verdicts (original, wrapper, manifests). The artifact's provenance check is never run on the merged tree, and a corrupted wrapper fails only the wrapper verdict while a corrupted original fails only the original verdict. `provenance.json` is hashed on its own.
- Output is deterministic (two stagings give identical wrapper bytes and manifests) and belongs under ignored `webApp/generated`.

## Recorded limits

Nothing here makes the candidate publishable. Hosting, origin, account, free-plan, access, tester policy and explicit upload authority are all still undecided; protection of the actual origin and direct asset URLs must be verified BEFORE any unapproved data is uploaded (an unlisted URL is public, and a preview-access switch does not automatically cover a production host). `cacheControlFor` makes only `trails.<hash>.json` immutable, so a future hash-named data file would revalidate on every load until that policy is deliberately extended in its own reviewed change.
