import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, tls } from "harness";
import { once } from "node:events";
import http2 from "node:http2";
import https from "node:https";
import nodetls from "node:tls";
import zlib from "node:zlib";

// allowHTTP1: false forces the server to reject anything that didn't
// negotiate "h2" via ALPN, so these tests only pass when fetch actually
// speaks HTTP/2 on the wire.
async function withH2Server(
  handler: (req: http2.Http2ServerRequest, res: http2.Http2ServerResponse) => void,
  fn: (url: string, server: http2.Http2SecureServer) => Promise<void>,
) {
  const server = http2.createSecureServer({ ...tls, allowHTTP1: false }, handler);
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as import("node:net").AddressInfo;
  try {
    await fn(`https://localhost:${port}`, server);
  } finally {
    server.close();
  }
}

// --- Raw HTTP/2 frame server -------------------------------------------------
// Minimal TLS+ALPN(h2) server that speaks the wire format directly so tests
// can inject frames that a conforming server (nghttp2) would never emit.

function frame(type: number, flags: number, streamId: number, payload: Uint8Array | Buffer = Buffer.alloc(0)) {
  const buf = Buffer.alloc(9 + payload.length);
  buf.writeUIntBE(payload.length, 0, 3);
  buf[3] = type;
  buf[4] = flags;
  buf.writeUInt32BE(streamId & 0x7fffffff, 5);
  Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).copy(buf, 9);
  return buf;
}
const u32be = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};

// HPACK static-table indices we need.
const hpackStatus = (code: 100 | 200 | 204 | 404) =>
  code === 100
    ? Buffer.concat([Buffer.from([0x10, 7]), Buffer.from(":status"), Buffer.from([3]), Buffer.from("100")])
    : Buffer.from([0x80 | { 200: 8, 204: 9, 404: 13 }[code]]);
// Literal field never-indexed, new name (4-bit prefix 0001 0000): len(name) name len(value) value.
const hpackLit = (name: string, value: string) =>
  Buffer.concat([Buffer.from([0x10, name.length]), Buffer.from(name), Buffer.from([value.length]), Buffer.from(value)]);

type RawConn = {
  socket: nodetls.TLSSocket;
  settings(): void;
  headers(streamId: number, block: Buffer, opts?: { endStream?: boolean; endHeaders?: boolean }): void;
  data(streamId: number, chunk: string | Buffer, endStream?: boolean): void;
  rst(streamId: number, code: number): void;
  goaway(lastId: number, code: number): void;
};

async function withRawH2Server(
  onStream: (conn: RawConn, streamId: number, connIndex: number) => void,
  fn: (url: string, state: { connections: number }) => Promise<void>,
) {
  const state = { connections: 0 };
  const server = nodetls.createServer({ ...tls, ALPNProtocols: ["h2"] }, socket => {
    const connIndex = state.connections++;
    const conn: RawConn = {
      socket,
      settings: () => socket.write(frame(4, 0, 0)),
      headers: (id, block, o = {}) =>
        socket.write(frame(1, (o.endHeaders === false ? 0 : 4) | (o.endStream ? 1 : 0), id, block)),
      data: (id, chunk, end = false) =>
        socket.write(frame(0, end ? 1 : 0, id, typeof chunk === "string" ? Buffer.from(chunk) : chunk)),
      rst: (id, code) => socket.write(frame(3, 0, id, u32be(code))),
      goaway: (lastId, code) => socket.write(frame(7, 0, 0, Buffer.concat([u32be(lastId), u32be(code)]))),
    };
    let buf = Buffer.alloc(0);
    let prefaceSeen = false;
    socket.on("data", chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!prefaceSeen) {
        if (buf.length < 24) return;
        buf = buf.subarray(24);
        prefaceSeen = true;
        conn.settings();
      }
      while (buf.length >= 9) {
        const len = buf.readUIntBE(0, 3);
        if (buf.length < 9 + len) return;
        const type = buf[3],
          flags = buf[4],
          id = buf.readUInt32BE(5) & 0x7fffffff;
        const payload = buf.subarray(9, 9 + len);
        buf = buf.subarray(9 + len);
        if (type === 4 && !(flags & 1)) socket.write(frame(4, 1, 0)); // ack their SETTINGS
        if (type === 1) onStream(conn, id, connIndex); // HEADERS opens a stream
        void payload;
      }
    });
    socket.on("error", () => {});
  });
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as import("node:net").AddressInfo;
  try {
    await fn(`https://localhost:${port}`, state);
  } finally {
    server.close();
  }
}

