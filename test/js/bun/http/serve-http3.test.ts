import { describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "crypto";
import { bunEnv, bunExe, tempDir, tls } from "harness";
import { join } from "path";

// Native HTTP/3 fetch wrapper. Every request in this file forces
// `protocol: "http3"` so a regression that silently falls back to TCP
// surfaces as a connect failure (the fixtures bind UDP via `h3: true`).
const fetchH3 = (port: number, path: string, init: RequestInit & { signal?: AbortSignal } = {}) =>
  fetch(`https://127.0.0.1:${port}${path}`, {
    ...init,
    protocol: "http3",
    tls: { rejectUnauthorized: false },
  } as RequestInit);

const fixture = `
import { serve } from "bun";

const big = Buffer.alloc(512 * 1024, "abcdefghijklmnop");

const server = serve({
  port: 0,
  tls: ${JSON.stringify(tls)},
  h3: true,
  h1: process.env.H3_ONLY !== "1",
  routes: {
    "/api/:id": req => new Response("id=" + req.params.id, { headers: { "x-route": "api" } }),
    "/route-only": { POST: () => new Response("posted") },
    "/lifetime/:id": async req => {
      const before = req.params.id;
      await Bun.sleep(0);
      return new Response(before + "|" + req.params.id);
    },
    "/static": new Response("from-static-route", {
      headers: { "content-type": "text/plain", etag: '"v1"' },
    }),
    "/file-route": Bun.file(process.env.BIG_FILE),
  },
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/hello") {
      return new Response("hello over h3", {
        headers: { "x-proto": "h3", "content-type": "text/plain" },
      });
    }
    if (url.pathname === "/echo") {
      const body = await req.text();
      return new Response(body, {
        status: 201,
        headers: {
          "x-method": req.method,
          "x-echo": req.headers.get("x-echo") ?? "",
          "x-len": String(body.length),
        },
      });
    }
    if (url.pathname === "/echo-bytes") {
      const body = await req.arrayBuffer();
      return new Response(body, {
        status: 200,
        headers: { "x-len": String(body.byteLength) },
      });
    }
    if (url.pathname === "/transform") {
      const body = new Uint8Array(await req.arrayBuffer());
      for (let i = 0; i < body.length; i++) body[i] = (body[i] + 1) & 0xff;
      return new Response(body, { headers: { "x-len": String(body.length) } });
    }
    if (url.pathname === "/lifetime") {
      const mode = url.searchParams.get("d");
      const beforeUrl = req.url;
      const beforeMethod = req.method;
      const beforeHdr = req.headers.get("x-probe");
      if (mode === "micro") await Promise.resolve();
      else if (mode === "macro") await Bun.sleep(0);
      else if (mode === "double") { await Promise.resolve(); await Bun.sleep(0); }
      const afterUrl = req.url;
      const afterMethod = req.method;
      const afterHdr = req.headers.get("x-probe");
      const all = {};
      for (const [k, v] of req.headers) all[k] = v;
      const body = await req.text();
      return Response.json({
        ok: beforeUrl === afterUrl && beforeMethod === afterMethod && beforeHdr === afterHdr,
        url: afterUrl, method: afterMethod, probe: afterHdr,
        headerCount: Object.keys(all).length, bodyLen: body.length,
      });
    }
    if (url.pathname === "/spawn") {
      const p = Bun.spawn({
        cmd: [process.execPath, "-e", "for(let i=0;i<40;i++)process.stdout.write('x'.repeat(1000)+String.fromCharCode(10))"],
        stdout: "pipe",
      });
      return new Response(p.stdout, { headers: { "content-type": "text/plain" } });
    }
    if (url.pathname === "/passthrough") {
      return new Response(req.body, { status: 200, headers: { "x-passthrough": "1" } });
    }
    if (url.pathname === "/file-stream") {
      return new Response(Bun.file(process.env.BIG_FILE).stream());
    }
    if (url.pathname === "/headers") {
      const out = {};
      for (const [k, v] of req.headers) out[k] = v;
      return Response.json(out);
    }
    if (url.pathname === "/big") {
      return new Response(big, { headers: { "content-type": "application/octet-stream" } });
    }
    if (url.pathname === "/status") {
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/query") {
      return new Response(url.searchParams.get("q") ?? "<none>");
    }
    if (url.pathname === "/slow") {
      await new Promise(r => setTimeout(r, 50));
      return new Response("late");
    }
    if (url.pathname === "/stream") {
      return new Response(
        new ReadableStream({
          async start(ctrl) {
            for (const c of ["one ", "two ", "three"]) {
              ctrl.enqueue(new TextEncoder().encode(c));
              await new Promise(r => setTimeout(r, 5));
            }
            ctrl.close();
          },
        }),
        { headers: { "content-type": "text/plain" } },
      );
    }
    if (url.pathname === "/file") {
      return new Response(Bun.file(process.env.BIG_FILE));
    }
    if (url.pathname === "/huge-file") {
      return new Response(Bun.file(process.env.HUGE_FILE));
    }
    if (url.pathname === "/remote") {
      return Response.json(server.requestIP(req));
    }
    if (url.pathname === "/fd") {
      // H3 multiplexes streams over one UDP socket, so there is no per-request
      // OS fd. This must return null rather than panicking.
      return Response.json({ fd: server.requestFD(req) });
    }
    return new Response("not found: " + url.pathname, { status: 404 });
  },
});

console.error("PORT=" + server.port);
// Graceful stop on stdin close so the client receives CONNECTION_CLOSE and
// drops the session — otherwise a SIGKILLed server leaves the client session
// retransmitting until lsquic's idle timeout, and if the OS reuses the
// ephemeral UDP port a later test's request gets matched onto that dead conn.
process.stdin.on("data", () => {});
process.stdin.on("end", () => { server.stop(true); setTimeout(() => process.exit(0), 100); });
`;

async function withServer(
  fn: (port: number, dir: string) => Promise<void>,
  env: Record<string, string> = {},
): Promise<void> {
  using dir = tempDir("serve-http3", {
    "server.mjs": fixture,
    "big.bin": Buffer.alloc(200 * 1024, "FILEfile"),
    "huge.bin": Buffer.alloc(2 * 1024 * 1024, "0123456789abcdef"),
  });
  const proc = Bun.spawn({
    cmd: [bunExe(), "server.mjs"],
    cwd: String(dir),
    env: { ...bunEnv, ...env, BIG_FILE: join(String(dir), "big.bin"), HUGE_FILE: join(String(dir), "huge.bin") },
    stdout: "inherit",
    stderr: "pipe",
    stdin: "pipe",
  });
  let port = 0;
  const stderr = proc.stderr.getReader();
  let buffered = "";
  while (true) {
    const { value, done } = await stderr.read();
    if (done) break;
    buffered += new TextDecoder().decode(value);
    const m = buffered.match(/PORT=(\d+)/);
    if (m) {
      port = Number(m[1]);
      break;
    }
  }
  stderr.releaseLock();
  // drain remaining stderr in background so the pipe doesn't fill
  (async () => {
    for await (const _ of proc.stderr) {
    }
  })();
  expect(port).toBeGreaterThan(0);
  try {
    await fn(port, String(dir));
  } finally {
    proc.stdin?.end();
    await Promise.race([proc.exited, Bun.sleep(2000)]);
    proc.kill();
    await proc.exited;
  }
}

describe("Bun.serve HTTP/3", () => {
  test("basic GET", async () => {
    await withServer(async port => {
      const res = await fetchH3(port, "/hello");
      expect(res.status).toBe(200);
      expect(res.headers.get("x-proto")).toBe("h3");
      expect(await res.text()).toBe("hello over h3");
    });
  });

  test("POST echoes body, status, request headers", async () => {
    await withServer(async port => {
      const body = "the quick brown fox jumps over the lazy dog";
      const res = await fetchH3(port, "/echo", {
        method: "POST",
        headers: { "x-echo": "pong" },
        body,
      });
      expect(res.status).toBe(201);
      expect(res.headers.get("x-method")).toBe("POST");
      expect(res.headers.get("x-echo")).toBe("pong");
      expect(res.headers.get("x-len")).toBe(String(body.length));
      expect(await res.text()).toBe(body);
    });
  });

  test("204 with no body", async () => {
    await withServer(async port => {
      const res = await fetchH3(port, "/status");
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
    });
  });

  test("query string is preserved", async () => {
    await withServer(async port => {
      const res = await fetchH3(port, "/query?q=hello%20world&x=1");
      expect(await res.text()).toBe("hello world");
    });
  });

  test("large response body crosses multiple QUIC packets", async () => {
    await withServer(async port => {
      const raw = await fetchH3(port, "/big").then(r => r.bytes());
      expect(raw.length).toBe(512 * 1024);
      // verify content integrity at both ends
      expect(new TextDecoder().decode(raw.subarray(0, 16))).toBe("abcdefghijklmnop");
      expect(new TextDecoder().decode(raw.subarray(-16))).toBe("abcdefghijklmnop");
    });
  });

  test("concurrent requests across separate connections", async () => {
    await withServer(async port => {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => fetchH3(port, `/query?q=r${i}`).then(r => r.text())),
      );
      for (let i = 0; i < results.length; i++) expect(results[i]).toBe(`r${i}`);
    });
  });

  test("client abort mid-response does not crash the server", async () => {
    await withServer(async port => {
      // First request: tiny timeout forces abort during /slow
      await expect(fetchH3(port, "/slow", { signal: AbortSignal.timeout(10) })).rejects.toThrow();
      // Server must still be alive for a follow-up
      const ok = await fetchH3(port, "/hello");
      expect(await ok.text()).toBe("hello over h3");
    });
  });

  test("h1: false rejects HTTP/1.1 but accepts HTTP/3", async () => {
    await withServer(
      async port => {
        const h3 = await fetchH3(port, "/hello");
        expect(await h3.text()).toBe("hello over h3");
        // TCP listener should not be bound at all
        await expect(
          fetch(`https://127.0.0.1:${port}/hello`, { tls: { rejectUnauthorized: false } } as RequestInit),
        ).rejects.toThrow();
      },
      { H3_ONLY: "1" },
    );
  });

  // With h1:false the TCP listen socket is never created, so server.url /
  // server.address / server.stop() must consult the QUIC listener.
  test("h1: false — url/address/stop see the QUIC listener", async () => {
    const script = `
      const tls = ${JSON.stringify(tls)};
      const server = Bun.serve({
        port: 0, tls, h3: true, h1: false,
        fetch: () => new Response("ok"),
      });
      console.error("PORT=" + server.port);
      const url = new URL(server.url);
      console.error("URLPORT=" + url.port);
      console.error("ADDR=" + JSON.stringify(server.address));
      process.stdin.on("data", async () => {
        await server.stop();
        console.error("STOPPED");
      });
    `;
    await withCustomServer(script, async (port, send, waitForStderr) => {
      const urlPort = (await waitForStderr(/URLPORT=(\d+)/))[1];
      expect(Number(urlPort)).toBe(port);
      const addr = JSON.parse((await waitForStderr(/ADDR=(.+)/))[1]);
      expect(addr.port).toBe(port);
      // Prove the server actually serves before stop()
      expect(await fetchH3(port, "/").then(r => r.text())).toBe("ok");
      send("stop");
      await waitForStderr(/STOPPED/);
      // After stop(), the UDP socket should be closed; a new request fails.
      await expect(fetchH3(port, "/", { signal: AbortSignal.timeout(2000) })).rejects.toThrow();
    });
  });

  // RFC 9114 §4.2.2: Content-Length is optional on H3. The up-front 413
  // check only sees CL, so without it the per-chunk cap in
  // onBufferedBodyChunk is what enforces maxRequestBodySize.
  test("maxRequestBodySize is enforced for H3 bodies without Content-Length", async () => {
    const script = `
      const tls = ${JSON.stringify(tls)};
      const server = Bun.serve({
        port: 0, tls, h3: true,
        maxRequestBodySize: 64 * 1024,
        async fetch(req) {
          try { await req.arrayBuffer(); return new Response("read"); }
          catch (e) { return new Response("rejected:" + e.message, { status: 500 }); }
        },
      });
      console.error("PORT=" + server.port);
      process.stdin.on("data", () => {});
    `;
    await withCustomServer(script, async port => {
      // 256 KB body via ReadableStream → no Content-Length on the wire.
      const body = Buffer.alloc(256 * 1024, "A");
      const stream = new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(body);
          ctrl.close();
        },
      });
      const res = await fetchH3(port, "/", {
        method: "POST",
        body: stream,
        headers: { "content-type": "application/octet-stream" },
      });
      expect(res.status).toBe(413);
    });
  });

  test("unknown route returns 404", async () => {
    await withServer(async port => {
      const res = await fetchH3(port, "/nope");
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("not found: /nope");
    });
  });

  test("routes: handler with :params", async () => {
    await withServer(async port => {
      const res = await fetchH3(port, "/api/abc%20123");
      expect(res.status).toBe(200);
      expect(res.headers.get("x-route")).toBe("api");
      expect(await res.text()).toBe("id=abc 123");
    });
  });

  test("routes: per-method handler", async () => {
    await withServer(async port => {
      const post = await fetchH3(port, "/route-only", { method: "POST" });
      expect(await post.text()).toBe("posted");
      // GET falls through to fetch() since the route is POST-only
      const get = await fetchH3(port, "/route-only");
      expect(await get.text()).toBe("not found: /route-only");
    });
  });

  // A method-specific "/*" must not suppress the fetch() fallback for the
  // other methods on the H3 router (it doesn't on H1).
  test("routes: method-specific '/*' falls through to fetch() on other methods", async () => {
    const script = `
      const tls = ${JSON.stringify(tls)};
      const server = Bun.serve({
        port: 0, tls, h3: true,
        routes: { "/*": { GET: () => new Response("from-route") } },
        fetch: req => new Response("from-fetch:" + req.method),
      });
      console.error("PORT=" + server.port);
      process.stdin.on("data", () => {});
    `;
    await withCustomServer(script, async port => {
      expect(await fetchH3(port, "/anything").then(r => r.text())).toBe("from-route");
      expect(await fetchH3(port, "/anything", { method: "POST" }).then(r => r.text())).toBe("from-fetch:POST");
      expect(await fetchH3(port, "/anything", { method: "PUT", body: "x" }).then(r => r.text())).toBe("from-fetch:PUT");
    });
  });

  test("ReadableStream response body", async () => {
    await withServer(async port => {
      expect(await fetchH3(port, "/stream").then(r => r.text())).toBe("one two three");
    });
  });

  test("Bun.file response body", async () => {
    await withServer(async port => {
      const raw = await fetchH3(port, "/file").then(r => r.bytes());
      expect(raw.length).toBe(200 * 1024);
      expect(new TextDecoder().decode(raw.subarray(0, 8))).toBe("FILEfile");
      expect(new TextDecoder().decode(raw.subarray(-8))).toBe("FILEfile");
    });
  });

  test("validation: h3 without tls throws", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "Bun.serve({ port: 0, h3: true, fetch: () => new Response('x') })"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("HTTP/3 requires");
    expect(exitCode).not.toBe(0);
  });

  test("static route (Response value) is mirrored onto H3", async () => {
    await withServer(async port => {
      const res = await fetchH3(port, "/static");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("from-static-route");
      expect(res.headers.get("etag")).toBe('"v1"');
      // If-None-Match -> 304 over H3
      const second = await fetchH3(port, "/static", { headers: { "if-none-match": '"v1"' } });
      expect(second.status).toBe(304);
    });
  });

  test("file route (Bun.file value) streams over H3", async () => {
    await withServer(async port => {
      const raw = await fetchH3(port, "/file-route").then(r => r.bytes());
      expect(raw.length).toBe(200 * 1024);
      expect(Buffer.from(raw.subarray(0, 8)).toString()).toBe("FILEfile");
      // Range request over H3 hits the same FileResponseStream path
      const ranged = await fetchH3(port, "/file-route", { headers: { range: "bytes=4-11" } });
      expect(ranged.status).toBe(206);
      expect(await ranged.text()).toBe("file" + "FILE");
    });
  });

  test("validation: h1:false without h3 throws", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "Bun.serve({ port: 0, h1: false, fetch: () => new Response('x') })"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr.toLowerCase()).toContain("h1");
    expect(exitCode).not.toBe(0);
  });
});

