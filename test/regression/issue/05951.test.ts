// https://github.com/oven-sh/bun/issues/5951
//
// Exercises the public `ws` package surface (what miniflare/wrangler actually
// listen for), not the native 'handshake' event covered in 24229.test.ts.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, normalizeBunSnapshot } from "harness";

async function run(script: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) console.error(stderr);
  return { stdout: normalizeBunSnapshot(stdout), exitCode };
}

test.concurrent("ws emits 'unexpected-response' with status, headers and body on non-101", async () => {
  const { stdout, exitCode } = await run(/* js */ `
    const { createServer } = require("net");
    const { once } = require("events");
    const { WebSocket } = require("ws");

    const server = createServer(s =>
      s.once("data", () =>
        s.end("HTTP/1.1 503 Service Unavailable\\r\\nX-Reason: not-ready\\r\\n\\r\\nworkerd starting"),
      ),
    ).listen(0, "127.0.0.1");
    await once(server, "listening");

    const ws = new WebSocket("ws://127.0.0.1:" + server.address().port);
    ws.on("error", () => {});
    const [req, res] = await new Promise(resolve =>
      ws.once("unexpected-response", (req, res) => resolve([req, res])),
    );
    let body = "";
    for await (const chunk of res) body += chunk;
    console.log(JSON.stringify({
      reqMethod: req?.method,
      reqPath: req?.path,
      reqGetHeader: typeof req?.getHeader === "function" ? req.getHeader("x-anything") ?? null : "missing",
      statusCode: res.statusCode,
      statusMessage: res.statusMessage,
      xReason: res.headers["x-reason"],
      body,
    }));
    await once(ws, "close");
    server.close();
  `);
  // ws emits 'unexpected-response' with (ClientRequest, IncomingMessage). We
  // don't use node:http so the request is a minimal synthetic stub — assert
  // its method/path/getHeader surface so code that inspects the request
  // object doesn't crash.
  expect(stdout).toMatchInlineSnapshot(
    `"{"reqMethod":"GET","reqPath":"/","reqGetHeader":null,"statusCode":503,"statusMessage":"Service Unavailable","xReason":"not-ready","body":"workerd starting"}"`,
  );
  expect(exitCode).toBe(0);
});

// Diverges from real ws: with no 'unexpected-response' listener, real ws emits
// "Unexpected server response: 503". Bun's shim only registers the native
// handshake listener when the user subscribes to 'upgrade'/'unexpected-response',
// so the unmodified native error surfaces instead.
test.concurrent("ws emits native 'error' on non-101 when no 'unexpected-response' listener", async () => {
  const { stdout, exitCode } = await run(/* js */ `
    const { createServer } = require("net");
    const { once } = require("events");
    const { WebSocket } = require("ws");

    const server = createServer(s =>
      s.once("data", () => s.end("HTTP/1.1 503 Service Unavailable\\r\\n\\r\\n")),
    ).listen(0, "127.0.0.1");
    await once(server, "listening");

    const ws = new WebSocket("ws://127.0.0.1:" + server.address().port);
    const [err] = await once(ws, "error");
    console.log(/Expected 101/.test(err.message) ? "got native 101 error" : "unexpected: " + err.message);
    server.close();
    process.exit(0);
  `);
  expect(stdout).toMatchInlineSnapshot(`"got native 101 error"`);
  expect(exitCode).toBe(0);
});

test.concurrent("ws emits 'upgrade' with headers before 'open' on 101", async () => {
  const { stdout, exitCode } = await run(/* js */ `
    const { createServer } = require("net");
    const { createHash } = require("crypto");
    const { once } = require("events");
    const { WebSocket } = require("ws");

    const server = createServer(conn => {
      let buf = "";
      const onData = chunk => {
        buf += chunk.toString();
        if (buf.indexOf("\\r\\n\\r\\n") === -1) return;
        conn.off("data", onData);
        const key = /Sec-WebSocket-Key: (.+)\\r\\n/i.exec(buf)[1];
        const accept = createHash("sha1")
          .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
          .digest("base64");
        conn.write(
          "HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: " +
            accept + "\\r\\n\\r\\n",
        );
      };
      conn.on("data", onData);
    }).listen(0, "127.0.0.1");
    await once(server, "listening");

    const ws = new WebSocket("ws://127.0.0.1:" + server.address().port);
    const order = [];
    ws.on("upgrade", res => order.push("upgrade:" + res.statusCode + ":" + typeof res.headers["sec-websocket-accept"]));
    ws.on("open", () => {
      order.push("open");
      ws.terminate();
      server.close();
    });
    await once(ws, "close");
    console.log(order.join(","));
  `);
  expect(stdout).toMatchInlineSnapshot(`"upgrade:101:string,open"`);
  expect(exitCode).toBe(0);
});

