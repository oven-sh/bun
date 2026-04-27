# WPT fetch `.h2.any.js` conformance results

Vendored from `web-platform-tests/wpt @ ebf8e3069ec4ac6498826bf9066419e46b0f4ac5`.
Three files copied byte-for-byte; the harness supplies `promise_test`/`assert_*`
globals, a `node:http2` server emulating the wptserve endpoints they hit, and a
`fetch()` wrapper that forces ALPN h2.

| Build | pass | todo | fail | total |
|---|---|---|---|---|
| `bun bd` (this branch) | 20 | 4 | 0 | 24 |
| `USE_SYSTEM_BUN=1` | 3 | 4 | 17 | 24 |

The three system-Bun passes are the protocol-agnostic feature-detect cases
(data: URLs, `Request` header inspection); the eleven that flip from fail to
pass are the actual h2 path coverage.

## Passing on this branch

- statusText over H2 for status 200/210/400/404/410/500/502 should be the empty string (×7)
- Fetch with POST with empty ReadableStream
- Fetch with POST with ReadableStream
- Fetch with POST with ReadableStream on 421 response should return the response and not retry.
- Feature detect for POST with ReadableStream
- Feature detect for POST with ReadableStream, using request object
- Synchronous feature detect fails if feature unsupported
- Streaming upload with body containing a number
- ReadbleStream should be closed on signal.abort
- Fetch upload streaming should be accepted on 303
- Fetch upload streaming should fail on 301 / 302 / 307 / 308 (×4)

## Known failures (`test.todo`)

Pre-existing fetch-spec gaps that reproduce identically over HTTP/1.1; none
are HTTP/2 client regressions.

| Test | Cause |
|---|---|
| Synchronous feature detect | `Request` constructor doesn't read `RequestInit.duplex`, so the getter never fires |
| Streaming upload with body containing a String | Bun coerces string chunks instead of rejecting with TypeError |
| Streaming upload with body containing null | Bun treats a `null` chunk as empty instead of rejecting with TypeError |
| Streaming upload should fail on a 401 response | Spec step 14 of HTTP-network-or-cache fetch only applies when "request's window is an environment settings object" — i.e. browsers with credential prompting. Server runtimes (Node/undici, Deno, Bun) return the 401 as-is. Intentionally not changing. |