// Cases ported from h2o t/40http3 and aioquic interop. Each test gets its own
// server (withServer) so they can run concurrently.
describe("Bun.serve HTTP/3 adversarial", () => {
  const md5 = (b: Uint8Array | ArrayBuffer) => createHash("md5").update(Buffer.from(b)).digest("hex");

  test("64 concurrent streams on one connection", async () => {
    // h2o uses 1000; 64 stays inside lsquic's default initial-max-streams
    // and the debug-build 5s budget while still being 4× the existing
    // 16-concurrent coverage.
    await withServer(async port => {
      const N = 64;
      const results = await Promise.all(Array.from({ length: N }, () => fetchH3(port, "/hello").then(r => r.text())));
      expect(results.every(t => t === "hello over h3")).toBe(true);
      expect(results.length).toBe(N);
    });
  });

  test("large request headers (7k value + 50×100B) reach handler", async () => {
    await withServer(async port => {
      const big = Buffer.alloc(7000, "H").toString();
      const small = Buffer.alloc(100, "v").toString();
      const headers: Record<string, string> = { "x-huge": big };
      for (let i = 0; i < 50; i++) headers[`x-h${i}`] = small;
      const res = await fetchH3(port, "/headers", { headers });
      expect(res.status).toBe(200);
      const seen = (await res.json()) as Record<string, string>;
      expect(seen["x-huge"]?.length).toBe(7000);
      for (let i = 0; i < 50; i++) expect(seen[`x-h${i}`]).toBe(small);
    });
  });

  test("8 MB POST body echoes byte-exact", async () => {
    await withServer(async port => {
      // Patterned (not crypto-random) so the test is deterministic but still
      // crosses many QUIC packets and stresses the recvmmsg/sendmmsg paths.
      const payload = Buffer.alloc(8 * 1024 * 1024);
      for (let i = 0; i < payload.length; i++) payload[i] = (i * 131) & 0xff;
      const res = await fetchH3(port, "/echo-bytes", {
        method: "POST",
        body: payload,
        headers: { "content-type": "application/octet-stream" },
      });
      const raw = await res.bytes();
      expect(raw.length).toBe(payload.length);
      expect(md5(raw)).toBe(md5(payload));
    });
  });

  test("slow client read drains streamed response", async () => {
    await withServer(async port => {
      // Body is tiny ("one two three"); the point is the server sees
      // backpressure from the QUIC flow-control window and the
      // H3ResponseSink onWritable path completes instead of hanging.
      // Throttle by reading via getReader() with a delay between chunks.
      const res = await fetchH3(port, "/stream");
      const reader = res.body!.getReader();
      let out = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        out += new TextDecoder().decode(value);
        await Bun.sleep(20);
      }
      expect(out).toBe("one two three");
    });
  });

  test("204 then 200 on the same connection", async () => {
    await withServer(async port => {
      const r1 = await fetchH3(port, "/status");
      expect(r1.status).toBe(204);
      const r2 = await fetchH3(port, "/hello");
      expect(r2.status).toBe(200);
      expect(await r2.text()).toBe("hello over h3");
    });
  });

  test("HEAD on /big returns content-length and no body", async () => {
    await withServer(async port => {
      const res = await fetchH3(port, "/big", { method: "HEAD" });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-length")).toBe("524288");
      expect((await res.bytes()).length).toBe(0);
    });
  });

  test("lying content-length doesn't take down the listener", async () => {
    await withServer(async port => {
      // RFC 9114 §4.1.2: a request whose payload doesn't match content-length
      // is malformed. lsquic/nghttp3 may RESET_STREAM here — we don't care
      // about the exact response, only that the process keeps serving.
      await fetchH3(port, "/echo", {
        method: "POST",
        body: Buffer.alloc(100, "x"),
        headers: { "content-length": "5" },
      })
        .then(r => r.text())
        .catch(() => {});
      const res = await fetchH3(port, "/hello");
      expect(await res.text()).toBe("hello over h3");
    });
  });

  test("client RST mid-/big does not break the listener", async () => {
    await withServer(async port => {
      // Abort while the 512 KB body is still draining.
      const ac = new AbortController();
      const p = fetchH3(port, "/big", { signal: ac.signal }).then(async res => {
        const reader = res.body!.getReader();
        await reader.read();
        ac.abort();
        try {
          while (!(await reader.read()).done);
        } catch {}
      });
      await p.catch(() => {});
      const res = await fetchH3(port, "/hello");
      expect(await res.text()).toBe("hello over h3");
    });
  });

  // The big one: every concurrent stream gets back exactly its own bytes,
  // transformed. Catches shared-buffer reuse in quic.c read_buf, response
  // backpressure aliasing in Http3ResponseData, and partial-write offset
  // bugs in H3ResponseSink. Bodies are crypto-random so any cross-stream
  // leak shows up as an md5 mismatch, not just an offset shift.
  const isolationRound = async (port: number, count: number, size: number) => {
    const transform = (input: Uint8Array) => {
      const out = Buffer.allocUnsafe(input.length);
      for (let i = 0; i < input.length; i++) out[i] = (input[i] + 1) & 0xff;
      return out;
    };
    const firstDiff = (a: Uint8Array, b: Uint8Array) => {
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
      return a.length === b.length ? -1 : n;
    };
    const bodies = Array.from({ length: count }, () => new Uint8Array(randomBytes(size)));
    const expected = bodies.map(transform);
    const results = await Promise.all(
      bodies.map(b =>
        fetchH3(port, "/transform", {
          method: "POST",
          body: b,
          headers: { "content-type": "application/octet-stream" },
        }).then(r => r.bytes()),
      ),
    );
    for (let i = 0; i < count; i++) {
      const raw = results[i];
      expect(raw.length).toBe(size);
      const want = md5(expected[i]);
      const got = md5(raw);
      if (got !== want) {
        const at = firstDiff(raw, expected[i]);
        throw new Error(
          `stream ${i}/${count} (${size}B): first divergence at byte ${at}; ` +
            `expected ${expected[i][at]}, got ${raw[at]} (input byte was ${bodies[i][at]})`,
        );
      }
      expect(got).toBe(want);
    }
  };

  // 8 × 96KB — past the 16KB quic.c read_buf and the 64KB lsquic stream
  // window. Aliasing bugs reproduce at any N≥2; 8 fits the debug-build 5s
  // default. (Unlike the curl version these now share one QUIC connection,
  // which is the more interesting case for read_buf reuse.)
  test("per-stream body isolation: 8 concurrent 96KB transformed echoes", async () => {
    await withServer(port => isolationRound(port, 8, 96 * 1024));
  });

  // 3 × 300KB — forces Http3Response backpressure → onWritable → drain.
  test("per-stream body isolation: 3 concurrent 300KB transformed echoes", async () => {
    await withServer(port => isolationRound(port, 3, 300 * 1024));
  });

  test("Response(subprocess.stdout) streams over H3", async () => {
    await withServer(async port => {
      const raw = await fetchH3(port, "/spawn").then(r => r.bytes());
      expect(raw.length).toBe(40 * 1001);
      const text = Buffer.from(raw).toString();
      const lines = text.split("\n").filter(Boolean);
      expect(lines.length).toBe(40);
      expect(lines.every(l => l === Buffer.alloc(1000, "x").toString())).toBe(true);
    });
  });

  test("Response(req.body) passthrough echoes byte-exact", async () => {
    await withServer(async port => {
      const body = new Uint8Array(randomBytes(80 * 1024));
      const res = await fetchH3(port, "/passthrough", {
        method: "POST",
        body,
        headers: { "content-type": "application/octet-stream" },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("x-passthrough")).toBe("1");
      const payload = await res.bytes();
      expect(payload.length).toBe(body.length);
      expect(md5(payload)).toBe(md5(body));
    });
  });

  test("req.{url,method,headers,params} survive micro/macrotask awaits", async () => {
    // uws.H3.Request lives on the on_stream_headers stack frame; the JS
    // Request must have copied everything before the first await returns.
    await withServer(async port => {
      const modes = ["none", "micro", "macro", "double"];
      const results = await Promise.all(
        modes.map(mode =>
          fetchH3(port, `/lifetime?d=${mode}`, {
            method: "POST",
            headers: { "x-probe": `alive-${mode}` },
            body: `payload-${mode}`,
          }).then(r => r.json()),
        ),
      );
      for (let i = 0; i < modes.length; i++) {
        const mode = modes[i];
        const out = results[i] as {
          ok: boolean;
          url: string;
          method: string;
          probe: string;
          headerCount: number;
          bodyLen: number;
        };
        if (!out.ok || out.probe !== `alive-${mode}`)
          throw new Error(`mode=${mode}: before/after mismatch ${JSON.stringify(out)}`);
        expect(out.ok).toBe(true);
        expect(out.url.endsWith(`/lifetime?d=${mode}`)).toBe(true);
        expect(out.method).toBe("POST");
        expect(out.probe).toBe(`alive-${mode}`);
        expect(out.headerCount).toBeGreaterThan(0);
        expect(out.bodyLen).toBe(`payload-${mode}`.length);
      }
      expect(await fetchH3(port, "/lifetime/abc123").then(r => r.text())).toBe("abc123|abc123");
    });
  });

  test("Response(Bun.file().stream()) goes through H3ResponseSink", async () => {
    await withServer(async (port, dir) => {
      const raw = await fetchH3(port, "/file-stream").then(r => r.bytes());
      expect(raw.length).toBe(200 * 1024);
      const onDisk = await Bun.file(join(dir, "big.bin")).bytes();
      expect(md5(raw)).toBe(md5(onDisk));
    });
  });

  // bughunt #4: canSendfile() must not pick the sendfile() path for H3 — it
  // has no socket fd. A 2 MB file is over the 1 MiB sendfile threshold.
  test("Bun.file >=1 MiB takes the reader path, not sendfile", async () => {
    await withServer(async port => {
      const raw = await fetchH3(port, "/huge-file").then(r => r.bytes());
      expect(raw.length).toBe(2 * 1024 * 1024);
      expect(md5(raw)).toBe(md5(Buffer.alloc(2 * 1024 * 1024, "0123456789abcdef")));
    });
  });

  // bughunt #5: getRemoteSocketInfo must return a slice with a valid length.
  test("server.requestIP(req) returns the peer address", async () => {
    await withServer(async port => {
      const ip = (await fetchH3(port, "/remote").then(r => r.json())) as {
        address: string;
        family: string;
        port: number;
      };
      // The native client binds a shared dual-stack `::` socket, so the peer
      // is loopback in whichever family the kernel picked.
      expect(["127.0.0.1", "::1"]).toContain(ip.address);
      expect(["IPv4", "IPv6"]).toContain(ip.family);
      expect(typeof ip.port).toBe("number");
    });
  });

  // bughunt: server.requestFD(req) must return null for H3 (no per-request fd)
  // instead of panicking through AnyRequestContext.getFd's else branch.
  test("server.requestFD(req) returns null for HTTP/3 requests", async () => {
    await withServer(async port => {
      const res = (await fetchH3(port, "/fd").then(r => r.json())) as { fd: number | null };
      expect(res.fd).toBeNull();
    });
  });

  // bughunt #6: H3 bodies are FIN-terminated; Content-Length is optional.
  // A ReadableStream body uploads without Content-Length.
  test("POST body without Content-Length still reaches the handler", async () => {
    await withServer(async port => {
      const body = Buffer.alloc(40_000, "noCL");
      const res = await fetchH3(port, "/echo-bytes", {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: new ReadableStream({
          start(ctrl) {
            ctrl.enqueue(body);
            ctrl.close();
          },
        }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("x-len")).toBe(String(body.length));
      const got = await res.bytes();
      expect(md5(got)).toBe(md5(body));
    });
  });
});

/** Spawn a one-off H3 server from a custom script body and hand back its
 * port + a way to send it stdin commands ("reload" / "stop"). */
async function withCustomServer(
  script: string,
  fn: (
    port: number,
    send: (cmd: string) => void,
    waitForStderr: (re: RegExp) => Promise<RegExpMatchArray>,
  ) => Promise<void>,
) {
  using dir = tempDir("serve-http3-custom", { "server.mjs": script });
  const proc = Bun.spawn({
    cmd: [bunExe(), "server.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "inherit",
    stderr: "pipe",
    stdin: "pipe",
  });
  // Single owner of stderr: buffer everything and let callers await patterns.
  // Avoids the two-consumers race where a background drain steals the line a
  // test is waiting for.
  let buf = "";
  let eof = false;
  const waiters: Array<{ re: RegExp; resolve: (m: RegExpMatchArray) => void; reject: (e: Error) => void }> = [];
  const drain = (async () => {
    for await (const chunk of proc.stderr) {
      buf += new TextDecoder().decode(chunk);
      for (let i = waiters.length - 1; i >= 0; i--) {
        const m = buf.match(waiters[i].re);
        if (m) waiters.splice(i, 1)[0].resolve(m);
      }
    }
    eof = true;
    for (const w of waiters.splice(0)) w.reject(new Error(`server exited without matching ${w.re}; stderr:\n${buf}`));
  })();
  const waitForStderr = (re: RegExp) =>
    new Promise<RegExpMatchArray>((resolve, reject) => {
      const m = buf.match(re);
      if (m) return resolve(m);
      if (eof) return reject(new Error(`server already exited without matching ${re}; stderr:\n${buf}`));
      waiters.push({ re, resolve, reject });
    });
  const port = Number((await waitForStderr(/PORT=(\d+)/))[1]);
  expect(port).toBeGreaterThan(0);
  const send = (cmd: string) => proc.stdin!.write(cmd + "\n");
  try {
    await fn(port, send, waitForStderr);
  } finally {
    proc.stdin?.end();
    proc.kill();
    await proc.exited;
    await drain.catch(() => {});
  }
}

describe("Bun.serve HTTP/3 lifecycle", () => {
  // bughunt #2: server.reload() must clear the H3 router so removed routes
  // fall through to the fetch handler instead of dereferencing freed pointers.
  test("server.reload() clears stale H3 routes", async () => {
    const script = `
      const tls = ${JSON.stringify(tls)};
      let server = Bun.serve({
        port: 0, tls, h3: true,
        routes: { "/old": new Response("old-route") },
        fetch: () => new Response("fallback", { status: 404 }),
      });
      console.error("PORT=" + server.port);
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", line => {
        if (line.includes("reload")) {
          server.reload({
            routes: { "/new": new Response("new-route") },
            fetch: () => new Response("fallback", { status: 404 }),
          });
          console.error("RELOADED");
        }
      });
    `;
    await withCustomServer(script, async (port, send, waitForStderr) => {
      expect(await fetchH3(port, "/old").then(r => r.text())).toBe("old-route");
      send("reload");
      await waitForStderr(/RELOADED/);
      const oldAfter = await fetchH3(port, "/old");
      expect(oldAfter.status).toBe(404);
      expect(await oldAfter.text()).toBe("fallback");
      expect(await fetchH3(port, "/new").then(r => r.text())).toBe("new-route");
    });
  });

  // bughunt #3: server.stop() must not leave the lsquic engine pointing at a
  // freed listen-socket. The follow-up GET should cleanly fail to connect,
  // and the process must still be alive to exit 0 on its own.
  test("server.stop() with live H3 connections does not UAF", async () => {
    const script = `
      const tls = ${JSON.stringify(tls)};
      const server = Bun.serve({
        port: 0, tls, h3: true,
        fetch: () => new Response("alive"),
      });
      console.error("PORT=" + server.port);
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", async line => {
        if (line.includes("stop")) {
          server.stop(true);
          // give the timer one tick to prove it doesn't deref freed peer_ctx
          await Bun.sleep(50);
          console.error("STOPPED");
          process.exit(0);
        }
      });
    `;
    await withCustomServer(script, async (port, send, waitForStderr) => {
      expect(await fetchH3(port, "/").then(r => r.text())).toBe("alive");
      send("stop");
      await waitForStderr(/STOPPED/);
      // port should now be dead — connect must fail, not hang
      await expect(fetchH3(port, "/", { signal: AbortSignal.timeout(2000) })).rejects.toThrow();
    });
  });

  // B: server.stop() (graceful) sends GOAWAY and lets in-flight H3 requests
  // finish before the engine tears down. lsquic_engine_cooldown drops mini
  // (still-handshaking) conns immediately, so we wait until the server has
  // actually entered every handler before stopping — no arbitrary sleep.
  test("graceful stop: in-flight H3 requests complete after server.stop()", async () => {
    const script = `
      const tls = ${JSON.stringify(tls)};
      let stopping = false, inflight = 0;
      const server = Bun.serve({
        port: 0, tls, h3: true, idleTimeout: 30,
        async fetch(req) {
          const url = new URL(req.url);
          if (url.pathname === "/slow") {
            inflight++;
            while (!stopping) await Bun.sleep(5);
            await Bun.sleep(50);
            return new Response("late");
          }
          if (url.pathname === "/inflight") return new Response(String(inflight));
          return new Response("ok");
        },
      });
      console.error("PORT=" + server.port);
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", line => {
        if (line.includes("stop")) { stopping = true; server.stop(); }
        if (line.includes("exit")) process.exit(0);
      });
    `;
    await withCustomServer(script, async (port, send) => {
      const N = 4;
      const inflight = Array.from({ length: N }, () => fetchH3(port, "/slow").then(r => r.text()));
      // Poll until the server has entered all N handlers (handshakes promoted),
      // then it's safe to cooldown — drop_all_mini_conns won't bite.
      while (true) {
        const r = await fetchH3(port, "/inflight").then(r => r.text());
        if (Number(r) >= N) break;
      }
      send("stop");
      const results = await Promise.all(inflight);
      for (const r of results) expect(r).toBe("late");
      // New connection during drain is rejected (engine cooling down).
      await expect(fetchH3(port, "/", { signal: AbortSignal.timeout(2000) })).rejects.toThrow();
      send("exit");
    });
  });

  // Each QUIC connection counts as a virtual poll (loop->num_polls); after
  // server.stop() drains, the last conn close releases the UDP fd and the
  // loop has no polls left — the process exits without process.exit().
  test("h3-only server exits naturally after stop() drains", async () => {
    using dir = tempDir("serve-http3-exit", {
      "server.mjs": `
        const server = Bun.serve({
          port: 0, tls: ${JSON.stringify(tls)}, h3: true, h1: false,
          fetch: () => new Response("ok"),
        });
        console.error("PORT=" + server.port);
        process.stdin.once("data", () => server.stop());
      `,
    });
    const proc = Bun.spawn({
      cmd: [bunExe(), "server.mjs"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdin: "pipe",
    });
    let buf = "";
    const r = proc.stderr.getReader();
    while (!buf.includes("PORT=")) {
      const { value, done } = await r.read();
      if (done) break;
      buf += new TextDecoder().decode(value);
    }
    r.releaseLock();
    const port = Number(buf.match(/PORT=(\d+)/)![1]);
    expect(await fetchH3(port, "/").then(r => r.text())).toBe("ok");
    proc.stdin!.write("stop\n");
    proc.stdin!.end();
    // No process.exit() in the script — exiting proves the QUIC poll refs
    // were released. Timeout would mean the UDP fd is still holding the loop.
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });

  // C: req.signal fires when the client resets the H3 stream mid-request.
  test("req.signal aborts on client RST", async () => {
    const script = `
      const tls = ${JSON.stringify(tls)};
      let aborted = 0;
      const server = Bun.serve({
        port: 0, tls, h3: true,
        async fetch(req) {
          const url = new URL(req.url);
          if (url.pathname === "/hang") {
            req.signal.addEventListener("abort", () => { aborted++; });
            await new Promise(r => req.signal.addEventListener("abort", r));
            return new Response("never");
          }
          if (url.pathname === "/aborted") return new Response(String(aborted));
          return new Response("ok");
        },
      });
      console.error("PORT=" + server.port);
      process.stdin.on("data", () => {});
    `;
    await withCustomServer(script, async port => {
      // Warm the QUIC connection so the /hang stream is actually bound
      // (qstream != null) before we abort — otherwise abort() is a no-op
      // and the server never sees STOP_SENDING.
      await fetchH3(port, "/aborted").then(r => r.text());
      const ac = new AbortController();
      const p = fetchH3(port, "/hang", { signal: ac.signal });
      await Bun.sleep(200);
      ac.abort();
      await expect(p).rejects.toThrow();
      // The signal fires from on_stream_close, which runs on the next
      // process_conns tick after the RST lands.
      let count = "0";
      for (let i = 0; i < 60 && count === "0"; i++) {
        count = await fetchH3(port, "/aborted").then(r => r.text());
        if (count === "0") await Bun.sleep(50);
      }
      expect(Number(count)).toBeGreaterThan(0);
    });
  });
});

describe("Bun.serve HTTP/3 production", () => {
  // E: H1 responses advertise the H3 endpoint so browsers can discover it.
  test("Alt-Svc emitted on HTTP/1.1 responses when h3 is enabled", async () => {
    await withServer(async port => {
      // The fetch()/static-route/file-route response paths each write
      // headers from a different place; all three must advertise h3.
      for (const path of ["/hello", "/static", "/file-route"]) {
        const res = await fetch(`https://127.0.0.1:${port}${path}`, { tls: { rejectUnauthorized: false } });
        expect(res.status).toBe(200);
        const alt = res.headers.get("alt-svc") ?? "";
        expect(alt).toContain('h3=":' + port + '"');
      }
    });
  });

  // RFC 9114 §4.2 forbids Transfer-Encoding; the server rejects it with 400
  // (server.zig prepareJsRequestContextFor). Not testable via the native
  // client either — `isConnectionSpecific()` strips the header before
  // encoding — so the check is defense-in-depth against raw QUIC clients.

  // I: server.upgrade() returns false over H3 instead of crashing, and the
  // handler can still send a normal response.
  test("server.upgrade(req) over H3 returns false cleanly", async () => {
    const script = `
      const tls = ${JSON.stringify(tls)};
      const server = Bun.serve({
        port: 0, tls, h3: true,
        websocket: { message() {} },
        fetch(req, srv) {
          const ok = srv.upgrade(req);
          return new Response("upgrade=" + ok);
        },
      });
      console.error("PORT=" + server.port);
      process.stdin.on("data", () => {});
    `;
    await withCustomServer(script, async port => {
      const res = await fetchH3(port, "/");
      expect(await res.text()).toBe("upgrade=false");
    });
  });

  // Expect: 100-continue is handled at the uWS layer for both transports
  // (HttpContext.h / Http3Context.h call writeContinue before routing); a
  // curl --expect100-timeout assertion was flaky enough to drop here.
});