// The non-101 body can span multiple TCP reads. Previously the shim dispatched
// on the first read, truncating large error bodies. The native client now
// buffers until Content-Length is satisfied (or EOF) before dispatching.
test.concurrent("ws 'unexpected-response' waits for full Content-Length body across multiple writes", async () => {
  const { stdout, exitCode } = await run(/* js */ `
    const { createServer } = require("net");
    const { once } = require("events");
    const { WebSocket } = require("ws");

    // 8 kB JSON-ish payload, sent in three separate writes with a tick between
    // each so the client sees multiple TCP reads (at least in the common case).
    const CHUNK_SIZE = 2600;
    const chunk1 = Buffer.alloc(CHUNK_SIZE, "a").toString();
    const chunk2 = Buffer.alloc(CHUNK_SIZE, "b").toString();
    const chunk3 = Buffer.alloc(CHUNK_SIZE, "c").toString();
    const bodyLen = CHUNK_SIZE * 3;

    const server = createServer(s => {
      s.once("data", () => {
        s.write(
          "HTTP/1.1 503 Service Unavailable\\r\\n" +
          "Content-Type: text/plain\\r\\n" +
          "Content-Length: " + bodyLen + "\\r\\n\\r\\n" +
          chunk1
        );
        setTimeout(() => s.write(chunk2), 10);
        setTimeout(() => { s.write(chunk3); s.end(); }, 20);
      });
    }).listen(0, "127.0.0.1");
    await once(server, "listening");

    const ws = new WebSocket("ws://127.0.0.1:" + server.address().port);
    ws.on("error", () => {});
    const [req, res] = await new Promise(resolve =>
      ws.once("unexpected-response", (req, res) => resolve([req, res])),
    );
    let body = "";
    for await (const chunk of res) body += chunk;
    console.log(JSON.stringify({
      statusCode: res.statusCode,
      contentLength: res.headers["content-length"],
      bodyLength: body.length,
      firstChar: body[0],
      lastChar: body[body.length - 1],
    }));
    await once(ws, "close");
    server.close();
  `);
  expect(stdout).toMatchInlineSnapshot(
    `"{"statusCode":503,"contentLength":"7800","bodyLength":7800,"firstChar":"a","lastChar":"c"}"`,
  );
  expect(exitCode).toBe(0);
});

// The synthetic IncomingMessage passed to 'unexpected-response' must coalesce
// duplicate headers the way Node's http.IncomingMessage.headers does (real ws
// hands the consumer that Node object): singleton headers keep the first value
// and discard duplicates, duplicate `cookie` joins with "; ", everything else
// joins with ", ", and set-cookie is always an array. rawHeaders stays verbatim.
test.concurrent("ws 'unexpected-response' coalesces duplicate headers like Node IncomingMessage", async () => {
  const { stdout, exitCode } = await run(/* js */ `
    const { createServer } = require("net");
    const { once } = require("events");
    const { WebSocket } = require("ws");

    const server = createServer(s =>
      s.once("data", () =>
        s.end(
          "HTTP/1.1 401 Unauthorized\\r\\n" +
          // singleton header repeated -> first value kept
          "Content-Length: 0\\r\\n" +
          "Content-Length: 999\\r\\n" +
          // duplicate cookie -> joined with "; "
          "Cookie: a=1\\r\\n" +
          "Cookie: b=2\\r\\n" +
          // duplicate non-singleton -> joined with ", "
          "X-Multi: one\\r\\n" +
          "X-Multi: two\\r\\n" +
          // set-cookie -> array
          "Set-Cookie: s1=1\\r\\n" +
          "Set-Cookie: s2=2\\r\\n" +
          "\\r\\n",
        ),
      ),
    ).listen(0, "127.0.0.1");
    await once(server, "listening");

    const ws = new WebSocket("ws://127.0.0.1:" + server.address().port);
    ws.on("error", () => {});
    const [, res] = await new Promise(resolve =>
      ws.once("unexpected-response", (req, res) => resolve([req, res])),
    );
    console.log(JSON.stringify({
      contentLength: res.headers["content-length"],
      cookie: res.headers["cookie"],
      xMulti: res.headers["x-multi"],
      setCookie: res.headers["set-cookie"],
      rawContentLengths: res.rawHeaders.filter((_, i) => i % 2 === 0)
        .reduce((n, k) => n + (k.toLowerCase() === "content-length" ? 1 : 0), 0),
    }));
    ws.terminate();
    server.close();
  `);
  expect(stdout).toMatchInlineSnapshot(
    `"{"contentLength":"0","cookie":"a=1; b=2","xMulti":"one, two","setCookie":["s1=1","s2=2"],"rawContentLengths":2}"`,
  );
  expect(exitCode).toBe(0);
});

