# HTTP/2 Client Test Port Plan

Third-party h2 *client* test cases mined from `golang/net`, `nodejs/undici`, and `denoland/deno` for porting into `test/js/web/fetch/fetch-http2-client.test.ts`.

**Already covered in Bun:** GET round-trip, POST body, large body (70KB+20MB), gzip decode, concurrent multiplex, abort→RST_STREAM siblings survive, MAX_CONCURRENT_STREAMS cap, sequential keep-alive, GOAWAY reconnect, cold-start coalescing, feature-flag-off.

Repos cloned to `~/code/{golang-net,undici,deno}` (shallow).

---

## golang/net — `http2/transport_test.go` (5793 lines, gold standard)

Go uses a synthetic frame-level harness (`newTestClientConn`) that lets the test write raw frames at the client and assert outbound frames. Bun's harness uses a real `node:http2` server, so some of these need a raw-TCP fake server that speaks the h2 wire format directly (noted as **needs raw server**).

| Test name | file:line | What it asserts | Priority | Notes for Bun port |
|---|---|---|---|---|
| `testTransportResPattern` (36 combinations) | :1059 | All combinations of `{100-continue, headers via 1/CONTINUATION, with/without DATA, trailers via 1/CONTINUATION}` round-trip and decode correctly. | **high** | Port a representative subset (4–6 cases) using `node:http2` server `waitForTrailers` + `writeContinue()`. CONTINUATION-split variants need raw server or large header padding to force CONTINUATION. |
| `TestTransportUnknown1xx` | :1145 | Multiple unknown 1xx (110, 111, …) before final 200 are ignored; final response status/body intact. | **high** | `stream.additionalHeaders({':status': 110})` repeatedly before `respond({':status':200})`. |
| `TestTransportReceiveUndeclaredTrailer` | :1194 | Second HEADERS (no `Trailer:` advertised) treated as trailers, accessible after body. | **high** | `waitForTrailers` + `sendTrailers`. fetch surfaces via `Response.prototype` (Bun has no `.trailers` yet — assert no crash + body correct). |
| `TestTransportInvalidTrailer_Pseudo/Capital/Empty/Binary` | :1228–1261 | Trailers containing `:colon`, uppercase name, empty name, or `\n` in value → stream-level error; client RSTs PROTOCOL_ERROR. | med | `sendTrailers` with bad keys; nghttp2 may pre-validate so likely **needs raw server**. |
| `TestTransportChecksRequestHeaderListSize` | :1416 | Request headers > server's `SETTINGS_MAX_HEADER_LIST_SIZE` rejected client-side (no HEADERS sent). | med | `createSecureServer({settings:{maxHeaderListSize:16384}})`, send 32KB header, assert error before network. |
| `TestTransportChecksResponseHeaderListSize` | :1511 | Response headers >10MB (HPACK-compressed to ~6KB via repeated keys) → stream error, not OOM. | **high** | Real DoS surface. Server `respond` with `Object.fromEntries(Array(5000).fill(['a'.repeat(1024),'a'.repeat(1024)]))` — nghttp2 may cap; likely **needs raw server**. |
| `TestTransportCookieHeaderSplit` | :1560 | `Cookie: a=b;c=d; e=f` is split into separate `cookie:` h2 header lines per RFC 9113 §8.2.3. | **high** | `server.on('stream',(s,h,_,raw)=>{...})` — assert `raw` has multiple `cookie` entries. |
| `TestTransportWindowUpdateBeyondLimit` | :1842 | WINDOW_UPDATE that pushes window past 2³¹−1 → RST FLOW_CONTROL_ERROR (stream) / conn close (conn-level). | med | **Needs raw server** (node:http2 won't send invalid increments). |
| `TestTransportRejectsConnHeaders` | :1894 | Request `Upgrade`, `Connection: foo`, `Transfer-Encoding: foo` → error; `Connection: close/keep-alive`, `Keep-Alive`, `Proxy-Connection` → silently stripped. | **high** | Echo headers seen by server; assert stripped/erroring matrix. |
| `TestTransportRejectsContentLengthWithSign` | :2008 | Response `content-length: +3` / `-3` rejected. | low | Easy port with `respond({'content-length':'+3'})`. |
| `TestTransportReadHeadResponse` | :2143 | HEAD with `content-length:123` + END_STREAM=false + empty DATA → body empty, ContentLength=123. | **high** | nghttp2 HEAD: `respond({...,'content-length':'123'},{endStream:false}); stream.end()`. |
| `TestTransportReadHeadResponseWithBody` | :2170 | HEAD response with actual DATA payload (protocol violation) → body discarded, no crash. | **high** | **Needs raw server** (nghttp2 won't send body for HEAD). |
| `TestTransportFlowControl` | :2248 | Client withholds WINDOW_UPDATE until user consumes body (buffered backpressure). | med | Bun's design replenishes incrementally regardless of consumption — verify our 20MB test exercises this; otherwise skip (different design). |
| `TestTransportUsesGoAwayDebugError` | :2318 | Two GOAWAYs (NO_ERROR+debug, then ERR+nil) → error surfaces last code + first debug data. | low | **Needs raw server**. |
| `TestTransportReturnsUnusedFlowControl` | :2380 | Body.Close() after partial read → RST CANCEL + connection-level WINDOW_UPDATE for unread bytes. DATA arriving after RST also credited. | **high** | Stream 5KB, fetch with `r.body.cancel()` after 1 byte; server asserts stream `rstCode===8` and second request still works on same conn (window not leaked). |
| `TestTransportAdjustsFlowControl` | :2468 | 1MB upload: client respects 64KB initial send-window, then sends rest after server SETTINGS+WINDOW_UPDATE. | **high** | Directly tests streaming-body send-side flow control we're about to build. Server with default 64KB initial; assert all 1MB arrives. |
| `TestTransportReturnsDataPaddingFlowControl` | :2525 | Padded DATA: client credits padding bytes back via WINDOW_UPDATE (window deficit = data only, not padding+len byte). | **high** | **Needs raw server** to send `writeDataPadded`. |
| `TestTransportReturnsErrorOnBadResponseHeaders` | :2563 | Response header name `"  content-type"` (leading space) → stream error + RST PROTOCOL_ERROR sent. | **high** | **Needs raw server**. |
| `TestTransportBodyDoubleEndStream` | :2617 | Reader returning `(n>0, EOF)` doesn't cause double END_STREAM DATA frames. | med | Relevant once `.stream` body lands; use a `ReadableStream` with single chunk + close. Server `on('frameError')` shouldn't fire. |
| `TestTransportRequestPathPseudo` | :2640 | `:path` derivation for edge URLs (`//foo`, opaque, CONNECT). | low | Unit-level; port `//foo` and CONNECT cases. |
| `TestClientConnPing` | :2799 | Explicit Ping API round-trips. | low | N/A — fetch has no ping API. |
| `TestTransportCloseAfterLostPing` | :2894 | ReadIdleTimeout → PING → no ACK within PingTimeout → conn closed, request errors. | med | Only if Bun adds idle-ping. |
| `TestTransportRetryAfterGOAWAYNoRetry` | :3020 | GOAWAY(err≠NO_ERROR, lastID < req) → request **fails** (not retried). | **high** | We have GOAWAY-reconnect; add the negative case. |
| `TestTransportRetryAfterGOAWAYRetry` | :3047 | GOAWAY(NO_ERROR, lastID < req) → request transparently retried on new conn. | **high** | We test this; verify lastID < ourID specifically (server `goaway(0,0)`). |
| `TestTransportRetryAfterGOAWAYSecondRequest` | :3094 | Req1 ok; req3 hit by GOAWAY(PROTOCOL_ERROR, lastID=1) → req3 retried (server claims unprocessed). | med | Subtle: even non-NO_ERROR retries if lastID < reqID. |
| `TestTransportRetryAfterRefusedStream` | :3160 | RST REFUSED_STREAM → retry on **same** connection with new stream id. | **high** | nghttp2 server: `stream.close(http2.constants.NGHTTP2_REFUSED_STREAM)` first time, respond second. |
| `TestTransportRetryHasLimit` | :3202 | Infinite REFUSED_STREAM eventually gives up (~5 retries, exponential backoff). | med | Server always refuses; assert eventual error, ≥5 streams seen. |
| `TestTransportResponseDataBeforeHeaders` | :3241 | DATA before HEADERS on a stream → stream PROTOCOL_ERROR; sibling on same conn unaffected. | **high** | **Needs raw server**. |
| `TestTransportNoBodyMeansNoDATA` | :3530 | GET with no body → HEADERS has END_STREAM, no zero-length DATA follows. | med | Server `on('data')` should never fire; `headers[':method']` arrives with stream half-closed. |
| `TestTransportHandlesInvalidStatuslessResponse` | :3624 | Response HEADERS with no `:status` + DATA → no crash, request errors. | **high** | **Needs raw server**. |
| `TestTransportBodyEagerEndStream` | :3949 | Buffered body (known length) → END_STREAM on the last DATA frame, not separate empty DATA. | med | Server-side `stream.on('data')` count + `stream.on('end')` ordering; or raw-frame assertion. |
| `TestTransportBodyLargerThanSpecifiedContentLength` | :3989 | Streaming body produces > declared Content-Length → client RSTs stream and errors. | med | `ReadableStream` body + manual `content-length:3`, push 6 bytes. |
| `TestTransportServerResetStreamAtHeaders` | :4129 | `Expect: 100-continue` + server replies 401 (no 100) → request body never sent, no error. | **high** | `server.on('checkContinue', (req,res)=>res.writeHead(403).end())`. |
| `TestTransportExpectContinue` | :4176 | `Expect: 100-continue`: `/` → body read; `/reject` → 403, body NOT read (never read from stream). | **high** | Track if request body's `pull()` was called. |
| `TestTransportNoRetryOnStreamProtocolError` | :4569 | RST PROTOCOL_ERROR on stream 3 → fails immediately, NOT retried; sibling stream 1 unaffected. | **high** | `stream.close(NGHTTP2_PROTOCOL_ERROR)` on path /b, normal on /a. |
| `TestTransportContentLengthWithoutBody` | :4707 | Response `content-length:42` + END_STREAM with no DATA → body read errors (UnexpectedEOF). `content-length:0` → ok. | **high** | `respond({'content-length':'42'},{endStream:true})`. |
| `TestTransportDataAfter1xxHeader` | :5132 | `:status:100` then DATA (no final headers) → PROTOCOL_ERROR + RST. | med | **Needs raw server**. |
| `TestTransport1xxLimits` | :5207 | >N consecutive 103 Early Hints with large headers → eventually RST (header bytes capped). | med | Loop `stream.additionalHeaders({':status':103,'x':'a'.repeat(1000)})` 50×. |
| `TestTransportDoNotHangOnZeroMaxFrameSize` | :5690 | Server SETTINGS `MAX_FRAME_SIZE=0` (invalid) → request with body doesn't infinite-loop. | **high** | `createSecureServer({settings:{maxFrameSize:0}})` — nghttp2 may clamp; if so **needs raw server**. |

---

## nodejs/undici — `test/http2-*.js`, `test/fetch/http2.js` (~4400 lines)

undici uses real `node:http2.createSecureServer`, so server-side snippets translate directly to our harness.

| Test name | file:line | What it asserts | Priority | Notes for Bun port |
|---|---|---|---|---|
| `Should handle http2 trailers` | http2-trailers.js:12 | `waitForTrailers` → `sendTrailers({'x-trailer':'hello'})` surfaces in client trailers. | **high** | Direct paste; for fetch, assert no crash + body intact (trailers API TBD). |
| `Should handle h2 continue` | http2-continue.js:12 | `Expect: 100-continue` → server `checkContinue` event → `writeContinue()` → body sent → 200 received. | **high** | Direct paste. |
| `Should provide pseudo-headers in proper order` | http2-pseudo-headers.js:12 | rawHeaders array is `[:authority, :method, :path, :scheme]` (pseudo first, fixed order). | med | Order-sensitive; check `rawHeaders` arg of `on('stream')`. |
| `h2 pseudo-headers not in headers` | http2-pseudo-headers.js:58 | `response.headers[':status']` is undefined. | **high** | Trivial port; we likely pass already but should pin. |
| `surface invalid connection headers` | http2-invalid-connection-headers.js:13 | Conn-specific request header → catchable error; subsequent queued request still proceeds on new conn. | med | undici-internal; for Bun, instead test that `fetch(url,{headers:{Connection:'upgrade'}})` over h2 strips/errors and second fetch succeeds. |
| `Should throw on half-closed streams (remote)` | http2-stream.js:12 | Server `stream.destroy()` immediately → client gets typed error; second request also errors (not hangs). | **high** | Direct paste; assert `cause.code` or message. |
| `multiple header values with semicolon` | http2-connection.js:185 | Array-valued + duplicated `cookie`/custom headers join correctly (`; ` for cookie, `, ` for others). | med | Mirrors Go cookie-split from server's view. |
| `#5089 GOAWAY Gracefully` | http2-goaway.js:148 | maxConcurrentStreams=2; after 2 streams server GOAWAYs; remaining 4 of 6 requests succeed on new session; sessionCounts=[2,4]. | **high** | More thorough than our existing GOAWAY test — ports cleanly. |
| `GOAWAY resets unaccepted, requeues replayable` | http2-goaway-retry-body.js:40 | On GOAWAY(lastID): accepted (id≤last) keep going; replayable (buffered body, id>last) requeued; streaming-body (id>last) **errors** (not safe to replay). | **high** | Key semantic: streaming body NOT retried. Port as 3-request scenario once `.stream` body lands. |
| `ignore late http2 data after completion` | http2-late-data.js:79 | DATA arriving after trailers (END_STREAM) doesn't crash or invoke onData. | med | **Needs raw server** for true late DATA; undici's version uses mocks. |
| `Should handle h2 GET/HEAD with body` | http2-body.js:211 | GET/HEAD with request body still sends DATA; HEAD response body empty. | low | fetch spec strips GET/HEAD bodies — likely N/A for `fetch()`. |
| `request body (stream/iterable/Blob/FormData)` | http2-body.js:151,286,355,417,482 | Each body type round-trips bytes correctly over h2. | **high** | Port all 5 once streaming bodies land. |
| `Issue#2415` Headers ctor | fetch/http2.js:370 | `new Headers(response.headers)` doesn't throw (no `:status` in iterable). | med | Trivial port. |
| `Issue #3046` set-cookie array | fetch/http2.js:464 | `respond({'set-cookie':['a=b','c=d']})` → `response.headers.getSetCookie()` returns both. | **high** | Direct paste; tests our header decode preserves repeated values. |
| `Empty POST has Content-Length:0` | fetch/http2.js:541 | Empty POST over h2 still sends `content-length: 0`. | med | Echo `headers['content-length']`. |
| `Send PING frames` / `not after close` | http2-dispatcher.js:639,781 | Periodic client PING; stops after close. | low | Only if Bun adds ping interval. |

---

## denoland/deno — `tests/unit/fetch_test.ts`, `ext/fetch/tests.rs`

Deno's fetch h2 coverage is thin (relies on hyper); mostly version-negotiation tests.

| Test name | file:line | What it asserts | Priority | Notes for Bun port |
|---|---|---|---|---|
| `fetchSupportsHttp2` | fetch_test.ts:1631 | ALPN auto-selects h2; server sees `HTTP/2.0`. | covered | We have this. |
| `fetchForceHttp1OnHttp2Server` | fetch_test.ts:1643 | `createHttpClient({http2:false,http1:true})` against h2-only server → rejects. | med | Maps to our planned `protocol:` option / flag-off. |
| `fetchForceHttp2OnHttp1Server` | fetch_test.ts:1655 | `{http2:true,http1:false}` against h1-only → rejects. | med | Port once `protocol:"h2"` lands. |
| `fetchPrefersHttp2` | fetch_test.ts:1667 | Dual-stack server → h2 preferred. | low | We have this implicitly. |
| `[node/http2 client] uppercase headers no panic` | unit_node/http2_test.ts:314 | Uppercase request header name → lowercased on wire, no panic. | med | Maps to our HPACK encoder; easy port. |
| Rust `tests.rs` h2 cases | ext/fetch/tests.rs | DNS resolver + h2 + proxy plumbing. | low | Infra-specific to hyper. |

---

## "Needs raw server" harness

Seven Go tests (padded DATA, DATA-before-HEADERS, missing `:status`, bad header name, WINDOW_UPDATE overflow, HEAD-with-body, MAX_FRAME_SIZE=0, late DATA, 1xx-then-DATA) require sending **invalid** frames that `node:http2` won't emit. Recommended one-time investment:

```ts
// test/js/web/fetch/h2-raw-server.ts
import { wire } from "bun:internal-for-testing"; // or hand-roll FrameHeader
import tls from "node:tls";
function rawH2Server(onStream: (write: (type, flags, sid, payload) => void, hpackEnc) => void) {
  return tls.createServer({...tls, ALPNProtocols: ["h2"]}, sock => {
    // read 24-byte preface, read SETTINGS, ack, then call onStream with frame-writer
  });
}
```

Or piggy-back on `src/http/H2FrameParser.zig` exposed via `bun:internal-for-testing` for encode helpers.

---

## Top 10 to port first

Ordered by (correctness risk × ease of porting). All but #7/#9 use stock `http2.createSecureServer`.

### 1. Response trailers (undici http2-trailers.js:12)
```js
server.on('stream', (stream) => {
  stream.respond({':status': 200, 'content-type': 'text/plain'}, {waitForTrailers: true});
  stream.on('wantTrailers', () => stream.sendTrailers({'x-trailer': 'hello'}));
  stream.end('body');
});
// Client: assert body === 'body' and (once API exists) trailers['x-trailer'] === 'hello'; for now assert no crash, exitCode 0.
```

### 2. REFUSED_STREAM → retry on same connection (Go :3160)
```js
let attempts = 0;
server.on('stream', (stream) => {
  attempts++;
  if (attempts === 1) return stream.close(http2.constants.NGHTTP2_REFUSED_STREAM);
  stream.respond({':status': 204}); stream.end();
});
// Client: single fetch resolves 204; server sees attempts === 2, sessions === 1.
```

### 3. RST PROTOCOL_ERROR is NOT retried; sibling survives (Go :4569)
```js
server.on('stream', (stream, h) => {
  if (h[':path'] === '/bad') return stream.close(http2.constants.NGHTTP2_PROTOCOL_ERROR);
  setTimeout(() => { stream.respond({':status':200}); stream.end('ok'); }, 50);
});
// Client: Promise.allSettled([fetch('/good'), fetch('/bad')]) → good=200, bad rejected; sessions === 1.
```

### 4. Expect: 100-continue, server rejects → body never sent (Go :4176 + :4129)
```js
server.on('checkContinue', (req, res) => {
  if (req.url === '/reject') { res.writeHead(403); res.end(); return; }
  res.writeContinue();
  req.on('data', c => chunks.push(c));
  res.writeHead(200); res.end();
});
// Client: ReadableStream body with `pull` counter + header Expect:100-continue.
//   /accept → 200, pulls > 0;  /reject → 403, pulls === 0.
```

### 5. Content-Length lies (no body) (Go :4707)
```js
server.on('stream', (stream) => {
  stream.respond({':status':200, 'content-length':'42'}, {endStream: true});
});
// Client: await res.text() rejects (UnexpectedEOF / body-too-short).
// Second case: content-length:'0' → resolves "".
```

### 6. Connection-specific request headers stripped/rejected (Go :1894)
```js
server.on('stream', (stream, h) => {
  stream.respond({':status':200, 'x-got': Object.keys(h).filter(k=>!k.startsWith(':')).sort().join(',')});
  stream.end();
});
// Client: fetch with {Connection:'keep-alive', 'Keep-Alive':'x', 'Proxy-Connection':'y', 'Transfer-Encoding':'chunked', Upgrade:'ws'}.
// Assert x-got contains none of them; OR fetch throws for Upgrade.
```

### 7. Padded DATA flow-control credit (Go :2525) — **needs raw server**
```js
// Raw TLS server: after client HEADERS, send HEADERS(:status 200, content-length 5000),
// then DATA(streamID, flags=PADDED, payload=[padLen=5, ...5000 bytes, ...5 pad]).
// Then send second 5000-byte DATA with no padding (would stall if client failed to credit pad).
// Assert client receives 10000 bytes total.
```

### 8. Multiple Set-Cookie response headers (undici fetch/http2.js:464)
```js
server.on('stream', (stream) => {
  stream.respond({':status':200, 'set-cookie': ['a=b','c=d']});
  stream.end();
});
// Client: res.headers.getSetCookie() → ['a=b','c=d']; res.headers.get('set-cookie') → 'a=b, c=d'.
```

### 9. Missing :status pseudo-header (Go :3624) — **needs raw server**
```js
// Raw: send HEADERS with only `content-type:text/html`, then DATA. Assert fetch rejects, process doesn't crash.
```

### 10. GOAWAY with lastStreamID < ours: replayable retried, streaming-body errored (undici http2-goaway-retry-body.js:40)
```js
// settings:{maxConcurrentStreams:3}. Client fires: req1 (GET), req2 (POST Buffer), req3 (POST ReadableStream).
// After all 3 streams open, server: session.goaway(0, 1, Buffer.alloc(0)). // lastID=1
// Expect: req1 200; req2 transparently retried on new conn → 200; req3 rejects (body not replayable); sessions === 2.
let sess = 0; server.on('session', s => { sess++; });
server.on('stream', (stream, h) => {
  if (sess === 1 && stream.id > 1) return; // let goaway kill them
  let body=[]; stream.on('data',c=>body.push(c)); stream.on('end',()=>{
    stream.respond({':status':200}); stream.end(String(stream.id));
  });
  if (sess === 1 && stream.id === 1) setTimeout(()=>stream.session.goaway(0,1), 30);
});
```

---

## Secondary batch (after top 10)

- Cookie header splitting on **request** side (Go :1560 / undici http2-connection.js:185)
- Unknown-1xx ignored (Go :1145) — `stream.additionalHeaders({':status':110})` ×3 then `respond(200)`
- HEAD with `content-length` but no body (Go :2143)
- Retry limit on infinite REFUSED_STREAM (Go :3202)
- `:status` not in `Response.headers` (undici http2-pseudo-headers.js:58)
- Server `stream.destroy()` → typed error, second request still works (undici http2-stream.js:12)
- Upload backpressure: 1MB body with default 64KB initial send-window (Go :2468) — gates streaming-body work
- Body eager END_STREAM / no double END_STREAM (Go :3949, :2617)
- Response header list size cap / DoS (Go :1511) — needs raw server
- 1xx storm limit (Go :5207)
- MAX_FRAME_SIZE=0 doesn't hang (Go :5690)
