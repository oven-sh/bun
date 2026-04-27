import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, tls } from "harness";
import { once } from "node:events";
import http2 from "node:http2";
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

describe("fetch() over HTTP/2 (BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT)", () => {
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
    const big = "a".repeat(70_000);
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
  }, 30_000);

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
});