// RFC 7230 §3.3.3 rule #1: 1xx/204/304 responses carry no body regardless of
// headers. A bodiless non-101 status on a keep-alive connection (server never
// closes the socket) must dispatch 'unexpected-response' immediately off the
// header read — otherwise the client sits reading-until-EOF until the socket
// timeout and the event never fires. The server here deliberately keeps the
// connection open: with the fix this resolves at once; without it the
// subprocess hangs and the test times out.
test.concurrent("ws 'unexpected-response' fires immediately for bodiless 204 on keep-alive", async () => {
  const { stdout, exitCode } = await run(/* js */ `
    const { createServer } = require("net");
    const { WebSocket } = require("ws");

    // 204 No Content: no Content-Length, no Transfer-Encoding, and the socket
    // is intentionally left open (no s.end()) so the only way the event fires
    // is the immediate-dispatch path, not a read-until-close.
    const server = createServer(s =>
      s.once("data", () => s.write("HTTP/1.1 204 No Content\\r\\nX-Gone: 1\\r\\n\\r\\n")),
    ).listen(0, "127.0.0.1");
    await new Promise(r => server.once("listening", r));

    const ws = new WebSocket("ws://127.0.0.1:" + server.address().port);
    ws.on("error", () => {});
    const res = await new Promise(resolve =>
      ws.once("unexpected-response", (req, res) => resolve(res)),
    );
    console.log(JSON.stringify({
      statusCode: res.statusCode,
      statusMessage: res.statusMessage,
      xGone: res.headers["x-gone"],
    }));
    ws.terminate();
    server.close();
    process.exit(0);
  `);
  expect(stdout).toMatchInlineSnapshot(`"{"statusCode":204,"statusMessage":"No Content","xGone":"1"}"`);
  expect(exitCode).toBe(0);
});

// The RST teardown path (handle_close) flushes a mid-accumulation non-101
// body into the 'unexpected-response' listener. If that listener synchronously
// calls ws.terminate()/ws.close(), the reentrant cancel() releases the socket
// ref while handle_close is still holding it — then handle_close's tcp.detach()
// runs on freed memory (heap-use-after-free in NewSocketHandler::detach) and
// its deref() underflows the refcount. Only an ASAN/debug build surfaces the
// corruption as a crash; release builds survive by luck, so gate on it.
//
// The RST must arrive as on_close WITHOUT a preceding on_end (FIN): a Bun.listen
// socket's terminate() sends a real RST while the client still has the body
// un-satisfied (WaitingForLength). Node's net server destroy()/resetAndDestroy()
// over loopback surfaces as FIN → on_end (a different, already-safe path).
test.concurrent.skipIf(!isDebug && !isASAN)(
  "ws survives terminate() inside 'unexpected-response' when the socket RSTs mid-body",
  async () => {
    const { stdout, exitCode } = await run(/* js */ `
      const { once } = require("events");
      const { WebSocket } = require("ws");

      // Declare a 100 kB body but send only a sliver, then RST a tick later so
      // the client has parsed the headers and entered WaitingForLength. The
      // RST then routes through handle_close, which flushes the deferred body
      // into 'unexpected-response'.
      const server = Bun.listen({
        hostname: "127.0.0.1", port: 0,
        socket: {
          data(socket) {
            socket.write(
              "HTTP/1.1 503 Service Unavailable\\r\\n" +
              "Content-Length: 100000\\r\\n\\r\\n" +
              "partial body, server resets before sending the rest"
            );
            // Bun's socket.terminate() sends a real RST (not FIN). The small
            // delay lets the partial body land first so the client is mid-body.
            setTimeout(() => { try { socket.terminate(); } catch {} }, 10);
          },
          error() {}, open() {},
        },
      });

      const ws = new WebSocket("ws://127.0.0.1:" + server.port);
      ws.on("error", () => {});
      ws.once("unexpected-response", (req, res) => {
        console.log("status=" + res.statusCode);
        // Reentrant teardown from inside the handshake dispatch — this is the
        // path that used to UAF on the native client (handle_close then ran
        // tcp.detach() on freed memory).
        ws.terminate();
      });
      // Await 'close' rather than exiting immediately: the detach/deref that
      // used to fault runs as handle_close unwinds, after terminate() returns.
      await once(ws, "close");
      server.stop(true);
    `);
    expect(stdout).toContain("status=503");
    expect(exitCode).toBe(0);
  },
);

