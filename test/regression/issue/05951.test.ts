// https://github.com/oven-sh/bun/issues/5951
//
// Exercises the public `ws` package surface (what miniflare/wrangler actually
// listen for), not the native 'handshake' event covered in 24229.test.ts.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

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

test("ws emits 'unexpected-response' with status, headers and body on non-101", { timeout: 30000 }, async () => {
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
test("ws emits native 'error' on non-101 when no 'unexpected-response' listener", { timeout: 30000 }, async () => {
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

test("ws emits 'upgrade' with headers before 'open' on 101", { timeout: 30000 }, async () => {
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
test(
  "ws 'unexpected-response' waits for full Content-Length body across multiple writes",
  { timeout: 30000 },
  async () => {
    const { stdout, exitCode } = await run(/* js */ `
    const { createServer } = require("net");
    const { once } = require("events");
    const { WebSocket } = require("ws");

    // 8 kB JSON-ish payload, sent in three separate writes with a tick between
    // each so the client sees multiple TCP reads (at least in the common case).
    const CHUNK_SIZE = 2600;
    const chunk1 = "a".repeat(CHUNK_SIZE);
    const chunk2 = "b".repeat(CHUNK_SIZE);
    const chunk3 = "c".repeat(CHUNK_SIZE);
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
  },
);

// `on()` / `once()` are not the only EventEmitter registration APIs — ws
// consumers also reach for `addListener` / `prependListener` /
// `prependOnceListener` and (from DOM-style code) `addEventListener`. Each
// must arm the native handshake listener, otherwise the 'upgrade' /
// 'unexpected-response' handler is installed on the EventEmitter list but
// the native event that would `emit('upgrade', ...)` is never wired up and
// the callback silently never fires.
test(
  "ws 'unexpected-response' fires for addListener / prependListener / addEventListener",
  { timeout: 30000 },
  async () => {
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
  },
);