function spawnFetch(script: string) {
  return Bun.spawn({
    cmd: [bunExe(), "--no-warnings", "-e", script],
    env: {
      ...bunEnv,
      BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT: "1",
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe.concurrent("fetch() over HTTP/2 (BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT)", () => {
  test("GET: status, headers and body round-trip", async () => {
    await withH2Server(
      (req, res) => {
        res.setHeader("x-seen-path", req.url);
        res.setHeader("x-seen-method", req.method);
        res.setHeader("x-seen-foo", String(req.headers["x-foo"]));
        res.setHeader("x-http-version", req.httpVersion);
        res.writeHead(201, { "content-type": "text/plain" });
        res.end("hello over h2");
      },
      async url => {
        await using proc = spawnFetch(`
          const res = await fetch(${JSON.stringify(url)} + "/hello?x=1", {
            headers: { "X-Foo": "bar" },
            tls: { rejectUnauthorized: false },
          });
          const body = await res.text();
          console.log(JSON.stringify({
            status: res.status,
            ct: res.headers.get("content-type"),
            seenPath: res.headers.get("x-seen-path"),
            seenMethod: res.headers.get("x-seen-method"),
            seenFoo: res.headers.get("x-seen-foo"),
            httpVersion: res.headers.get("x-http-version"),
            body,
          }));
        `);
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        const out = JSON.parse(stdout);
        expect(out).toEqual({
          status: 201,
          ct: "text/plain",
          seenPath: "/hello?x=1",
          seenMethod: "GET",
          seenFoo: "bar",
          httpVersion: "2.0",
          body: "hello over h2",
        });
        expect(exitCode).toBe(0);
      },
    );
  });

  test("POST: request body is delivered as DATA frames", async () => {
    await withH2Server(
      (req, res) => {
        let body = "";
        req.setEncoding("utf8");
        req.on("data", c => (body += c));
        req.on("end", () => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ got: body, method: req.method }));
        });
      },
      async url => {
        await using proc = spawnFetch(`
          const res = await fetch(${JSON.stringify(url)} + "/echo", {
            method: "POST",
            body: "the payload",
            tls: { rejectUnauthorized: false },
          });
          process.stdout.write(await res.text());
        `);
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual({ got: "the payload", method: "POST" });
        expect(exitCode).toBe(0);
      },
    );
  });

  test("response body larger than one DATA frame", async () => {
    const big = Buffer.alloc(70_000, "a").toString();
    await withH2Server(
      (_req, res) => {
        res.writeHead(200);
        res.end(big);
      },
      async url => {
        await using proc = spawnFetch(`
          const res = await fetch(${JSON.stringify(url)}, { tls: { rejectUnauthorized: false } });
          const buf = await res.arrayBuffer();
          console.log(buf.byteLength);
        `);
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(stdout.trim()).toBe(String(big.length));
        expect(exitCode).toBe(0);
      },
    );
  });

  test("gzip content-encoding is decompressed", async () => {
    const payload = "compressed body via h2";
    const gz = zlib.gzipSync(payload);
    await withH2Server(
      (_req, res) => {
        res.writeHead(200, { "content-encoding": "gzip", "content-type": "text/plain" });
        res.end(gz);
      },
      async url => {
        await using proc = spawnFetch(`
          const res = await fetch(${JSON.stringify(url)}, { tls: { rejectUnauthorized: false } });
          process.stdout.write(await res.text());
        `);
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(stdout).toBe(payload);
        expect(exitCode).toBe(0);
      },
    );
  });

  test("concurrent requests multiplex on one h2 session", async () => {
    let sessions = 0;
    let maxOpen = 0;
    let open = 0;
    const server = http2.createSecureServer({ ...tls, allowHTTP1: false });
    server.on("session", () => sessions++);
    server.on("stream", (stream, headers) => {
      open++;
      maxOpen = Math.max(maxOpen, open);
      stream.on("close", () => open--);
      // Hold each stream briefly so all 8 are open at once.
      setTimeout(() => {
        stream.respond({ ":status": 200 });
        stream.end(String(headers[":path"]));
      }, 100);
    });
    server.listen(0);
    await once(server, "listening");
    const { port } = server.address() as import("node:net").AddressInfo;
    try {
      await using proc = spawnFetch(`
        const url = "https://localhost:${port}";
        const opts = { tls: { rejectUnauthorized: false } };
        // Warmup so the session exists before the concurrent burst.
        await fetch(url + "/warmup", opts).then(r => r.text());
        const results = await Promise.all(
          Array.from({ length: 8 }, (_, i) => fetch(url + "/" + i, opts).then(r => r.text()))
        );
        console.log(results.join(","));
      `);
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("/0,/1,/2,/3,/4,/5,/6,/7");
      expect(exitCode).toBe(0);
      expect(sessions).toBe(1);
      expect(maxOpen).toBe(8);
    } finally {
      server.close();
    }
  });

  test("POST with ReadableStream body streams as raw DATA frames", async () => {
    let received = "";
    await withH2Server(
      (req, res) => {
        req.setEncoding("utf8");
        req.on("data", c => (received += c));
        req.on("end", () => {
          res.writeHead(200, { "x-len": String(received.length) });
          res.end(received);
        });
      },
      async url => {
        await using proc = spawnFetch(`
          const chunks = ["alpha-", "bravo-", "charlie-", "delta-", "echo"];
          const body = new ReadableStream({
            async pull(ctrl) {
              for (const c of chunks) {
                ctrl.enqueue(new TextEncoder().encode(c));
                await new Promise(r => setTimeout(r, 5));
              }
              ctrl.close();
            },
          });
          const res = await fetch("${url}/stream", {
            method: "POST",
            body,
            duplex: "half",
            tls: { rejectUnauthorized: false },
          });
          console.log(res.status, res.headers.get("x-len"), await res.text());
        `);
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(stdout.trim()).toBe("200 30 alpha-bravo-charlie-delta-echo");
        expect(exitCode).toBe(0);
        // No chunked-encoding artifacts leaked into the framed body.
        expect(received).toBe("alpha-bravo-charlie-delta-echo");
      },
    );
  });

  test("POST with ReadableStream body larger than initial send window", async () => {
    await withH2Server(
      (req, res) => {
        let total = 0;
        req.on("data", c => (total += c.length));
        req.on("end", () => {
          res.writeHead(200);
          res.end(String(total));
        });
      },
      async url => {
        await using proc = spawnFetch(`
          // 256 KiB > 64 KiB default INITIAL_WINDOW_SIZE: requires the
          // client to honour the server's WINDOW_UPDATE before continuing.
          const buf = new Uint8Array(256 * 1024).fill(0x61);
          const body = new ReadableStream({
            start(ctrl) {
              for (let i = 0; i < 4; i++) ctrl.enqueue(buf.subarray(i * 65536, (i + 1) * 65536));
              ctrl.close();
            },
          });
          const res = await fetch("${url}/big", {
            method: "POST",
            body,
            duplex: "half",
            tls: { rejectUnauthorized: false },
          });
          console.log(res.status, await res.text());
        `);
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(stdout.trim()).toBe("200 262144");
        expect(exitCode).toBe(0);
      },
    );
  });

  test("cold-start: parallel requests coalesce onto one TLS connect", async () => {
    let sessions = 0;
    const server = http2.createSecureServer({ ...tls, allowHTTP1: false });
    server.on("session", () => sessions++);
    server.on("stream", (stream, headers) => {
      stream.respond({ ":status": 200 });
      stream.end(String(headers[":path"]));
    });
    server.listen(0);
    await once(server, "listening");
    const { port } = server.address() as import("node:net").AddressInfo;
    try {
      await using proc = spawnFetch(`
        const url = "https://localhost:${port}";
        const opts = { tls: { rejectUnauthorized: false } };
        // No warmup: all 12 race the same fresh handshake.
        const results = await Promise.all(
          Array.from({ length: 12 }, (_, i) => fetch(url + "/" + i, opts).then(r => r.text()))
        );
        console.log(results.sort().join(","));
      `);
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("/0,/1,/10,/11,/2,/3,/4,/5,/6,/7,/8,/9");
      expect(exitCode).toBe(0);
      expect(sessions).toBe(1);
    } finally {
      server.close();
    }
  });

  test("abort sends RST_STREAM; siblings on the session survive", async () => {
    let sessions = 0;
    const { promise: slowClosed, resolve: resolveSlowClosed } = Promise.withResolvers<number>();
    const server = http2.createSecureServer({ ...tls, allowHTTP1: false });
    server.on("session", () => sessions++);
    server.on("stream", (stream, headers) => {
      if (headers[":path"] === "/slow") {
        stream.on("close", () => resolveSlowClosed(stream.rstCode));
        // never respond; client will abort
      } else {
        stream.respond({ ":status": 200 });
        stream.end("survivor");
      }
    });
    server.listen(0);
    await once(server, "listening");
    const { port } = server.address() as import("node:net").AddressInfo;
    try {
      await using proc = spawnFetch(`
        const url = "https://localhost:${port}";
        const opts = { tls: { rejectUnauthorized: false } };
        // Warmup so /slow, /fast, /after share one session.
        await fetch(url + "/warmup", opts).then(r => r.text());
        const ac = new AbortController();
        const slow = fetch(url + "/slow", { ...opts, signal: ac.signal }).catch(e => "aborted:" + e.name);
        const fast = fetch(url + "/fast", opts).then(r => r.text());
        await fast;
        ac.abort();
        await slow;
        const after = await fetch(url + "/after", opts).then(r => r.text());
        console.log([await slow, await fast, after].join(","));
      `);
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("aborted:AbortError,survivor,survivor");
      expect(exitCode).toBe(0);
      // Aborting one stream must not tear down the connection: all four
      // requests rode one session, and /slow's stream closed (RST_STREAM)
      // while /fast and /after on the same session completed.
      expect(sessions).toBe(1);
      await slowClosed;
    } finally {
      server.close();
    }
  });

  test("server SETTINGS_MAX_CONCURRENT_STREAMS=1 is honoured per session", async () => {
    const perSessionMax: number[] = [];
    const server = http2.createSecureServer({ ...tls, allowHTTP1: false, settings: { maxConcurrentStreams: 1 } });
    server.on("session", s => {
      const idx = perSessionMax.push(0) - 1;
      let open = 0;
      s.on("stream", stream => {
        open++;
        perSessionMax[idx] = Math.max(perSessionMax[idx], open);
        stream.on("close", () => open--);
        setTimeout(() => {
          stream.respond({ ":status": 200 });
          stream.end("x");
        }, 30);
      });
    });
    server.listen(0);
    await once(server, "listening");
    const { port } = server.address() as import("node:net").AddressInfo;
    try {
      await using proc = spawnFetch(`
        const url = "https://localhost:${port}";
        const opts = { tls: { rejectUnauthorized: false } };
        // First request alone so the server's SETTINGS arrives before the
        // burst, then fire 4 concurrently against the cap.
        await fetch(url, opts).then(r => r.text());
        await Promise.all(Array.from({ length: 4 }, () => fetch(url, opts).then(r => r.text())));
        console.log("ok");
      `);
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("ok");
      expect(exitCode).toBe(0);
      // The cap is per-connection: no session may ever see >1 open stream.
      // Excess concurrent requests fan out to additional connections.
      for (const max of perSessionMax) expect(max).toBe(1);
      expect(perSessionMax.length).toBeGreaterThanOrEqual(1);
    } finally {
      server.close();
    }
  });

  test("keep-alive: sequential requests reuse one h2 session", async () => {
    let sessions = 0;
    const seen: number[] = [];
    const server = http2.createSecureServer({ ...tls, allowHTTP1: false });
    server.on("session", () => sessions++);
    server.on("stream", (stream, headers) => {
      seen.push(stream.id);
      stream.respond({ ":status": 200, "content-type": "text/plain" });
      stream.end(`req=${headers[":path"]}`);
    });
    server.listen(0);
    await once(server, "listening");
    const { port } = server.address() as import("node:net").AddressInfo;
    try {
      await using proc = spawnFetch(`
        const url = "https://localhost:${port}";
        const opts = { tls: { rejectUnauthorized: false } };
        for (let i = 0; i < 4; i++) {
          const r = await fetch(url + "/" + i, opts);
          console.log(await r.text());
        }
      `);
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim().split("\n")).toEqual(["req=/0", "req=/1", "req=/2", "req=/3"]);
      expect(exitCode).toBe(0);
      expect(sessions).toBe(1);
      // stream ids must be fresh odd numbers on the reused session
      expect(seen).toEqual([1, 3, 5, 7]);
    } finally {
      server.close();
    }
  });

  test("GOAWAY after a request: next request reconnects", async () => {
    let sessions = 0;
    const server = http2.createSecureServer({ ...tls, allowHTTP1: false });
    server.on("session", () => sessions++);
    server.on("stream", (stream, headers) => {
      const session = stream.session!;
      stream.respond({ ":status": 200 });
      stream.end("ok");
      if (headers[":path"] === "/first") {
        session.goaway(http2.constants.NGHTTP2_NO_ERROR, stream.id);
      }
    });
    server.listen(0);
    await once(server, "listening");
    const { port } = server.address() as import("node:net").AddressInfo;
    try {
      await using proc = spawnFetch(`
        const url = "https://localhost:${port}";
        const opts = { tls: { rejectUnauthorized: false } };
        const a = await (await fetch(url + "/first", opts)).text();
        await Bun.sleep(50);
        const b = await (await fetch(url + "/second", opts)).text();
        console.log(a + "," + b);
      `);
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("ok,ok");
      expect(exitCode).toBe(0);
      expect(sessions).toBe(2);
    } finally {
      server.close();
    }
  });

  test("response body larger than initial window triggers WINDOW_UPDATE", async () => {
    const big = Buffer.alloc(20 * 1024 * 1024, 0x61);
    await withH2Server(
      (_req, res) => {
        res.writeHead(200);
        res.end(big);
      },
      async url => {
        await using proc = spawnFetch(`
          const res = await fetch(${JSON.stringify(url)}, { tls: { rejectUnauthorized: false } });
          const buf = new Uint8Array(await res.arrayBuffer());
          let ok = buf.length === ${big.length};
          for (let i = 0; ok && i < buf.length; i += 4096) ok = buf[i] === 0x61;
          console.log(ok ? "ok" : "bad:" + buf.length);
        `);
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(stdout.trim()).toBe("ok");
        expect(exitCode).toBe(0);
      },
    );
  });

  test("response trailers are consumed without breaking the body", async () => {
    const server = http2.createSecureServer({ ...tls, allowHTTP1: false });
    server.on("stream", stream => {
      stream.respond({ ":status": 200, "content-type": "text/plain" }, { waitForTrailers: true });
      stream.on("wantTrailers", () => stream.sendTrailers({ "x-trailer": "hello" }));
      stream.end("body-text");
    });
    server.listen(0);
    await once(server, "listening");
    const { port } = server.address() as import("node:net").AddressInfo;
    try {
      await using proc = spawnFetch(`
        const r = await fetch("https://localhost:${port}", { tls: { rejectUnauthorized: false } });
        console.log(r.status, await r.text());
      `);
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("200 body-text");
      expect(exitCode).toBe(0);
    } finally {
      server.close();
    }
  });

  // Bun's node:http2 server currently emits an empty DATA+END_STREAM for
  // stream.close(code) rather than RST_STREAM, so this also covers the
  // RFC 9113 §8.1 "DATA before HEADERS" stream-error case.
  test("server-reset stream fails that request; sibling on the session survives", async () => {
    let sessions = 0;
    const server = http2.createSecureServer({ ...tls, allowHTTP1: false });
    server.on("session", () => sessions++);
    server.on("stream", (stream, headers) => {
      stream.on("error", () => {});
      if (headers[":path"] === "/bad") {
        stream.close(http2.constants.NGHTTP2_PROTOCOL_ERROR);
        return;
      }
      setTimeout(() => {
        stream.respond({ ":status": 200 });
        stream.end("ok");
      }, 50);
    });
    server.listen(0);
    await once(server, "listening");
    const { port } = server.address() as import("node:net").AddressInfo;
    try {
      await using proc = spawnFetch(`
        const url = "https://localhost:${port}";
        const opts = { tls: { rejectUnauthorized: false } };
        const [good, bad] = await Promise.allSettled([
          fetch(url + "/good", opts).then(r => r.text()),
          fetch(url + "/bad", opts).then(r => r.text()),
        ]);
        console.log(good.status, good.value, bad.status);
      `);
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("fulfilled ok rejected");
      expect(exitCode).toBe(0);
      expect(sessions).toBe(1);
    } finally {
      server.close();
    }
  });

  test("connection-specific request headers are stripped before HPACK", async () => {
    let seen: string[] = [];
    const server = http2.createSecureServer({ ...tls, allowHTTP1: false });
    server.on("stream", (stream, headers) => {
      seen = Object.keys(headers).filter(k => !k.startsWith(":"));
      stream.respond({ ":status": 200 });
      stream.end();
    });
    server.listen(0);
    await once(server, "listening");
    const { port } = server.address() as import("node:net").AddressInfo;
    try {
      await using proc = spawnFetch(`
        const r = await fetch("https://localhost:${port}", {
          headers: {
            "x-keep": "me",
            "Connection": "keep-alive",
            "Keep-Alive": "timeout=5",
            "Proxy-Connection": "x",
            "Transfer-Encoding": "chunked",
            "Upgrade": "ws",
          },
          tls: { rejectUnauthorized: false },
        });
        console.log(r.status);
      `);
      const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout.trim()).toBe("200");
      expect(exitCode).toBe(0);
      expect(seen).toContain("x-keep");
      for (const bad of ["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade"]) {
        expect(seen).not.toContain(bad);
      }
    } finally {
      server.close();
    }
  });

  test("multiple Set-Cookie response headers survive HPACK decode", async () => {
    const server = http2.createSecureServer({ ...tls, allowHTTP1: false });
    server.on("stream", stream => {
      stream.respond({ ":status": 200, "set-cookie": ["a=b", "c=d", "e=f"] });
      stream.end();
    });
    server.listen(0);
    await once(server, "listening");
    const { port } = server.address() as import("node:net").AddressInfo;
    try {
      await using proc = spawnFetch(`
        const r = await fetch("https://localhost:${port}", { tls: { rejectUnauthorized: false } });
        console.log(JSON.stringify(r.headers.getSetCookie()));
      `);
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe(`["a=b","c=d","e=f"]`);
      expect(exitCode).toBe(0);
    } finally {
      server.close();
    }
  });

  describe("raw frame server", () => {
    test("REFUSED_STREAM is transparently retried on the same connection", async () => {
      let attempts = 0;
      await withRawH2Server(
        (conn, id) => {
          attempts++;
          if (attempts === 1) return conn.rst(id, http2.constants.NGHTTP2_REFUSED_STREAM);
          conn.headers(id, hpackStatus(204), { endStream: true });
        },
        async (url, state) => {
          await using proc = spawnFetch(`
            const r = await fetch("${url}", { tls: { rejectUnauthorized: false } });
            console.log(r.status);
          `);
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect(stderr).toBe("");
          expect(stdout.trim()).toBe("204");
          expect(exitCode).toBe(0);
          expect(attempts).toBe(2);
          expect(state.connections).toBe(1);
        },
      );
    });

    test("REFUSED_STREAM gives up after max retries", async () => {
      let attempts = 0;
      await withRawH2Server(
        (conn, id) => {
          attempts++;
          conn.rst(id, http2.constants.NGHTTP2_REFUSED_STREAM);
        },
        async url => {
          await using proc = spawnFetch(`
            try { await fetch("${url}", { tls: { rejectUnauthorized: false } }); console.log("ok"); }
            catch (e) { console.log("rejected", String(e).includes("Refused")); }
          `);
          const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect(stdout.trim()).toBe("rejected true");
          expect(exitCode).toBe(0);
          // initial + 5 retries
          expect(attempts).toBe(6);
        },
      );
    });

    test("RST_STREAM PROTOCOL_ERROR is not retried", async () => {
      let attempts = 0;
      await withRawH2Server(
        (conn, id) => {
          attempts++;
          conn.rst(id, http2.constants.NGHTTP2_PROTOCOL_ERROR);
        },
        async url => {
          await using proc = spawnFetch(`
            try { await fetch("${url}", { tls: { rejectUnauthorized: false } }); console.log("ok"); }
            catch (e) { console.log("rejected"); }
          `);
          const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect(stdout.trim()).toBe("rejected");
          expect(exitCode).toBe(0);
          expect(attempts).toBe(1);
        },
      );
    });

    test("graceful GOAWAY past our id retries on a fresh connection", async () => {
      await withRawH2Server(
        (conn, id, connIndex) => {
          if (connIndex === 0) {
            // First connection: refuse via GOAWAY(NO_ERROR, lastId=0).
            conn.goaway(0, 0);
            conn.socket.end();
            return;
          }
          conn.headers(id, hpackStatus(200), { endStream: false });
          conn.data(id, "second-conn", true);
        },
        async (url, state) => {
          await using proc = spawnFetch(`
            const r = await fetch("${url}", { tls: { rejectUnauthorized: false } });
            console.log(r.status, await r.text());
          `);
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect(stderr).toBe("");
          expect(stdout.trim()).toBe("200 second-conn");
          expect(exitCode).toBe(0);
          expect(state.connections).toBe(2);
        },
      );
    });

    test("REFUSED_STREAM with a streaming body errors instead of retrying", async () => {
      let attempts = 0;
      await withRawH2Server(
        (conn, id) => {
          attempts++;
          conn.rst(id, http2.constants.NGHTTP2_REFUSED_STREAM);
        },
        async url => {
          await using proc = spawnFetch(`
            const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1,2,3])); c.close(); } });
            try {
              await fetch("${url}", { method: "POST", body, duplex: "half", tls: { rejectUnauthorized: false } });
              console.log("ok");
            } catch (e) { console.log("rejected"); }
          `);
          const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect(stdout.trim()).toBe("rejected");
          expect(exitCode).toBe(0);
          expect(attempts).toBe(1);
        },
      );
    });

    test("padded DATA: pad bytes are stripped and credited against flow control", async () => {
      await withRawH2Server(
        (conn, id) => {
          conn.headers(id, hpackStatus(200));
          // PADDED flag = 0x8; payload = padLen(1) + body + pad zeros.
          const body = Buffer.from("padded-body");
          const padLen = 200;
          const payload = Buffer.concat([Buffer.from([padLen]), body, Buffer.alloc(padLen)]);
          conn.socket.write(frame(0, 0x8 | 0x1, id, payload));
        },
        async url => {
          await using proc = spawnFetch(`
            const r = await fetch("${url}", { tls: { rejectUnauthorized: false } });
            console.log(r.status, await r.text());
          `);
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect(stderr).toBe("");
          expect(stdout.trim()).toBe("200 padded-body");
          expect(exitCode).toBe(0);
        },
      );
    });

    test("1xx informational HEADERS are skipped, final response delivered", async () => {
      await withRawH2Server(
        (conn, id) => {
          // Single write so 100 and 200 land in the same onData pass; HPACK
          // must decode both in order.
          conn.socket.write(
            Buffer.concat([
              frame(1, 4, id, hpackStatus(100)),
              frame(1, 4, id, Buffer.concat([hpackStatus(200), hpackLit("x-after", "100")])),
              frame(0, 1, id, Buffer.from("final")),
            ]),
          );
        },
        async url => {
          await using proc = spawnFetch(`
            const r = await fetch("${url}", { tls: { rejectUnauthorized: false } });
            console.log(r.status, r.headers.get("x-after"), await r.text());
          `);
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect(stderr).toBe("");
          expect(stdout.trim()).toBe("200 100 final");
          expect(exitCode).toBe(0);
        },
      );
    });

    test("response + trailers in a single packet keep HPACK in sync", async () => {
      await withRawH2Server(
        (conn, id) => {
          conn.socket.write(
            Buffer.concat([
              frame(1, 4, id, Buffer.concat([hpackStatus(200), hpackLit("x-real", "yes")])),
              frame(0, 0, id, Buffer.from("body")),
              frame(1, 4 | 1, id, hpackLit("x-trailer", "ignored")),
            ]),
          );
        },
        async url => {
          await using proc = spawnFetch(`
            const r = await fetch("${url}", { tls: { rejectUnauthorized: false } });
            console.log(r.status, r.headers.get("x-real"), await r.text());
          `);
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect(stderr).toBe("");
          expect(stdout.trim()).toBe("200 yes body");
          expect(exitCode).toBe(0);
        },
      );
    });

    test("Expect: 100-continue withholds the body until 100 arrives", async () => {
      const seen: { id: number; type: number; len: number }[] = [];
      const server = nodetls.createServer({ ...tls, ALPNProtocols: ["h2"] }, socket => {
        let buf = Buffer.alloc(0);
        let prefaceSeen = false;
        let sent100 = false;
        socket.on("data", chunk => {
          buf = Buffer.concat([buf, chunk]);
          if (!prefaceSeen) {
            if (buf.length < 24) return;
            buf = buf.subarray(24);
            prefaceSeen = true;
            socket.write(frame(4, 0, 0));
          }
          while (buf.length >= 9) {
            const len = buf.readUIntBE(0, 3);
            if (buf.length < 9 + len) return;
            const type = buf[3],
              flags = buf[4],
              id = buf.readUInt32BE(5) & 0x7fffffff;
            buf = buf.subarray(9 + len);
            if (id !== 0) seen.push({ id, type, len });
            if (type === 4 && !(flags & 1)) socket.write(frame(4, 1, 0));
            if (type === 1 && !sent100) {
              sent100 = true;
              // Prove no DATA preceded the 100 by responding only after a tick.
              setTimeout(() => socket.write(frame(1, 4, id, hpackStatus(100))), 20);
            }
            if (type === 0 && flags & 1) {
              socket.write(frame(1, 4, id, hpackStatus(200)));
              socket.write(frame(0, 1, id, Buffer.from("got-body")));
            }
          }
        });
        socket.on("error", () => {});
      });
      server.listen(0);
      await once(server, "listening");
      const { port } = server.address() as import("node:net").AddressInfo;
      try {
        await using proc = spawnFetch(`
          const r = await fetch("https://localhost:${port}", {
            method: "POST",
            headers: { Expect: "100-continue" },
            body: "twenty-chars-body!!!",
            tls: { rejectUnauthorized: false },
          });
          console.log(r.status, await r.text());
        `);
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(stdout.trim()).toBe("200 got-body");
        expect(exitCode).toBe(0);
        // First per-stream frame must be HEADERS; no DATA until after the 100.
        expect(seen[0].type).toBe(1);
        const firstData = seen.findIndex(f => f.type === 0);
        expect(firstData).toBeGreaterThan(0);
        expect(seen[firstData].len).toBe(20);
      } finally {
        server.close();
      }
    });

    test("Expect: 100-continue with final status before 100 skips body upload", async () => {
      let dataBytes = 0;
      await withRawH2Server(
        (conn, id) => {
          // Reject immediately without 100; client should half-close with
          // an empty DATA+END_STREAM rather than uploading the body.
          conn.headers(id, hpackStatus(404), { endStream: true });
          conn.socket.on("data", chunk => {
            // crude: count any DATA frame payloads on this socket after reject
            let b = chunk;
            while (b.length >= 9) {
              const len = b.readUIntBE(0, 3);
              if (b[3] === 0 && (b.readUInt32BE(5) & 0x7fffffff) === id) dataBytes += len;
              b = b.subarray(9 + len);
            }
          });
        },
        async url => {
          await using proc = spawnFetch(`
            const r = await fetch("${url}", {
              method: "POST",
              headers: { Expect: "100-continue" },
              body: Buffer.alloc(50000, "x").toString(),
              tls: { rejectUnauthorized: false },
            });
            console.log(r.status);
          `);
          const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect(stdout.trim()).toBe("404");
          expect(exitCode).toBe(0);
          // Body was withheld; only the empty END_STREAM DATA frame allowed.
          expect(dataBytes).toBe(0);
        },
      );
    });

    test("Content-Length / DATA mismatch rejects", async () => {
      await withRawH2Server(
        (conn, id) => {
          conn.headers(id, Buffer.concat([hpackStatus(200), hpackLit("content-length", "42")]));
          conn.data(id, "short", true);
        },
        async url => {
          await using proc = spawnFetch(`
            try {
              const r = await fetch("${url}", { tls: { rejectUnauthorized: false } });
              await r.text();
              console.log("ok");
            } catch (e) { console.log("rejected", String(e).includes("ContentLength")); }
          `);
          const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect(stdout.trim()).toBe("rejected true");
          expect(exitCode).toBe(0);
        },
      );
    });

    test("Content-Length with END_STREAM on HEADERS and zero DATA rejects", async () => {
      // RFC 9113 §8.1.1: declared length must equal sum of DATA payloads even
      // when that sum is zero. Previously this hit the early-finish branch
      // and resolved with an empty body.
      await withRawH2Server(
        (conn, id) => {
          conn.headers(id, Buffer.concat([hpackStatus(200), hpackLit("content-length", "42")]), { endStream: true });
        },
        async url => {
          await using proc = spawnFetch(`
            try {
              const r = await fetch("${url}", { tls: { rejectUnauthorized: false } });
              console.log("ok", r.status, (await r.text()).length);
            } catch (e) { console.log("rejected", String(e).includes("ContentLength")); }
          `);
          const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect(stdout.trim()).toBe("rejected true");
          expect(exitCode).toBe(0);
        },
      );
    });

    test("response missing :status pseudo-header rejects cleanly", async () => {
      await withRawH2Server(
        (conn, id) => {
          conn.headers(id, hpackLit("content-type", "text/plain"), { endStream: true });
        },
        async url => {
          await using proc = spawnFetch(`
            try { await fetch("${url}", { tls: { rejectUnauthorized: false } }); console.log("ok"); }
            catch (e) { console.log("rejected"); }
          `);
          const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect(stdout.trim()).toBe("rejected");
          expect(exitCode).toBe(0);
        },
      );
    });

    test("Content-Length satisfied before END_STREAM doesn't dereference a freed client", async () => {
      // Server sends body in one DATA frame without END_STREAM, then a
      // separate empty DATA(END_STREAM). The first frame fully satisfies
      // Content-Length, so progressUpdate fires and the JS callback frees
      // the AsyncHTTP; the second frame must not touch a stale client ptr.
      await withRawH2Server(
        (conn, id) => {
          conn.headers(id, Buffer.concat([hpackStatus(200), hpackLit("content-length", "5")]));
          conn.data(id, "hello", false);
          // brief gap so the two frames hit separate onData calls
          setTimeout(() => conn.data(id, "", true), 30);
        },
        async url => {
          await using proc = spawnFetch(`
            const r = await fetch("${url}", { tls: { rejectUnauthorized: false } });
            console.log(r.status, await r.text());
            await Bun.sleep(80);
            console.log("survived");
          `);
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect(stdout.trim()).toBe("200 hello\nsurvived");
          expect(exitCode).toBe(0);
        },
      );
    });

    test("SETTINGS_MAX_FRAME_SIZE below 16384 is rejected as a connection error", async () => {
      // RFC 9113 §6.5.2: values outside [16384, 2^24-1] are PROTOCOL_ERROR.
      // Without the lower bound a MAX_FRAME_SIZE of 0 made writeHeaderBlock
      // loop forever emitting zero-length frames; with it the connection
      // should fail promptly.
      await withRawH2Server(
        (conn, id) => {
          conn.socket.write(frame(4, 0, 0, Buffer.concat([Buffer.from([0, 5]), u32be(0)])));
          conn.headers(id, hpackStatus(200), { endStream: true });
        },
        async url => {
          await using proc = spawnFetch(`
            try {
              const r = await fetch("${url}", { tls: { rejectUnauthorized: false } });
              console.log("status", r.status);
            } catch (e) { console.log("rejected", e.code); }
          `);
          const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect(stdout.trim()).toBe("rejected HTTP2ProtocolError");
          expect(exitCode).toBe(0);
        },
      );
    });

    test("SETTINGS_INITIAL_WINDOW_SIZE above 2^31-1 is a connection FLOW_CONTROL_ERROR", async () => {
      // RFC 9113 §6.5.2.
      await withRawH2Server(
        (conn, id) => {
          // setting type 4 (INITIAL_WINDOW_SIZE), value 0x80000000
          conn.socket.write(frame(4, 0, 0, Buffer.concat([Buffer.from([0, 4]), u32be(0x80000000)])));
          conn.headers(id, hpackStatus(200), { endStream: true });
        },
        async url => {
          await using proc = spawnFetch(`
            try { await fetch("${url}", { tls: { rejectUnauthorized: false } }); console.log("ok"); }
            catch (e) { console.log("rejected", e.code); }
          `);
          const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect(stdout.trim()).toBe("rejected HTTP2FlowControlError");
          expect(exitCode).toBe(0);
        },
      );
    });

    test("WINDOW_UPDATE with zero increment on stream 0 is a connection PROTOCOL_ERROR", async () => {
      // RFC 9113 §6.9.
      await withRawH2Server(
        (conn, id) => {
          conn.socket.write(frame(8, 0, 0, u32be(0)));
          conn.headers(id, hpackStatus(200), { endStream: true });
        },
        async url => {
          await using proc = spawnFetch(`
            try { await fetch("${url}", { tls: { rejectUnauthorized: false } }); console.log("ok"); }
            catch (e) { console.log("rejected", e.code); }
          `);
          const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect(stdout.trim()).toBe("rejected HTTP2ProtocolError");
          expect(exitCode).toBe(0);
        },
      );
    });

    test("HEADERS on a stream id we never opened is a connection PROTOCOL_ERROR", async () => {
      // RFC 9113 §5.1: receiving a frame on an idle stream (id >= our next
      // odd id) or an even (server-initiated) id while push is disabled is a
      // connection error, not a discardable orphan.
      await withRawH2Server(
        (conn, id) => {
          conn.headers(2, hpackStatus(200), { endStream: true });
          conn.headers(id, hpackStatus(200), { endStream: true });
        },
        async url => {
          await using proc = spawnFetch(`
            try { await fetch("${url}", { tls: { rejectUnauthorized: false } }); console.log("ok"); }
            catch (e) { console.log("rejected", e.code); }
          `);
          const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect(stdout.trim()).toBe("rejected HTTP2ProtocolError");
          expect(exitCode).toBe(0);
        },
      );
    });

    test("RST_STREAM(NO_ERROR) before final HEADERS fails the request instead of hanging", async () => {
      await withRawH2Server(
        (conn, id) => {
          conn.rst(id, 0);
        },
        async url => {
          await using proc = spawnFetch(`
            try {
              await fetch("${url}", { tls: { rejectUnauthorized: false } });
              console.log("ok");
            } catch (e) { console.log("rejected", e.code); }
          `);
          const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect(stdout.trim()).toBe("rejected HTTP2StreamReset");
          expect(exitCode).toBe(0);
        },
      );
    });
  });

  test("flag off: ALPN does not offer h2", async () => {
    let sawH2 = false;
    const server = http2.createSecureServer({ ...tls, allowHTTP1: true }, (req, res) => {
      sawH2 = req.httpVersion === "2.0";
      res.writeHead(200);
      res.end("ok");
    });
    server.listen(0);
    await once(server, "listening");
    const { port } = server.address() as import("node:net").AddressInfo;
    try {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--no-warnings",
          "-e",
          `await fetch("https://localhost:${port}", { tls: { rejectUnauthorized: false } }).then(r => r.text());`,
        ],
        env: { ...bunEnv, NODE_TLS_REJECT_UNAUTHORIZED: "0" },
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      expect(sawH2).toBe(false);
    } finally {
      server.close();
    }
  });

  test("protocol:'http2' forces h2 without the env flag", async () => {
    await withH2Server(
      (req, res) => {
        res.writeHead(200);
        res.end(req.httpVersion);
      },
      async url => {
        // No BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT in env.
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            "--no-warnings",
            "-e",
            `const r = await fetch("${url}", { protocol: "http2", tls: { rejectUnauthorized: false } });
             console.log(r.status, await r.text());`,
          ],
          env: { ...bunEnv, NODE_TLS_REJECT_UNAUTHORIZED: "0" },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(stdout.trim()).toBe("200 2.0");
        expect(exitCode).toBe(0);
      },
    );
  });

  test("protocol:'http2' against an h1-only server fails with HTTP2Unsupported", async () => {
    const server = https.createServer({ ...tls }, (_req, res) => res.end("h1"));
    server.listen(0);
    await once(server, "listening");
    const { port } = server.address() as import("node:net").AddressInfo;
    try {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--no-warnings",
          "-e",
          `try {
             await fetch("https://localhost:${port}", { protocol: "http2", tls: { rejectUnauthorized: false } });
             console.log("unexpected-ok");
           } catch (e) { console.log(e.code || String(e)); }`,
        ],
        env: { ...bunEnv, NODE_TLS_REJECT_UNAUTHORIZED: "0" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout.trim()).toContain("HTTP2Unsupported");
      expect(exitCode).toBe(0);
    } finally {
      server.close();
    }
  });

  test("ALPN h1 result re-dispatches coalesced waiters in parallel, not serial", async () => {
    // h1-only TLS server: leader's ALPN resolves to http/1.1, so waiters
    // re-dispatch. Each must open its own connection on the same loop turn
    // rather than re-coalescing onto the first waiter's new PendingConnect.
    let active = 0;
    let peak = 0;
    const { promise, resolve } = Promise.withResolvers<void>();
    const server = https.createServer({ ...tls }, (req, res) => {
      active++;
      peak = Math.max(peak, active);
      if (active === 5) resolve();
      promise.then(() => {
        res.end("ok");
        active--;
      });
    });
    server.listen(0);
    await once(server, "listening");
    const { port } = server.address() as import("node:net").AddressInfo;
    try {
      await using proc = spawnFetch(`
        const url = "https://localhost:${port}/";
        const tls = { rejectUnauthorized: false };
        const rs = await Promise.all(Array.from({ length: 5 }, () => fetch(url, { tls }).then(r => r.text())));
        console.log(rs.join(","));
      `);
      const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout.trim()).toBe("ok,ok,ok,ok,ok");
      expect(exitCode).toBe(0);
      // If waiters re-coalesced, peak would be 1 (sequential); 5 means all
      // five connections were open before any response was written.
      expect(peak).toBe(5);
    } finally {
      server.close();
    }
  });

  test('protocol: "http1.1" overrides the env flag and pins ALPN to http/1.1', async () => {
    // Server is h2-only: the unpinned fetch (env flag on) negotiates h2, while
    // the pinned fetch advertises only http/1.1 and is rejected at ALPN —
    // proving the pin actually reached the ClientHello.
    await withH2Server(
      (req, res) => res.end(req.httpVersion),
      async url => {
        await using proc = spawnFetch(`
          const tls = { rejectUnauthorized: false };
          const a = await fetch("${url}", { tls }).then(r => r.text());
          const b = await fetch("${url}", { protocol: "http1.1", tls }).then(r => r.text(), e => "rejected");
          console.log(a, b);
        `);
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(stdout.trim()).toBe("2.0 rejected");
        expect(exitCode).toBe(0);
      },
    );
  });

  test('protocol: "http2" on a plain http:// URL fails with HTTP2Unsupported', async () => {
    // h2c is out of scope; without an explicit check the request would
    // silently complete over HTTP/1.1.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--no-warnings",
        "-e",
        `try {
           await fetch("http://127.0.0.1:1/", { protocol: "http2" });
           console.log("unexpected-ok");
         } catch (e) { console.log(e.code || String(e)); }`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toContain("HTTP2Unsupported");
    expect(exitCode).toBe(0);
  });

  test("abort while coalesced onto an in-flight TLS connect resolves promptly", async () => {
    // Leader's TLS handshake never completes (server is plain TCP), so its
    // PendingConnect stays open. The waiter has no abort-tracker entry and
    // would otherwise wait for the leader before observing the abort.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--no-warnings",
        "-e",
        `import net from "node:net";
         let conns = 0;
         const { promise: accepted, resolve } = Promise.withResolvers();
         const server = net.createServer(sock => { conns++; sock.on("error", () => {}); resolve(); });
         server.listen(0, "127.0.0.1");
         await new Promise(r => server.on("listening", r));
         const url = "https://127.0.0.1:" + server.address().port + "/";
         const opts = { protocol: "http2", tls: { rejectUnauthorized: false } };
         const leader = fetch(url, opts).catch(() => {});
         const ac = new AbortController();
         const waiter = fetch(url, { ...opts, signal: ac.signal }).then(
           () => "unexpected-ok",
           e => e?.name || String(e),
         );
         // Once the server has accepted the leader's TCP connection both
         // fetches have been processed on the http thread (PendingConnect
         // creation is synchronous in connect()). The settle window lets a
         // non-coalesced waiter's connect land so conns reflects it.
         await accepted;
         await Bun.sleep(100);
         ac.abort();
         console.log(await waiter, "conns=" + conns);
         void leader;
         process.exit(0);`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("AbortError conns=1");
    expect(exitCode).toBe(0);
  });
});