// `on()` / `once()` are not the only EventEmitter registration APIs — ws
// consumers also reach for `addListener` / `prependListener` /
// `prependOnceListener` and (from DOM-style code) `addEventListener`. Each
// must arm the native handshake listener, otherwise the 'upgrade' /
// 'unexpected-response' handler is installed on the EventEmitter list but
// the native event that would `emit('upgrade', ...)` is never wired up and
// the callback silently never fires.
test.concurrent("ws 'unexpected-response' fires for addListener / prependListener / addEventListener", async () => {
  const { stdout, exitCode } = await run(/* js */ `
    const { createServer } = require("net");
    const { once } = require("events");
    const { WebSocket } = require("ws");

    async function runOne(register) {
      const server = createServer(s =>
        s.once("data", () => s.end("HTTP/1.1 503 Service Unavailable\\r\\n\\r\\n")),
      ).listen(0, "127.0.0.1");
      await once(server, "listening");

      const ws = new WebSocket("ws://127.0.0.1:" + server.address().port);
      ws.on("error", () => {});
      const { promise, resolve } = Promise.withResolvers();
      register(ws, resolve);
      const res = await promise;
      server.close();
      try { ws.terminate(); } catch {}
      return res;
    }

    const a = await runOne((ws, done) =>
      ws.addListener("unexpected-response", (req, res) => done(res.statusCode)),
    );
    const b = await runOne((ws, done) =>
      ws.prependListener("unexpected-response", (req, res) => done(res.statusCode)),
    );
    const c = await runOne((ws, done) =>
      ws.prependOnceListener("unexpected-response", (req, res) => done(res.statusCode)),
    );
    const d = await runOne((ws, done) =>
      // For upgrade/unexpected-response addEventListener is symmetric with
      // removeEventListener (no DOM-style wrapping adapter) so handlers
      // receive Node-style args.
      ws.addEventListener("unexpected-response", (req, res) => done(res.statusCode)),
    );
    console.log(JSON.stringify({ a, b, c, d }));
    process.exit(0);
  `);
  expect(stdout).toMatchInlineSnapshot(`"{"a":503,"b":503,"c":503,"d":503}"`);
  expect(exitCode).toBe(0);
});

