# undici fetch/http2 conformance against Bun's HTTP/2 client

Vendored from `nodejs/undici@5878f54` (`test/fetch/http2.js`, the only file
matching `test/fetch/http2*.js`). Only the `require()` block at the top is
rewritten; test bodies are byte-identical to upstream.

`undici-shim.mjs` provides:
- `fetch` → `globalThis.fetch(url, { ...opts, protocol: "http2", tls: { rejectUnauthorized: false } })` for `https:` URLs (drops `dispatcher`)
- `Client`/`Agent`/`Pool` → no-op stubs with `.close()`/`.destroy()`
- `pem.generate()` → returns harness `tls` cert/key
- `closeClientAndServerAsPromise` → inline replacement for `test/utils/node-http`
- `test` → wraps `node:test` so `t.plan(n)` is enforced via an assertion-counting Proxy (Bun's `node:test` shim throws `ERR_NOT_IMPLEMENTED` for `t.plan`)

## Run

```sh
bun bd test test/js/third_party/undici-h2/run.test.ts
```

## Results

| undici sub-test | status |
| --- | --- |
| `[Fetch] Issue#2311` | pass |
| `[Fetch] Simple GET with h2` | pass |
| `[Fetch] Should handle h2 request with body (string or buffer)` | pass |
| `[Fetch] Should handle h2 request with body (stream)` | pass |
| `Should handle h2 request with body (Blob)` | pass |
| `Should handle h2 request with body (Blob:ArrayBuffer)` | pass |
| `Issue#2415` | pass |
| `Issue #2386` | pass |
| `Issue #3046` (multiple `set-cookie`) | pass |
| `[Fetch] Empty POST without h2 has Content-Length` | pass |
| `[Fetch] Empty POST with h2 has Content-Length` | pass |

**11/11 pass** on the debug build. Regression check: `USE_SYSTEM_BUN=1` → 1/11
pass (only the plain-http test), confirming the suite exercises the h2 path.

## Skipped

The other `test/http2-*.js` files in undici (`http2-goaway.js`, `http2-abort.js`,
`http2-stream.js`, etc.) test the `Client`/`Agent` dispatcher API rather than
`fetch()`, so they are out of scope for this harness. `h2c-client.js` needs
prior-knowledge cleartext h2 (not yet supported).

## Updating

```sh
git -C ~/code/undici pull
cp ~/code/undici/test/fetch/http2.js test/js/third_party/undici-h2/http2.js
# re-apply the require() rewrite at the top (see git history)
```