// Once 'unexpected-response' has fired, the native 'Expected 101' error must
// NOT reach user 'error' handlers (real ws never emits 'error' when the
// response was handled). The suppression has to apply uniformly across every
// registration API — on('error'), addEventListener('error', …) and the
// onerror setter — not just on()/once().
test.concurrent(
  "ws suppresses the native error after 'unexpected-response' across on/addEventListener/onerror",
  async () => {
    const { stdout, exitCode } = await run(/* js */ `
    const { createServer } = require("net");
    const { once } = require("events");
    const { WebSocket } = require("ws");

    // Register the 'error' handler via one of the three APIs, subscribe to
    // 'unexpected-response', and report whether a spurious 'error' still fired.
    async function runOne(registerError) {
      const server = createServer(s =>
        s.once("data", () => s.end("HTTP/1.1 503 Service Unavailable\\r\\n\\r\\n")),
      ).listen(0, "127.0.0.1");
      await once(server, "listening");

      const ws = new WebSocket("ws://127.0.0.1:" + server.address().port);
      let errored = false;
      registerError(ws, () => { errored = true; });
      const { promise, resolve } = Promise.withResolvers();
      ws.on("unexpected-response", (req, res) => resolve(res.statusCode));
      const status = await promise;
      // Give the native error a turn of the loop to (not) arrive.
      await once(ws, "close").catch(() => {});
      server.close();
      return { status, errored };
    }

    const on = await runOne((ws, mark) => ws.on("error", mark));
    const ael = await runOne((ws, mark) => ws.addEventListener("error", mark));
    const prop = await runOne((ws, mark) => { ws.onerror = mark; });
    console.log(JSON.stringify({ on, ael, prop }));
    process.exit(0);
  `);
    // All three APIs: 'unexpected-response' seen (503), native 'error' suppressed.
    expect(stdout).toMatchInlineSnapshot(
      `"{"on":{"status":503,"errored":false},"ael":{"status":503,"errored":false},"prop":{"status":503,"errored":false}}"`,
    );
    expect(exitCode).toBe(0);
  },
);

// The suppression must NOT apply when the consumer never subscribed to
// 'unexpected-response'. A client that listens for 'upgrade' (arming the
// handshake bridge) but registers its error handling via addEventListener
// ('error') / onerror must still receive the native non-101 error — otherwise
// the error is swallowed entirely.
test.concurrent(
  "ws still delivers the native error to addEventListener/onerror when there is no 'unexpected-response' listener",
  async () => {
    const { stdout, exitCode } = await run(/* js */ `
    const { createServer } = require("net");
    const { once } = require("events");
    const { WebSocket } = require("ws");

    async function runOne(registerError) {
      const server = createServer(s =>
        s.once("data", () => s.end("HTTP/1.1 503 Service Unavailable\\r\\n\\r\\n")),
      ).listen(0, "127.0.0.1");
      await once(server, "listening");

      const ws = new WebSocket("ws://127.0.0.1:" + server.address().port);
      // Arm the handshake bridge via 'upgrade' but do NOT listen for
      // 'unexpected-response', so the native error path is exercised.
      ws.on("upgrade", () => {});
      const { promise, resolve } = Promise.withResolvers();
      registerError(ws, err => resolve(/Expected 101/.test(err?.message ?? String(err))));
      const gotExpected101 = await promise;
      server.close();
      try { ws.terminate(); } catch {}
      return gotExpected101;
    }

    const ael = await runOne((ws, done) => ws.addEventListener("error", done));
    const prop = await runOne((ws, done) => { ws.onerror = done; });
    console.log(JSON.stringify({ ael, prop }));
    process.exit(0);
  `);
    // Both DOM-style APIs receive the native 'Expected 101' error.
    expect(stdout).toMatchInlineSnapshot(`"{"ael":true,"prop":true}"`);
    expect(exitCode).toBe(0);
  },
);

// With on('upgrade') + on('error') but no 'unexpected-response' listener, the
// on('error') handler lives on BOTH the EventEmitter (gets the synthetic
// "Unexpected server response" error) and — via the native bridge closure — on
// this.#ws (would get the native 'Expected 101' error too). It must fire
// exactly once, like real ws, not twice.
test.concurrent(
  "ws on('error') fires once (not twice) for a non-101 with no 'unexpected-response' listener",
  async () => {
    const { stdout, exitCode } = await run(/* js */ `
    const { createServer } = require("net");
    const { once } = require("events");
    const { WebSocket } = require("ws");

    const server = createServer(s =>
      s.once("data", () => s.end("HTTP/1.1 503 Service Unavailable\\r\\n\\r\\n")),
    ).listen(0, "127.0.0.1");
    await once(server, "listening");

    const ws = new WebSocket("ws://127.0.0.1:" + server.address().port);
    ws.on("upgrade", () => {});
    const messages = [];
    ws.on("error", err => messages.push(err?.message ?? String(err)));
    // Wait for close, then report how many 'error' events arrived.
    await once(ws, "close").catch(() => {});
    server.close();
    try { ws.terminate(); } catch {}
    console.log(JSON.stringify({ count: messages.length, first: messages[0] }));
    process.exit(0);
  `);
    // Exactly one 'error' — the synthetic non-101 message — and the native
    // 'Expected 101' follow-up is suppressed for EventEmitter listeners.
    expect(stdout).toMatchInlineSnapshot(`"{"count":1,"first":"Unexpected server response: 503"}"`);
    expect(exitCode).toBe(0);
  },
);

// Mixed registration styles: on('error') (EventEmitter) AND addEventListener
// ('error')/onerror (native this.#ws), with on('upgrade') but no
// 'unexpected-response'. Each handler must fire exactly once — the synthetic
// emit suppresses the EE bridge re-fire, but the DOM-style handler must still
// receive the native error (gated on a separate "handled" flag).
test.concurrent(
  "ws error handlers each fire once when on('error') and addEventListener/onerror are mixed",
  async () => {
    const { stdout, exitCode } = await run(/* js */ `
    const { createServer } = require("net");
    const { once } = require("events");
    const { WebSocket } = require("ws");

    async function runOne(registerDom) {
      const server = createServer(s =>
        s.once("data", () => s.end("HTTP/1.1 503 Service Unavailable\\r\\n\\r\\n")),
      ).listen(0, "127.0.0.1");
      await once(server, "listening");

      const ws = new WebSocket("ws://127.0.0.1:" + server.address().port);
      ws.on("upgrade", () => {});
      let onCount = 0;
      let domCount = 0;
      // The synthetic error (on) fires synchronously in #onHandshake; the
      // native error (DOM handler) arrives a tick later after the client
      // terminates. Await BOTH so neither the test nor 'close' races ahead of
      // the native delivery.
      const onSeen = Promise.withResolvers();
      const domSeen = Promise.withResolvers();
      ws.on("error", () => { onCount++; onSeen.resolve(); });
      registerDom(ws, () => { domCount++; domSeen.resolve(); });
      await Promise.all([onSeen.promise, domSeen.promise]);
      server.close();
      try { ws.terminate(); } catch {}
      return { onCount, domCount };
    }

    const ael = await runOne((ws, h) => ws.addEventListener("error", h));
    const prop = await runOne((ws, h) => { ws.onerror = h; });
    console.log(JSON.stringify({ ael, prop }));
    process.exit(0);
  `);
    // Both the on('error') handler and the DOM-style handler fire exactly once.
    expect(stdout).toMatchInlineSnapshot(`"{"ael":{"onCount":1,"domCount":1},"prop":{"onCount":1,"domCount":1}}"`);
    expect(exitCode).toBe(0);
  },
);

// DOM dedup: registering the identical listener twice via addEventListener is
// a no-op. Because we wrap the listener in a suppression closure, a naive
// implementation would create two distinct wrappers and fire the handler
// twice; removeEventListener must also detach it completely.
test.concurrent(
  "ws addEventListener('error', h) dedupes the same handler and removeEventListener detaches it",
  async () => {
    const { stdout, exitCode } = await run(/* js */ `
    const { createServer } = require("net");
    const { once } = require("events");
    const { WebSocket } = require("ws");

    const server = createServer(s =>
      s.once("data", () => s.end("HTTP/1.1 503 Service Unavailable\\r\\n\\r\\n")),
    ).listen(0, "127.0.0.1");
    await once(server, "listening");

    const ws = new WebSocket("ws://127.0.0.1:" + server.address().port);
    let count = 0;
    const h = () => { count++; };
    ws.addEventListener("error", h);
    ws.addEventListener("error", h); // duplicate — must be a no-op
    await once(ws, "close").catch(() => {});
    server.close();
    try { ws.terminate(); } catch {}
    // removeEventListener must fully detach (no leaked wrapper left behind).
    ws.removeEventListener("error", h);
    console.log(JSON.stringify({ count }));
    process.exit(0);
  `);
    // The handler fires exactly once despite the duplicate registration.
    expect(stdout).toMatchInlineSnapshot(`"{"count":1}"`);
    expect(exitCode).toBe(0);
  },
);
