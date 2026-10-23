import type { ServerWebSocket } from "bun";
import { socketFaultInjection } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash, createPrivateKey, randomBytes, X509Certificate } from "crypto";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isASAN, tempDir, tls } from "harness";
import { once } from "node:events";
import type { SocketAddress } from "node:net";
import { connect, QuicEndpoint, type SessionOptions } from "node:quic";
import { connect as connectTLS } from "node:tls";
import { join } from "path";

// Native HTTP/3 fetch wrapper. Every request in this file forces
// `protocol: "http3"` so a regression that silently falls back to TCP
// surfaces as a connect failure (the fixtures bind UDP via `http3: true`).
const fetchH3 = (port: number, path: string, init: RequestInit = {}) =>
  fetch(`https://127.0.0.1:${port}${path}`, {
    ...init,
    protocol: "http3",
    tls: { rejectUnauthorized: false },
  } as RequestInit);

// Deadline for the post-stop() "new request must fail" checks. The QUIC client
// never fails fast on a dead UDP port, so only this abort rejects the promise;
// a live loopback server answers in well under this even on the ASAN lane.
const DEAD_PORT_ABORT_MS = 1000;

// Every spawned fixture in this file is torn down on stdin close so the client's
// pooled session sees CONNECTION_CLOSE and is dropped; otherwise a killed
// process leaves the client retransmitting until lsquic's idle timeout, and if
// the OS reuses that ephemeral UDP port a later test's request gets matched
// onto the dead conn. us_quic_listen_socket_close() flushes CONNECTION_CLOSE
// synchronously during stop(true), so the loopback datagram is already queued on
// the client's socket and the process can exit right away.
//
// The fixtures use Bun.stdin and Bun.stdout. The first access to process.stdin or
// process.stdout loads node's stream stack, which takes about a second per
// process on a debug build.
const STDIN_HELPERS = `
async function readStdin(onChunk = () => {}) {
  for await (const chunk of Bun.stdin.stream()) onChunk(new TextDecoder().decode(chunk));
}
function stopOnStdinEnd(onChunk) {
  readStdin(onChunk).then(() => { server.stop(true); process.exit(0); });
}
`;
const STOP_ON_STDIN_END = `${STDIN_HELPERS}stopOnStdinEnd();`;

const md5 = (b: Uint8Array | ArrayBuffer) =>
  createHash("md5")
    .update(Buffer.from(b as Uint8Array))
    .digest("hex");

const BIG_BODY = Buffer.alloc(512 * 1024, "abcdefghijklmnop");
const BIG_FILE_BYTES = Buffer.alloc(200 * 1024, "FILEfile");
const HUGE_FILE_BYTES = Buffer.alloc(2 * 1024 * 1024, "0123456789abcdef");

/** In-process server with every route the request/response tests use. `dir`
 * contains big.bin (BIG_FILE_BYTES) and huge.bin (HUGE_FILE_BYTES). */
function serveFixture(dir: string, { http1 = true } = {}) {
  const bigFile = join(dir, "big.bin");
  const hugeFile = join(dir, "huge.bin");
  return Bun.serve({
    port: 0,
    tls,
    http3: true,
    http1,
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
      "/file-route": Bun.file(bigFile),
      "/static-hop": new Response("hop", {
        headers: { connection: "keep-alive", "keep-alive": "timeout=5", te: "gzip", "x-kept": "1" },
      }),
      "/file-hop": new Response(Bun.file(bigFile), { headers: { connection: "close", upgrade: "x", "x-kept": "1" } }),
    },
    async fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/hop-headers") {
        return new Response("hi", {
          headers: {
            "transfer-encoding": "chunked",
            connection: "close",
            "keep-alive": "timeout=5",
            upgrade: "websocket",
            "proxy-connection": "x",
            te: "gzip",
            "x-kept": "1",
          },
        });
      }
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
        else if (mode === "double") {
          await Promise.resolve();
          await Bun.sleep(0);
        }
        const afterUrl = req.url;
        const afterMethod = req.method;
        const afterHdr = req.headers.get("x-probe");
        const all: Record<string, string> = {};
        for (const [k, v] of req.headers) all[k] = v;
        const body = await req.text();
        return Response.json({
          ok: beforeUrl === afterUrl && beforeMethod === afterMethod && beforeHdr === afterHdr,
          url: afterUrl,
          method: afterMethod,
          probe: afterHdr,
          headerCount: Object.keys(all).length,
          bodyLen: body.length,
        });
      }
      if (url.pathname === "/spawn") {
        const p = Bun.spawn({
          cmd: [
            bunExe(),
            "-e",
            "const line=Buffer.alloc(1000,'x').toString()+String.fromCharCode(10);for(let i=0;i<40;i++)await Bun.write(Bun.stdout,line)",
          ],
          env: bunEnv,
          stdout: "pipe",
        });
        return new Response(p.stdout, { headers: { "content-type": "text/plain" } });
      }
      if (url.pathname === "/passthrough") {
        return new Response(req.body, { status: 200, headers: { "x-passthrough": "1" } });
      }
      if (url.pathname === "/file-stream") {
        return new Response(Bun.file(bigFile).stream());
      }
      if (url.pathname === "/headers") {
        const out: Record<string, string> = {};
        for (const [k, v] of req.headers) out[k] = v;
        return Response.json(out);
      }
      if (url.pathname === "/big") {
        return new Response(BIG_BODY, { headers: { "content-type": "application/octet-stream" } });
      }
      if (url.pathname === "/status") {
        return new Response(null, { status: 204 });
      }
      if (url.pathname === "/query") {
        return new Response(url.searchParams.get("q") ?? "<none>");
      }
      if (url.pathname === "/slow") {
        // Long enough that the client-abort test's 10 ms timer always fires first.
        await new Promise(r => setTimeout(r, 500));
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
        return new Response(Bun.file(bigFile));
      }
      if (url.pathname === "/huge-file") {
        return new Response(Bun.file(hugeFile));
      }
      if (url.pathname === "/remote") {
        return Response.json(server.requestIP(req));
      }
      return new Response("not found: " + url.pathname, { status: 404 });
    },
  });
}

// The request/response tests share one server for the whole file.
let fixtureDir: ReturnType<typeof tempDir> | undefined;
let fixture: ReturnType<typeof serveFixture> | undefined;
beforeAll(() => {
  fixtureDir = tempDir("serve-http3", {
    "big.bin": BIG_FILE_BYTES,
    "huge.bin": HUGE_FILE_BYTES,
  });
  fixture = serveFixture(String(fixtureDir));
});
afterAll(async () => {
  try {
    await fixture?.stop(true);
  } finally {
    fixtureDir?.[Symbol.dispose]();
  }
});

async function withServer(fn: (port: number, dir: string) => Promise<void>): Promise<void> {
  await fn(fixture!.port!, String(fixtureDir!));
}

// A test that probes a dead port is test.serial so no other fixture can bind
// that port meanwhile. A test that breaks the connection on purpose needs its
// own server, because the others multiplex over the same pooled connection.
describe.concurrent("Bun.serve HTTP/3", () => {
  test("basic GET", async () => {
    await withServer(async port => {
      const res = await fetchH3(port, "/hello");
      expect(res.status).toBe(200);
      expect(res.headers.get("x-proto")).toBe("h3");
      expect(res.headers.get("content-type")).toBe("text/plain");
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
      const res = await fetchH3(port, "/big");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/octet-stream");
      expect(res.headers.get("content-length")).toBe("524288");
      const raw = await res.bytes();
      expect(raw.length).toBe(512 * 1024);
      expect(md5(raw)).toBe(md5(BIG_BODY));
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
      await expect(fetchH3(port, "/slow", { signal: AbortSignal.timeout(10) })).rejects.toMatchObject({
        name: "TimeoutError",
      });
      // Server must still be alive for a follow-up
      const ok = await fetchH3(port, "/hello");
      expect(ok.status).toBe(200);
      expect(ok.headers.get("x-proto")).toBe("h3");
      expect(await ok.text()).toBe("hello over h3");
    });
  });

  test.serial("http1: false rejects HTTP/1.1 but accepts HTTP/3", async () => {
    await using server = serveFixture(String(fixtureDir!), { http1: false });
    const port = server.port!;
    const h3 = await fetchH3(port, "/hello");
    expect(h3.status).toBe(200);
    expect(h3.headers.get("x-proto")).toBe("h3");
    expect(await h3.text()).toBe("hello over h3");
    // TCP listener should not be bound at all
    await expect(
      fetch(`https://127.0.0.1:${port}/hello`, { tls: { rejectUnauthorized: false } } as RequestInit),
    ).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });

  // With http1:false the TCP listen socket is never created, so server.url /
  // server.address / server.stop() must consult the QUIC listener.
  test.serial("http1: false — url/address/stop see the QUIC listener", async () => {
    const script = `
      const tls = ${JSON.stringify(tls)};
      const server = Bun.serve({
        port: 0, tls, http3: true, http1: false,
        fetch: () => new Response("ok"),
      });
      console.error("PORT=" + server.port);
      const url = new URL(server.url);
      console.error("URLPORT=" + url.port);
      console.error("ADDR=" + JSON.stringify(server.address));
      ${STDIN_HELPERS}
      readStdin(async () => {
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
      await expect(fetchH3(port, "/", { signal: AbortSignal.timeout(DEAD_PORT_ABORT_MS) })).rejects.toThrow();
    });
  });

  // RFC 9114 §4.2.2: Content-Length is optional on H3. The up-front 413
  // check only sees CL, so without it the per-chunk cap in
  // onBufferedBodyChunk is what enforces maxRequestBodySize.
  test("maxRequestBodySize is enforced for H3 bodies without Content-Length", async () => {
    const script = `
      const tls = ${JSON.stringify(tls)};
      const server = Bun.serve({
        port: 0, tls, http3: true,
        maxRequestBodySize: 64 * 1024,
        async fetch(req) {
          try { await req.arrayBuffer(); return new Response("read"); }
          catch (e) { return new Response("rejected:" + e.message, { status: 500 }); }
        },
      });
      console.error("PORT=" + server.port);
      ${STOP_ON_STDIN_END}
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
      expect(await res.text()).toBe("");
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
      expect(post.status).toBe(200);
      expect(await post.text()).toBe("posted");
      // GET falls through to fetch() since the route is POST-only
      const get = await fetchH3(port, "/route-only");
      expect(get.status).toBe(404);
      expect(await get.text()).toBe("not found: /route-only");
    });
  });

  // A method-specific "/*" must not suppress the fetch() fallback for the
  // other methods on the H3 router (it doesn't on H1).
  test("routes: method-specific '/*' falls through to fetch() on other methods", async () => {
    const script = `
      const tls = ${JSON.stringify(tls)};
      const server = Bun.serve({
        port: 0, tls, http3: true,
        routes: { "/*": { GET: () => new Response("from-route") } },
        fetch: req => new Response("from-fetch:" + req.method),
      });
      console.error("PORT=" + server.port);
      ${STOP_ON_STDIN_END}
    `;
    await withCustomServer(script, async port => {
      expect(await fetchH3(port, "/anything").then(r => r.text())).toBe("from-route");
      expect(await fetchH3(port, "/anything", { method: "POST" }).then(r => r.text())).toBe("from-fetch:POST");
      expect(await fetchH3(port, "/anything", { method: "PUT", body: "x" }).then(r => r.text())).toBe("from-fetch:PUT");
    });
  });

  test("ReadableStream response body", async () => {
    await withServer(async port => {
      const res = await fetchH3(port, "/stream");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/plain");
      expect(await res.text()).toBe("one two three");
    });
  });

  test("Bun.file response body", async () => {
    await withServer(async port => {
      const res = await fetchH3(port, "/file");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/octet-stream");
      expect(res.headers.get("content-length")).toBe("204800");
      const raw = await res.bytes();
      expect(raw.length).toBe(200 * 1024);
      expect(md5(raw)).toBe(md5(BIG_FILE_BYTES));
    });
  });

  test("validation: http3 without tls throws", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "Bun.serve({ port: 0, http3: true, fetch: () => new Response('x') })"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("HTTP/3 requires");
    expect(exitCode).not.toBe(0);
  });

  test("connection-specific response headers are dropped on fetch, static and file routes", async () => {
    await withServer(async port => {
      for (const path of ["/hop-headers", "/static-hop", "/file-hop"]) {
        const res = await fetchH3(port, path);
        expect(res.status).toBe(200);
        expect(res.headers.get("x-kept")).toBe("1");
        for (const h of ["connection", "keep-alive", "upgrade", "proxy-connection", "transfer-encoding", "te"]) {
          expect([path, h, res.headers.get(h)]).toEqual([path, h, null]);
        }
        await res.arrayBuffer();
      }
    });
  });

  test("static route (Response value) is mirrored onto H3", async () => {
    await withServer(async port => {
      const res = await fetchH3(port, "/static");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("from-static-route");
      expect(res.headers.get("etag")).toBe('"v1"');
      expect(res.headers.get("content-type")).toBe("text/plain");
      // If-None-Match -> 304 over H3
      const second = await fetchH3(port, "/static", { headers: { "if-none-match": '"v1"' } });
      expect(second.status).toBe(304);
      expect(second.headers.get("etag")).toBe('"v1"');
      expect(await second.text()).toBe("");
    });
  });

  test("file route (Bun.file value) streams over H3", async () => {
    await withServer(async port => {
      const res = await fetchH3(port, "/file-route");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/octet-stream");
      expect(res.headers.get("content-length")).toBe("204800");
      const raw = await res.bytes();
      expect(raw.length).toBe(200 * 1024);
      expect(md5(raw)).toBe(md5(BIG_FILE_BYTES));
      // Range request over H3 hits the same FileResponseStream path
      const ranged = await fetchH3(port, "/file-route", { headers: { range: "bytes=4-11" } });
      expect(ranged.status).toBe(206);
      expect(ranged.headers.get("content-range")).toBe("bytes 4-11/204800");
      expect(ranged.headers.get("content-length")).toBe("8");
      expect(await ranged.text()).toBe("file" + "FILE");
    });
  });

  test("validation: http1:false without http3 throws", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "Bun.serve({ port: 0, http1: false, fetch: () => new Response('x') })"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr.toLowerCase()).toContain("http1");
    expect(exitCode).not.toBe(0);
  });

  test("validation: http3 with unix socket warns and skips H3 listener", async () => {
    using dir = tempDir("serve-http3-unix", {});
    const sock = join(String(dir), "h3.sock");
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `using s = Bun.serve({ unix: ${JSON.stringify(sock)}, tls: ${JSON.stringify(tls)}, http3: true, fetch: () => new Response("x") }); console.log("listening");`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("http3: true with a unix socket — HTTP/3 listener skipped");
    expect(stderr).not.toContain("h3: true");
    expect(stdout).toContain("listening");
    expect(exitCode).toBe(0);
  });

  // A killed process never flushes at exit, so the warning must be on the pipe before SIGKILL.
  test("validation: the unix socket warning reaches stderr while the server runs", async () => {
    using dir = tempDir("serve-http3-unix-warn", {});
    const sock = join(String(dir), "h3.sock");
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `Bun.serve({ unix: ${JSON.stringify(sock)}, tls: ${JSON.stringify(tls)}, http3: true, fetch: () => new Response("x") }); console.log("listening");`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    // console.log flushes at once, so "listening" means the warning was already written on the same thread.
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let stdout = "";
    while (!stdout.includes("listening")) {
      const { value, done } = await reader.read();
      if (done) break;
      stdout += decoder.decode(value, { stream: true });
    }
    reader.releaseLock();
    expect(stdout).toBe("listening\n");

    proc.kill("SIGKILL");
    const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("http3: true with a unix socket — HTTP/3 listener skipped");
  });

  test("validation: the unix socket warning reaches stderr from a Worker", async () => {
    using dir = tempDir("serve-http3-unix-worker", {
      "worker.ts": `
        using s = Bun.serve({ unix: process.env.H3_SOCK, tls: ${JSON.stringify(tls)}, http3: true, fetch: () => new Response("x") });
      `,
    });
    const sock = join(String(dir), "h3.sock");
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `new Worker("./worker.ts").addEventListener("close", e => console.log("worker close", e.code));`,
      ],
      env: { ...bunEnv, H3_SOCK: sock },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("worker close 0\n");
    expect(stderr).toContain("http3: true with a unix socket — HTTP/3 listener skipped");
    expect(exitCode).toBe(0);
  });

  test("closes the TCP listener when the UDP port is taken", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          // Retried in case the kernel-chosen UDP port is busy on TCP too.
          for (let attempt = 0; ; attempt++) {
            const udp = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0 });
            const { port } = udp;
            let error;
            try {
              Bun.serve({ port, hostname: "127.0.0.1", tls: ${JSON.stringify(tls)}, http3: true, fetch: () => new Response("x") });
            } catch (e) {
              error = e;
            }
            if (error?.code === "EADDRINUSE" && attempt < 5) {
              udp.close();
              continue;
            }
            using tcp = Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Response("rebound") });
            const body = await (await fetch("http://127.0.0.1:" + port + "/")).text();
            console.log(String(error?.message).replace(port, "PORT"), "|", body);
            udp.close();
            break;
          }
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "Failed to listen on UDP port PORT for HTTP/3 | rebound\n",
      stderr: "",
      exitCode: 0,
    });
  });
});

// Cases ported from h2o t/40http3 and aioquic interop. Not concurrent: several
// of them flood the pooled QUIC connection on purpose (64 streams, an 8 MB body).
describe("Bun.serve HTTP/3 adversarial", () => {
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
      // (i * 131) & 0xff has period 256, so tile one 256-byte block instead of
      // an 8M-iteration per-byte JS loop (slow under ASAN/debug JSC).
      const block = Buffer.alloc(256);
      for (let i = 0; i < block.length; i++) block[i] = (i * 131) & 0xff;
      const payload = Buffer.alloc(8 * 1024 * 1024, block);
      const res = await fetchH3(port, "/echo-bytes", {
        method: "POST",
        body: payload,
        headers: { "content-type": "application/octet-stream" },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("x-len")).toBe(String(8 * 1024 * 1024));
      const raw = await res.bytes();
      expect(raw.length).toBe(payload.length);
      expect(md5(raw)).toBe(md5(payload));
    });
  });

  test("slow client read drains streamed response", async () => {
    await withServer(async port => {
      // Body is tiny ("one two three"); the point is the server sees
      // backpressure from the QUIC flow-control window and the
      // HTTPSResponseSink onWritable path completes instead of hanging.
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
      expect(res.headers.get("content-type")).toBe("application/octet-stream");
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
      expect(res.status).toBe(200);
      expect(res.headers.get("x-proto")).toBe("h3");
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
      expect(res.status).toBe(200);
      expect(res.headers.get("x-proto")).toBe("h3");
      expect(await res.text()).toBe("hello over h3");
    });
  });

  // The big one: every concurrent stream gets back exactly its own bytes,
  // transformed. Catches shared-buffer reuse in quic.c read_buf, response
  // backpressure aliasing in Http3ResponseData, and partial-write offset
  // bugs in HTTPSResponseSink. Bodies are crypto-random so any cross-stream
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
      const res = await fetchH3(port, "/spawn");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/plain");
      const raw = await res.bytes();
      expect(raw.length).toBe(40 * 1001);
      const line = Buffer.alloc(1000, "x").toString() + "\n";
      expect(Buffer.from(raw).toString()).toBe(Buffer.alloc(40 * 1001, line).toString());
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

  test("Response(Bun.file().stream()) goes through HTTPSResponseSink", async () => {
    await withServer(async port => {
      const res = await fetchH3(port, "/file-stream");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-length")).toBe("204800");
      const raw = await res.bytes();
      expect(raw.length).toBe(200 * 1024);
      expect(md5(raw)).toBe(md5(BIG_FILE_BYTES));
    });
  });

  // bughunt #4: canSendfile() must not pick the sendfile() path for H3 — it
  // has no socket fd. A 2 MB file is over the 1 MiB sendfile threshold.
  test("Bun.file >=1 MiB takes the reader path, not sendfile", async () => {
    await withServer(async port => {
      const res = await fetchH3(port, "/huge-file");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-length")).toBe("2097152");
      const raw = await res.bytes();
      expect(raw.length).toBe(2 * 1024 * 1024);
      expect(md5(raw)).toBe(md5(HUGE_FILE_BYTES));
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
  args: string[] = [],
) {
  using dir = tempDir("serve-http3-custom", { "server.mjs": script });
  const proc = Bun.spawn({
    cmd: [bunExe(), ...args, "server.mjs"],
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
  } catch (e) {
    // Give the script a chance to server.stop(true) (CONNECTION_CLOSE) on
    // stdin end before SIGKILL, so the client's pooled session is released
    // and can't collide with a later test that reuses the same port.
    proc.stdin.end();
    await Promise.race([proc.exited, Bun.sleep(1000)]);
    proc.kill();
    await proc.exited;
    await drain.catch(() => {});
    throw e;
  }
  // Every script exits on stdin end, or already exited on a command.
  proc.stdin.end();
  const exitCode = await proc.exited;
  await drain;
  expect(exitCode, `fixture exited with ${exitCode}; stderr:\n${buf}`).toBe(0);
}

describe.concurrent("Bun.serve HTTP/3 lifecycle", () => {
  // bughunt #2: server.reload() must clear the H3 router so removed routes
  // fall through to the fetch handler instead of dereferencing freed pointers.
  test("server.reload() clears stale H3 routes", async () => {
    const script = `
      const tls = ${JSON.stringify(tls)};
      let server = Bun.serve({
        port: 0, tls, http3: true,
        routes: { "/old": new Response("old-route") },
        fetch: () => new Response("fallback", { status: 404 }),
      });
      console.error("PORT=" + server.port);
      ${STDIN_HELPERS}
      stopOnStdinEnd(line => {
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

  // server.stop(true) must send CONNECTION_CLOSE on every live H3 connection
  // before the UDP fd is closed. Without it the client keeps the pooled
  // session until the negotiated idle timeout, and if another listener later
  // binds the same port, a fetch with a ReadableStream body (which can't
  // retry) is placed on the dead session and fails with HTTP3StreamReset
  // once the idle alarm fires. This is the root cause of the intermittent
  // `POST body without Content-Length` failure across the adversarial suite.
  //
  // lsquic's ietf_full_conn_ci_close path only packs CONNECTION_CLOSE for a
  // server conn if there are already-scheduled packets or IFC_GOAWAY_CLOSE;
  // an idle conn satisfies neither, so abrupt stop used lsquic_conn_abort.
  test("server.stop(true) sends CONNECTION_CLOSE on an idle H3 connection", async () => {
    const script = `
      const tls = ${JSON.stringify(tls)};
      let server;
      const start = port => {
        server = Bun.serve({
          port, tls, http3: true,
          async fetch(req) {
            const body = await req.arrayBuffer();
            return new Response(body, { headers: { "x-len": String(body.byteLength) } });
          },
        });
        console.error("PORT=" + server.port);
      };
      start(0);
      ${STDIN_HELPERS}
      stopOnStdinEnd(async line => {
        if (line.includes("stop")) {
          // Let the delayed-ACK timer fire so send_ctl has nothing scheduled
          // when listen_socket_close runs; that's the state in which the old
          // lsquic_conn_close() path went silent.
          await Bun.sleep(100);
          const port = server.port;
          server.stop(true);
          start(port);
          console.error("RESTARTED");
        }
      });
    `;
    await withCustomServer(script, async (port, send, waitForStderr) => {
      // Warm the pooled client session.
      expect((await fetchH3(port, "/").then(r => r.headers.get("x-len"))) ?? "").toBe("0");
      send("stop");
      // waitForStderr matches against the accumulated buffer, so a second
      // /PORT=/ wait would resolve on the startup line; RESTARTED is emitted
      // only after the new listener is bound.
      await waitForStderr(/RESTARTED/);
      // Same process now listens again on the same port. A fresh handshake
      // should complete because the client dropped the old session on
      // CONNECTION_CLOSE; if it reused the dead one the POST below stalls
      // until idle-timeout and then rejects with HTTP3StreamReset.
      const body = Buffer.alloc(40_000, "noCL");
      const res = await fetchH3(port, "/", {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: new ReadableStream({
          start(c) {
            c.enqueue(body);
            c.close();
          },
        }),
        // Fail fast instead of waiting out the ~10s idle alarm; the debug
        // lane's handshake is well under this on a fresh session.
        signal: AbortSignal.timeout(2000),
      });
      expect(res.headers.get("x-len")).toBe(String(body.length));
      expect((await res.bytes()).length).toBe(body.length);
    });
  });

  // server.stop(true) from the request handler, or from a microtask the handler
  // resolved, runs while lsquic's process_conns is on the stack. The aborted
  // connection only packs its CONNECTION_CLOSE when that tick resumes, so the
  // UDP fd has to stay open until process_conns returns. It used to close at
  // once: the peer got no close signal and only noticed through its idle timer.
  // The client never retries a ReadableStream request body, so the rejection
  // surfaces as soon as the client sees the connection close.
  test.each([
    ["synchronously", ""],
    ["after an await", "await null;"],
  ])("server.stop(true) %s inside an H3 handler sends CONNECTION_CLOSE", async (_where, beforeStop) => {
    const script = `
      const tls = ${JSON.stringify(tls)};
      const server = Bun.serve({
        port: 0, tls, http3: true,
        async fetch(req) {
          if (new URL(req.url).pathname === "/stop") {
            ${beforeStop}
            server.stop(true);
            console.error("STOPPED");
            await new Promise(() => {});
          }
          return new Response("ok");
        },
      });
      console.error("PORT=" + server.port);
      ${STDIN_HELPERS}
      readStdin().then(() => process.exit(0));
    `;
    await withCustomServer(script, async (port, send, waitForStderr) => {
      expect(await fetchH3(port, "/").then(r => r.text())).toBe("ok");
      // Handled from the start: the close can reach the client before "STOPPED" is read from the pipe.
      const outcome = fetchH3(port, "/stop", {
        method: "POST",
        body: new ReadableStream({
          start(c) {
            c.enqueue("payload");
            c.close();
          },
        }),
      }).then(
        r => r.text(),
        e => e.code,
      );
      await waitForStderr(/STOPPED/);
      expect(await outcome).toBe("HTTP3StreamReset");
    });
  });

  // The fd of a listener stopped from inside a handler stays open until
  // process_conns returns, but stop(true) promises that the port is free when
  // it returns: a new listener on the same port must still bind in that turn.
  test("server.stop(true) then Bun.serve on the same port inside an H3 handler binds", async () => {
    // The client runs in the same subprocess: the rebind releases the old fd
    // before its CONNECTION_CLOSE goes out, so the client's session to this
    // port stays dead in its pool and must not outlive the test.
    const script = `
      const tls = ${JSON.stringify(tls)};
      const rebound = Promise.withResolvers();
      let server = Bun.serve({
        port: 0, hostname: "127.0.0.1", tls, http3: true, http1: false,
        async fetch(req) {
          const port = server.port;
          server.stop(true);
          try {
            server = Bun.serve({ port, hostname: "127.0.0.1", tls, http3: true, http1: false, fetch: () => new Response("second") });
            rebound.resolve("rebound on the same port: " + (server.port === port));
          } catch (e) {
            rebound.resolve(String(e));
          }
          await new Promise(() => {});
        },
      });
      fetch("https://127.0.0.1:" + server.port + "/", {
        protocol: "http3", tls: { rejectUnauthorized: false },
      }).catch(() => {});
      await Bun.write(Bun.stdout, await rebound.promise);
      process.exit(0);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: "rebound on the same port: true", stderr: "" });
    expect(exitCode).toBe(0);
  });

  // A bind to another port leaves the pending fd alone, so the stopped server
  // still sends its CONNECTION_CLOSE.
  test("server.stop(true) then Bun.serve on another port inside an H3 handler sends CONNECTION_CLOSE", async () => {
    const script = `
      const tls = ${JSON.stringify(tls)};
      let other;
      const server = Bun.serve({
        port: 0, hostname: "127.0.0.1", tls, http3: true, http1: false,
        async fetch(req) {
          server.stop(true);
          other = Bun.serve({ port: 0, hostname: "127.0.0.1", tls, http3: true, http1: false, fetch: () => new Response("other") });
          await new Promise(() => {});
        },
      });
      const outcome = await fetch("https://127.0.0.1:" + server.port + "/", {
        protocol: "http3", tls: { rejectUnauthorized: false },
        method: "POST",
        body: new ReadableStream({ start(c) { c.enqueue("payload"); c.close(); } }),
      }).then(r => r.text(), e => e.code);
      other.stop(true);
      await Bun.write(Bun.stdout, outcome);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: "HTTP3StreamReset", stderr: "" });
    expect(exitCode).toBe(0);
  });

  // `using server` disposes with stop(true). Here the scope ends in a
  // continuation of a promise that the handler resolved, so the disposal runs
  // inside process_conns like the stop(true) calls above.
  test("a `using` server disposed after a handler-resolved await sends CONNECTION_CLOSE", async () => {
    const script = `
      const tls = ${JSON.stringify(tls)};
      const received = Promise.withResolvers();
      async function run() {
        using server = Bun.serve({
          port: 0, hostname: "127.0.0.1", tls, http3: true, http1: false,
          async fetch(req) {
            received.resolve();
            await new Promise(() => {});
          },
        });
        const outcome = fetch("https://127.0.0.1:" + server.port + "/", {
          protocol: "http3", tls: { rejectUnauthorized: false },
          method: "POST",
          body: new ReadableStream({ start(c) { c.enqueue("payload"); c.close(); } }),
        }).then(r => r.text(), e => e.code);
        await received.promise;
        return { outcome };
      }
      await Bun.write(Bun.stdout, await (await run()).outcome);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: "HTTP3StreamReset", stderr: "" });
    expect(exitCode).toBe(0);
  });

  // A graceful server.stop() from the same place must not enter the engine
  // either. The GOAWAY goes out after process_conns returns and the request
  // that is in the handler still completes. `warm` runs one request first, so
  // the connection that carries the in-flight request is not a new one.
  test.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])("server.stop() inside an H3 handler drains the in-flight request (http1: %p, warm: %p)", async (http1, warm) => {
    const script = `
        const tls = ${JSON.stringify(tls)};
        const inHandler = Promise.withResolvers();
        const proceed = Promise.withResolvers();
        const server = Bun.serve({
          port: 0, hostname: "127.0.0.1", tls, http3: true, http1: ${http1},
          async fetch(req) {
            if (new URL(req.url).pathname === "/warm") return new Response("warm");
            inHandler.resolve();
            await proceed.promise;
            return new Response("late");
          },
        });
        const h3 = { protocol: "http3", tls: { rejectUnauthorized: false } };
        const origin = "https://127.0.0.1:" + server.port;
        if (${warm}) await fetch(origin + "/warm", h3).then(r => r.text());
        const response = fetch(origin + "/", h3).then(r => r.text());
        await inHandler.promise;
        server.stop();
        proceed.resolve();
        await Bun.write(Bun.stdout, "got:" + await response);
      `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: "got:late", stderr: "" });
    expect(exitCode).toBe(0);
  });

  // GOAWAY rejects new requests only (RFC 9114 section 5.2). The peer can still
  // open its control and QPACK streams, and an lsquic client opens its QPACK
  // encoder stream when the server's SETTINGS arrive. On a new connection that
  // is after the GOAWAY of a stop() in the first handler. lsquic answered that
  // stream with STOP_SENDING, which a client has to treat as
  // H3_CLOSED_CRITICAL_STREAM: it closed the connection, and the request that
  // stop() was draining died with it.
  //
  // The node:quic client shares this thread with the server, so the order is
  // exact. The request is queued before the handshake completes and leaves with
  // the client's Finished: the handler runs before the client has the SETTINGS.
  // The client ends the request body once it has the GOAWAY, so the handler
  // answers only after the server has read the QPACK encoder stream.
  //
  // The handler also makes the client send a second request. The client has not
  // read the GOAWAY yet, and the server reads that request after the GOAWAY
  // left: it still has to reject it.
  test("server.stop() in the first handler of a new H3 connection rejects new requests but not the client's QPACK encoder stream", async () => {
    let handled = 0;
    const afterStop = Promise.withResolvers<string>();
    await using server = Bun.serve({
      port: 0,
      tls,
      http3: true,
      http1: false,
      async fetch(req) {
        if (++handled === 1) {
          server.stop();
          afterStop.resolve(requestAfterStop());
        }
        return new Response("late:" + (await req.text()));
      },
    });

    await using endpoint = new QuicEndpoint();
    const goaway = Promise.withResolvers<void>();
    const client = await connect(`127.0.0.1:${server.port}`, {
      endpoint,
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 5 },
      onerror() {},
      ongoaway: () => goaway.resolve(),
    } as SessionOptions);
    const closed = client.closed.then(
      () => "closed",
      (err: Error) => `closed: ${err.message}`,
    );

    async function requestAfterStop() {
      let status = "";
      const stream = await client.createBidirectionalStream({
        headers: requestHeaders("/after-stop"),
        onheaders(received) {
          status = received[":status"] as string;
        },
      });
      stream.closed.catch(() => {});
      for await (const _ of stream as AsyncIterable<Uint8Array[]>) {
      }
      return status || "no response";
    }

    let status = "";
    const stream = await client.createBidirectionalStream({
      onheaders(received) {
        status = received[":status"] as string;
      },
    });
    stream.closed.catch(() => {});
    const writer = stream.writer;
    stream.sendHeaders({ ...requestHeaders("/"), ":method": "POST" });
    const outcome = (async () => {
      let body = "";
      for await (const batch of stream as AsyncIterable<Uint8Array[]>) {
        for (const chunk of batch) body += Buffer.from(chunk).toString("latin1");
      }
      // Without a response the session is gone: report why.
      return status ? `${status} ${body}` : await closed;
    })();

    await Promise.race([goaway.promise, outcome]);
    writer.writeSync(new TextEncoder().encode("body"));
    writer.endSync();

    expect({ inHandler: await outcome, afterStop: await afterStop.promise, handled }).toEqual({
      inHandler: "200 late:body",
      afterStop: "no response",
      handled: 1,
    });
    if (!client.destroyed) client.close().catch(() => {});
  });

  // bughunt #3: server.stop() must not leave the lsquic engine pointing at a
  // freed listen-socket. The follow-up GET should cleanly fail to connect,
  // and the process must still be alive to exit 0 on its own.
  test.serial("server.stop() with live H3 connections does not UAF", async () => {
    const script = `
      const tls = ${JSON.stringify(tls)};
      const server = Bun.serve({
        port: 0, tls, http3: true,
        fetch: () => new Response("alive"),
      });
      console.error("PORT=" + server.port);
      ${STDIN_HELPERS}
      readStdin(async line => {
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
      await expect(fetchH3(port, "/", { signal: AbortSignal.timeout(DEAD_PORT_ABORT_MS) })).rejects.toThrow();
    });
  });

  // end_stream()/end()/end_without_body()/force_close() captured a local
  // copy of `resp`, cleared onAborted via detach_response(), then called
  // end_request_streaming_and_drain() (whose drain_microtasks() can re-enter
  // lsquic via drain_quic_if_necessary and free the H3 stream when a client
  // RESET is queued) before the final resp.state() read.
  // Only detectable under ASAN; release builds corrupt memory silently.
  test.skipIf(!isASAN)(
    "client abort during streaming response + pending request body does not UAF",
    async () => {
      const script = `
      const tls = ${JSON.stringify(tls)};
      const server = Bun.serve({
        port: 0, tls, http3: true, http1: false,
        fetch(req) {
          // Do NOT consume req.body: for H3 body-bearing methods the
          // RequestContext's request_body stays Locked until FIN, and the
          // client aborts before sending FIN. That Locked body is what makes
          // end_request_streaming_and_drain() actually drain microtasks.
          return new Response(
            new ReadableStream({
              type: "direct",
              async pull(ctrl) {
                ctrl.write("a");
                ctrl.flush?.();
                // Yield to a macro-task so the sink's resolve microtask runs
                // with ctx->processing == 0 (outside lsquic), letting the
                // drain_quic_if_necessary() re-entry reach process_conns.
                await new Promise(r => setTimeout(r, 1));
                ctrl.write("b");
                ctrl.flush?.();
                await new Promise(r => setTimeout(r, 1));
                ctrl.write("c");
                await ctrl.end();
              },
            }),
            { headers: { "content-type": "text/plain" } },
          );
        },
      });
      const base = "https://127.0.0.1:" + server.port;
      async function once(i) {
        const ctrl = new AbortController();
        let bodyCtrl;
        const body = new ReadableStream({
          start(c) { c.enqueue(new TextEncoder().encode("req")); bodyCtrl = c; },
        });
        try {
          const res = await fetch(base + "/", {
            method: "POST", body, duplex: "half",
            protocol: "http3", tls: { rejectUnauthorized: false },
            signal: ctrl.signal,
            headers: { "content-type": "application/octet-stream" },
          });
          // Read one chunk so the server is definitely mid-stream, then
          // abort. The client's RESET lands while the server's next
          // setTimeout tick is queued in the same epoll iteration.
          const rdr = res.body.getReader();
          await rdr.read().catch(() => {});
          if (i & 1) await new Promise(r => setTimeout(r, 0));
          ctrl.abort();
          await rdr.read().catch(() => {});
          try { rdr.releaseLock(); } catch {}
        } catch {}
        try { bodyCtrl?.error(new Error("done")); } catch {}
      }
      const ITERS = 200, CONC = 16;
      for (let b = 0; b * CONC < ITERS; b++) {
        await Promise.all(Array.from({ length: CONC }, (_, k) => once(b * CONC + k)));
      }
      // Proof of life: one clean request after the abort storm.
      const res = await fetch(base + "/", {
        method: "POST", body: "done",
        protocol: "http3", tls: { rejectUnauthorized: false },
      });
      const txt = await res.text();
      console.log(JSON.stringify({ status: res.status, body: txt }));
      server.stop(true);
      process.exit(0);
    `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // Surface the ASAN report when it fires so the failing test is diagnosable.
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: JSON.stringify({ status: 200, body: "abc" }) + "\n",
        stderr: "",
        exitCode: 0,
      });
    },
    30_000,
  );

  // B: server.stop() (graceful) sends GOAWAY and lets in-flight H3 requests
  // finish before the engine tears down. lsquic_engine_cooldown drops mini
  // (still-handshaking) conns immediately, so we wait until the server has
  // actually entered every handler before stopping — no arbitrary sleep.
  test.serial("graceful stop: in-flight H3 requests complete after server.stop()", async () => {
    const script = `
      const tls = ${JSON.stringify(tls)};
      let stopping = false, inflight = 0;
      const server = Bun.serve({
        port: 0, tls, http3: true, idleTimeout: 30,
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
      ${STDIN_HELPERS}
      readStdin(line => {
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
      await expect(fetchH3(port, "/", { signal: AbortSignal.timeout(DEAD_PORT_ABORT_MS) })).rejects.toThrow();
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
          port: 0, tls: ${JSON.stringify(tls)}, http3: true, http1: false,
          fetch: () => new Response("ok"),
        });
        console.error("PORT=" + server.port);
        ${STDIN_HELPERS}
        readStdin(() => server.stop());
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

  test("server.stop(true) after server.stop() closes the H3 connections that are still draining", async () => {
    using dir = tempDir("serve-http3-stop-twice", {
      "server.mjs": `
        const server = Bun.serve({
          port: 0, tls: ${JSON.stringify(tls)}, http3: true, http1: false,
          fetch() {
            console.error("HELD");
            return new Promise(() => {});
          },
        });
        console.error("PORT=" + server.port);
        ${STDIN_HELPERS}
        readStdin(() => {
          server.stop();
          server.stop(true);
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "server.mjs"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdin: "pipe",
    });
    let buf = "";
    const r = proc.stderr.getReader();
    const waitFor = async (text: string) => {
      while (!buf.includes(text)) {
        const { value, done } = await r.read();
        if (done) break;
        buf += new TextDecoder().decode(value);
      }
    };
    await waitFor("PORT=");
    const port = Number(buf.match(/PORT=(\d+)/)![1]);
    const held = fetchH3(port, "/", { method: "POST", body: "held" }).then(
      res => res.status,
      err => err.code,
    );
    await waitFor("HELD");
    r.releaseLock();
    proc.stdin!.write("stop\n");
    proc.stdin!.end();
    expect(await held).toBe("HTTP3StreamReset");
    // No process.exit() in the script: the connection no longer holds the loop.
    expect(await proc.exited).toBe(0);
  });

  // The HEADERS of the first response on a connection wait for the QPACK encoder
  // stream, and lsquic takes no DATA until they are out. A small streamed body is
  // therefore written, and the response ended, from the stream's writable
  // callback. The same tick closes the finished stream, before the promise
  // reaction of the body stream can run: the close has to end the request.
  // Each case has its own server, so its request is the first on a connection.
  describe("a streamed response body ends its request when the stream closes", () => {
    const bodies: Record<string, () => Bun.BodyInit> = {
      "ReadableStream": () =>
        new ReadableStream({
          async pull(controller) {
            controller.enqueue(new TextEncoder().encode("streamed"));
            controller.close();
          },
        }),
      "direct ReadableStream": () =>
        new ReadableStream({
          type: "direct",
          async pull(controller) {
            controller.write("streamed");
            await controller.end();
          },
        }),
      "async generator": () =>
        (async function* () {
          yield "streamed";
        })(),
    };

    const requests: Record<string, RequestInit> = {
      "GET": {},
      "POST with a request body the handler never reads": { method: "POST", body: "request-content" },
    };

    describe.each(Object.keys(bodies))("%s", kind => {
      test.each(Object.keys(requests))("%s", async request => {
        await using server = Bun.serve({
          port: 0,
          tls,
          http3: true,
          http1: false,
          fetch: () => new Response(bodies[kind]()),
        });

        const text = await fetchH3(server.port!, "/", requests[request]).then(res => res.text());
        expect({ text, pendingRequests: server.pendingRequests }).toEqual({ text: "streamed", pendingRequests: 0 });
        // A request that never ends keeps a graceful stop pending.
        await server.stop();
      });
    });

    // The request hears the controller close, so it does not wait for a
    // pull() that never settles. The end comes from a later microtask: an end
    // inside the first pull() leaves the response already finished when the
    // stream is attached, which takes a different path.
    test("a direct stream whose pull() never settles after it ended the response", async () => {
      await using server = Bun.serve({
        port: 0,
        tls,
        http3: true,
        http1: false,
        fetch: () =>
          new Response(
            new ReadableStream({
              type: "direct",
              async pull(controller) {
                controller.write("streamed");
                await Promise.resolve();
                controller.end();
                await new Promise<never>(() => {});
              },
            }),
          ),
      });

      const text = await fetchH3(server.port!, "/").then(res => res.text());
      expect({ text, pendingRequests: server.pendingRequests }).toEqual({ text: "streamed", pendingRequests: 0 });
      await server.stop();
    });
  });

  // C: req.signal fires when the client resets the H3 stream mid-request.
  test("req.signal aborts on client RST", async () => {
    const script = `
      const tls = ${JSON.stringify(tls)};
      let aborted = 0;
      const server = Bun.serve({
        port: 0, tls, http3: true,
        async fetch(req) {
          const url = new URL(req.url);
          if (url.pathname === "/hang") {
            req.signal.addEventListener("abort", () => { aborted++; console.error("ABORTED"); });
            console.error("HANGING");
            await new Promise(r => req.signal.addEventListener("abort", r));
            return new Response("never");
          }
          if (url.pathname === "/aborted") return new Response(String(aborted));
          return new Response("ok");
        },
      });
      console.error("PORT=" + server.port);
      ${STOP_ON_STDIN_END}
    `;
    await withCustomServer(script, async (port, _send, waitForStderr) => {
      const ac = new AbortController();
      const p = fetchH3(port, "/hang", { signal: ac.signal });
      // Once the handler runs, the /hang stream is bound (qstream != null), so
      // abort() sends STOP_SENDING. Before that it's a no-op.
      await waitForStderr(/HANGING/);
      ac.abort();
      await expect(p).rejects.toMatchObject({ name: "AbortError" });
      // The signal fires from on_stream_close, which runs on the next
      // process_conns tick after the RST lands.
      await waitForStderr(/ABORTED/);
      expect(await fetchH3(port, "/aborted").then(r => r.text())).toBe("1");
    });
  });
});

describe.concurrent("Bun.serve HTTP/3 production", () => {
  // RFC 9110 §6.6.1: an origin server with a clock MUST send Date.
  // H1 writes it via HttpResponse::writeMark(); H3 must too.
  test("Date header is sent on every response shape", async () => {
    await withServer(async port => {
      // Cover every Http3Response header-send path: internalEnd (string/buffer
      // body, 404, static route), flushHeaders (ReadableStream, Bun.file,
      // file route), endWithoutBody (204, HEAD).
      const cases: Array<{ path: string; method?: string }> = [
        { path: "/hello" },
        { path: "/big" },
        { path: "/status" },
        { path: "/nope" },
        { path: "/stream" },
        { path: "/file" },
        { path: "/static" },
        { path: "/file-route" },
        { path: "/big", method: "HEAD" },
      ];
      const httpDate = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;
      const results: Array<{ req: string; date: string | null }> = [];
      for (const c of cases) {
        const res = await fetchH3(port, c.path, c.method ? { method: c.method } : {});
        await res.arrayBuffer();
        results.push({ req: `${c.method ?? "GET"} ${c.path}`, date: res.headers.get("date") });
      }
      expect(results).toEqual(
        cases.map(c => ({
          req: `${c.method ?? "GET"} ${c.path}`,
          date: expect.stringMatching(httpDate),
        })),
      );
    });
  });

  // E: H1 responses advertise the H3 endpoint so browsers can discover it.
  test("Alt-Svc emitted on HTTP/1.1 responses when http3 is enabled", async () => {
    await withServer(async port => {
      // The fetch()/static-route/file-route response paths each write
      // headers from a different place; all three must advertise h3.
      for (const path of ["/hello", "/static", "/file-route"]) {
        const res = await fetch(`https://127.0.0.1:${port}${path}`, { tls: { rejectUnauthorized: false } });
        await res.arrayBuffer();
        expect(res.status).toBe(200);
        expect(res.headers.get("alt-svc")).toBe(`h3=":${port}"; ma=86400`);
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
        port: 0, tls, http3: true,
        websocket: { message() {} },
        fetch(req, srv) {
          const ok = srv.upgrade(req);
          return new Response("upgrade=" + ok);
        },
      });
      console.error("PORT=" + server.port);
      ${STOP_ON_STDIN_END}
    `;
    await withCustomServer(script, async port => {
      const res = await fetchH3(port, "/");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("upgrade=false");
    });
  });

  // Expect: 100-continue is handled at the uWS layer for both transports
  // (HttpContext.h / Http3Context.h call writeContinue before routing); a
  // curl --expect100-timeout assertion was flaky enough to drop here.
});

async function h3Exchange(
  port: number,
  headers: Record<string, string>,
  options: Record<string, unknown> = {},
): Promise<string> {
  await using endpoint = new QuicEndpoint();
  const client = await connect(`127.0.0.1:${port}`, {
    endpoint,
    servername: "localhost",
    verifyPeer: "manual",
    transportParams: { maxIdleTimeout: 5 },
    onerror() {},
    ...options,
  } as SessionOptions);
  const outcome = Promise.withResolvers<string>();
  client.closed.then(
    () => outcome.resolve("closed"),
    (err: Error & { code?: string; errorCode?: bigint }) =>
      outcome.resolve(err?.code === "ERR_QUIC_APPLICATION_ERROR" ? `closed ${err.code} ${err.errorCode}` : "closed"),
  );
  client.opened
    .then(async () => {
      let status = "";
      const stream = await client.createBidirectionalStream({
        headers,
        onheaders(received) {
          status = received[":status"] as string;
        },
      });
      stream.closed.catch(() => {});
      let body = "";
      for await (const batch of stream as AsyncIterable<Uint8Array[]>) {
        for (const chunk of batch) body += Buffer.from(chunk).toString("latin1");
      }
      if (status) outcome.resolve(`${status} ${body}`);
    })
    .catch(() => {});
  const result = await outcome.promise;
  if (!client.destroyed) client.close().catch(() => {});
  return result;
}

const requestHeaders = (path: string, extra: Record<string, string> = {}) => ({
  ":method": "GET",
  ":path": path,
  ":scheme": "https",
  ":authority": "localhost",
  ...extra,
});

describe("Bun.serve HTTP/3 request validation", () => {
  test("rejects a request whose field value contains CR or LF before the fetch handler runs", async () => {
    let reachedWithProbe = 0;
    await using server = Bun.serve({
      port: 0,
      tls,
      http3: true,
      fetch(req) {
        if (req.headers.has("x-probe")) reachedWithProbe++;
        return new Response(String(reachedWithProbe));
      },
    });

    const results: Record<string, string> = {};
    for (const value of ["a\r\nb: c", "a\nb", "a\rb"]) {
      results[JSON.stringify(value)] = await h3Exchange(server.port!, requestHeaders("/", { "x-probe": value }));
    }
    results.wellFormed = await h3Exchange(server.port!, requestHeaders("/", { "x-probe": "plain" }));
    results.after = await h3Exchange(server.port!, requestHeaders("/"));

    expect(results).toEqual({
      [JSON.stringify("a\r\nb: c")]: "400 ",
      [JSON.stringify("a\nb")]: "400 ",
      [JSON.stringify("a\rb")]: "400 ",
      wellFormed: "200 1",
      after: "200 1",
    });
  });

  // QPACK delivers a field value as a length-prefixed string, so SP / HTAB at
  // the ends arrive as part of the value. RFC 9110 section 5.5: a field value
  // has no leading or trailing whitespace, and the HTTP/1 listener strips it.
  test("strips leading and trailing whitespace from a field value, like the HTTP/1 listener", async () => {
    await using server = Bun.serve({
      port: 0,
      tls,
      http3: true,
      fetch(req) {
        return Response.json({
          "x-ws": req.headers.get("x-ws"),
          "x-only-ws": req.headers.get("x-only-ws"),
          "x-inner": req.headers.get("x-inner"),
          host: req.headers.get("host"),
          url: req.url,
        });
      },
    });

    const fields = {
      "x-ws": " \tv\t ",
      "x-only-ws": " \t ",
      "x-inner": "a \t b",
    };
    const expected = {
      "x-ws": "v",
      "x-only-ws": "",
      "x-inner": "a \t b",
      host: "localhost",
      url: "https://localhost/",
    };
    const results = {
      authority: await h3Exchange(server.port!, { ...requestHeaders("/", fields), ":authority": " \tlocalhost \t" }),
      literalHost: await h3Exchange(server.port!, {
        ":method": "GET",
        ":path": "/",
        ":scheme": "https",
        host: " \tlocalhost \t",
        ...fields,
      }),
    };

    expect(results).toEqual({
      authority: "200 " + JSON.stringify(expected),
      literalHost: "200 " + JSON.stringify(expected),
    });
  });

  test("enforces the header size limit it advertises, counted as in RFC 9114 section 4.2.2", async () => {
    await using server = Bun.serve({
      port: 0,
      tls,
      http3: true,
      fetch(req) {
        return Response.json(Object.fromEntries(req.headers));
      },
    });

    const limit = 16 * 1024;
    const sizeOf = (headers: Record<string, string>) =>
      Object.entries(headers).reduce((size, [name, value]) => size + name.length + value.length + 32, 0);
    const fieldsOfSize = (size: number) => {
      const fields: Record<string, string> = {};
      for (let i = 0; i < 100; i++) fields[`x-field-${i}`] = "";
      const spare = size - sizeOf(requestHeaders("/", fields));
      for (const name in fields) fields[name] = Buffer.alloc(Math.floor(spare / 100), "v").toString();
      fields["x-field-0"] += Buffer.alloc(spare % 100, "v").toString();
      return fields;
    };
    const exchange = (size: number) => h3Exchange(server.port!, requestHeaders("/", fieldsOfSize(size)));

    const atTheLimit = await exchange(limit);
    expect(JSON.parse(atTheLimit.slice("200 ".length))).toEqual({ host: "localhost", ...fieldsOfSize(limit) });
    expect({
      atTheLimit: atTheLimit.slice(0, 3),
      overTheLimit: await exchange(limit + 1),
      farOverTheLimit: await exchange(limit * 3),
      after: await h3Exchange(server.port!, requestHeaders("/")),
    }).toEqual({
      atTheLimit: "200",
      overTheLimit: "431 ",
      farOverTheLimit: "closed ERR_QUIC_APPLICATION_ERROR 270",
      after: "200 " + JSON.stringify({ host: "localhost" }),
    });
  });

  test("serves the next request of a connection after it answered 431", async () => {
    await withServer(async port => {
      const tooLarge = await fetchH3(port, "/hello", {
        headers: { "x-large": Buffer.alloc(20 * 1024, "v").toString() },
      });
      expect(tooLarge.status).toBe(431);
      expect(await tooLarge.text()).toBe("");
      const next = await fetchH3(port, "/hello");
      expect(await next.text()).toBe("hello over h3");
      expect(next.status).toBe(200);
    });
  });

  test("accepts as many request fields as HTTP/1 and HTTP/2 do", async () => {
    await using server = Bun.serve({
      port: 0,
      tls,
      http3: true,
      fetch(req) {
        return new Response(String([...req.headers].length));
      },
    });
    const request = async (fields: number) => {
      const headers: Record<string, string> = {};
      for (let i = 0; i < fields; i++) headers[`x-${i}`] = "";
      const res = await fetchH3(server.port!, "/", { headers });
      return `${res.status} ${await res.text()}`;
    };
    // What fetch() sends by itself. :authority is the Host header, and :method, :scheme and :path count too.
    const own = Number((await request(0)).slice("200 ".length)) + 3;

    expect({
      atTheLimit: await request(200 - own),
      overTheLimit: await request(200 - own + 1),
      after: await request(0),
    }).toEqual({
      atTheLimit: `200 ${200 - 3}`,
      overTheLimit: "431 ",
      after: `200 ${own - 3}`,
    });
  });

  test("header blocks and values of more than 64 KB arrive intact in both directions, up to the size limit", async () => {
    const limit = 250_000;
    await withCustomServer(
      `
      const server = Bun.serve({
        port: 0,
        tls: ${JSON.stringify(tls)},
        http3: true,
        fetch(req) {
          const headers = new Headers();
          let size = 0;
          for (const [name, value] of req.headers) {
            size += name.length + value.length + 32;
            if (name.startsWith("x-field-")) headers.set(name, value);
          }
          return new Response(String(size), { headers });
        },
      });
      console.error("PORT=" + server.port);
      ${STOP_ON_STDIN_END}
      `,
      async port => {
        const echo = async (sent: Record<string, string>) => {
          const res = await fetchH3(port, "/", { headers: sent });
          const received = Object.fromEntries([...res.headers].filter(([name]) => name.startsWith("x-field-")));
          // Not toEqual(sent): a mismatch would print the values.
          return { status: res.status, intact: Bun.deepEquals(received, sent) };
        };
        const block: Record<string, string> = {};
        // QPACK sends "~" as it is.
        for (let i = 0; i < 30; i++) block[`x-field-${i}`] = String(i).padEnd(4_000, "~");
        expect({
          block: await echo(block),
          value70000: await echo({ "x-field-0": Buffer.alloc(70_000, "v").toString() }),
          value200000: await echo({ "x-field-0": Buffer.alloc(200_000, "~").toString() }),
          name70000: await echo({ ["x-field-" + Buffer.alloc(70_000, "n")]: "v" }),
        }).toEqual({
          block: { status: 200, intact: true },
          value70000: { status: 200, intact: true },
          value200000: { status: 200, intact: true },
          name70000: { status: 200, intact: true },
        });

        // RFC 9114 section 4.2.2 counts the name, the value and 32 more bytes for each field. The
        // server saw :authority as Host, and :method, :scheme and :path count too.
        const own =
          Number(await (await fetchH3(port, "/")).text()) +
          (":authority".length - "host".length) +
          (":method".length + "GET".length + 32) +
          (":scheme".length + "https".length + 32) +
          (":path".length + "/".length + 32);
        const oneValue = (size: number) =>
          fetchH3(port, "/", {
            headers: { "x-field-0": Buffer.alloc(size - own - ("x-field-0".length + 32), "v").toString() },
          }).then(
            res => res.status,
            err => err.code,
          );
        expect({
          atTheLimit: await oneValue(limit),
          overTheLimit: await oneValue(limit + 1),
          farOverTheLimit: await oneValue(limit * 3),
          after: (await fetchH3(port, "/")).status,
        }).toEqual({
          atTheLimit: 200,
          overTheLimit: 431,
          farOverTheLimit: "HTTP3StreamReset",
          after: 200,
        });
      },
      [`--max-http-header-size=${limit}`],
    );
  });

  describe("request line", () => {
    function serve() {
      const calls: string[] = [];
      const server = Bun.serve({
        port: 0,
        tls,
        http3: true,
        routes: {
          "/guarded": {
            GET: () => {
              calls.push("the /guarded route");
              return new Response("guarded");
            },
          },
          "/static": new Response("static"),
        },
        fetch(req) {
          calls.push(`${req.method} ${req.url}`);
          return new Response(`${req.method} ${req.url}`);
        },
      });
      return { server, calls };
    }
    const exchangeAll = async (port: number, rows: Record<string, Record<string, string>>) =>
      Object.fromEntries(
        await Promise.all(Object.entries(rows).map(async ([row, headers]) => [row, await h3Exchange(port, headers)])),
      );

    test("answers 501 to a method Bun.serve can't represent", async () => {
      const { server, calls } = serve();
      await using _ = server;
      const rows: Record<string, Record<string, string>> = {};
      for (const path of ["/echo", "/guarded", "/static"]) {
        for (const method of ["BREW", "DELETE2", Buffer.alloc(300, "M").toString()]) {
          rows[`${method.slice(0, 8)} ${path}`] = requestHeaders(path, { ":method": method });
        }
      }
      expect({ results: await exchangeAll(server.port!, rows), calls }).toEqual({
        results: Object.fromEntries(Object.keys(rows).map(row => [row, "501 "])),
        calls: [],
      });
      expect(await h3Exchange(server.port!, requestHeaders("/echo", { ":method": "PATCH" }))).toBe(
        "200 PATCH https://localhost/echo",
      );
    });

    // RFC 9110 section 9.1: the method is case-sensitive. HTTP/1.1 and HTTP/2 answer 501 too.
    test("answers 501 to a known method that isn't uppercase", async () => {
      const { server, calls } = serve();
      await using _ = server;
      const rows: Record<string, Record<string, string>> = {};
      for (const method of ["get", "Get", "patch", "m-search"]) {
        rows[method] = requestHeaders("/echo", { ":method": method });
      }
      expect({ results: await exchangeAll(server.port!, rows), calls }).toEqual({
        results: Object.fromEntries(Object.keys(rows).map(row => [row, "501 "])),
        calls: [],
      });
    });

    // RFC 9114 sections 4.2 and 4.3. HTTP/2 resets the stream for each of these.
    test("answers 400 to a malformed field section", async () => {
      const { server, calls } = serve();
      await using _ = server;
      const { ":scheme": _scheme, ...noScheme } = requestHeaders("/echo");
      const rows: Record<string, Record<string, string>> = {
        "no :scheme": noScheme,
        "unknown pseudo-header": requestHeaders("/echo", { ":protocol": "websocket" }),
        "empty :scheme": requestHeaders("/echo", { ":scheme": "" }),
        ":authority with userinfo": requestHeaders("/echo", { ":authority": "user@localhost" }),
        "host that contradicts :authority": requestHeaders("/echo", { host: "other.invalid" }),
        "control byte in a value": requestHeaders("/echo", { "x-probe": "a\x01b" }),
      };
      expect({ results: await exchangeAll(server.port!, rows), calls }).toEqual({
        results: Object.fromEntries(Object.keys(rows).map(row => [row, "400 "])),
        calls: [],
      });
      expect(await h3Exchange(server.port!, requestHeaders("/echo", { host: "localhost", "x-probe": "a\tb" }))).toBe(
        "200 GET https://localhost/echo",
      );
    });

    test("answers 400 to a malformed request line", async () => {
      const { server, calls } = serve();
      await using _ = server;
      const { ":method": _method, ...noMethod } = requestHeaders("/echo");
      const { ":path": _path, ...noPath } = requestHeaders("/echo");
      const { ":authority": _authority, ...noAuthority } = requestHeaders("/echo");
      const rows: Record<string, Record<string, string>> = {
        "no :method": noMethod,
        ":method with SP": requestHeaders("/echo", { ":method": "GET /x" }),
        ":method with non-token bytes": requestHeaders("/echo", { ":method": "GET{}" }),
        "no :path": noPath,
        "empty :path": requestHeaders(""),
        ":path with SP": requestHeaders("/a b"),
        // The URL parser strips HTAB, so fetch() saw /guarded.
        ":path with HTAB": requestHeaders("/guar\tded"),
        ":path with a control byte": requestHeaders("/echo\x01"),
        // The router drops the first byte, so this matched the /static route.
        ":path without a leading slash": requestHeaders("xstatic"),
        ":path * with GET": requestHeaders("*"),
        "absolute-form :path": requestHeaders("https://other.invalid/static"),
        "CONNECT with :path": requestHeaders("/static", { ":method": "CONNECT" }),
        "no :authority and no host": noAuthority,
      };
      expect({ results: await exchangeAll(server.port!, rows), calls }).toEqual({
        results: Object.fromEntries(Object.keys(rows).map(row => [row, "400 "])),
        calls: [],
      });
      expect(await h3Exchange(server.port!, requestHeaders("*", { ":method": "OPTIONS" }))).toBe("200 OPTIONS *");
      expect(await h3Exchange(server.port!, { ...noAuthority, host: "localhost" })).toBe(
        "200 GET https://localhost/echo",
      );
    });
  });

  test("request.url falls back to the :path when :authority is not a valid host", async () => {
    await using server = Bun.serve({
      port: 0,
      tls,
      http3: true,
      fetch(req) {
        return new Response(req.url);
      },
    });

    const authorities = ["example.com/other", "example.com#frag", "example.com\\other:8080", "[::1]:3000?q"];
    const results: Record<string, string> = {};
    for (const authority of authorities) {
      results[authority] = await h3Exchange(server.port!, { ...requestHeaders("/index"), ":authority": authority });
    }
    results["example.com:8443"] = await h3Exchange(server.port!, {
      ...requestHeaders("/index"),
      ":authority": "example.com:8443",
    });

    expect(results).toEqual({
      "example.com/other": "200 /index",
      "example.com#frag": "200 /index",
      "example.com\\other:8080": "200 /index",
      "[::1]:3000?q": "200 /index",
      "example.com:8443": "200 https://example.com:8443/index",
    });
  });

  // A QPACK decoder failure closes the connection, so the held response only completes if the block decoded.
  test("accepts request trailers with no field lines", async () => {
    const release = Promise.withResolvers<void>();
    await using server = Bun.serve({
      port: 0,
      tls,
      http3: true,
      async fetch(req) {
        if (new URL(req.url).pathname !== "/held") return new Response("hello" + (await req.text()));
        return new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue("first,");
              await release.promise;
              controller.enqueue("second");
              controller.close();
            },
          }),
        );
      },
    });

    await using endpoint = new QuicEndpoint();
    await using client = await connect(`127.0.0.1:${server.port}`, {
      endpoint,
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 5 },
      onerror() {},
    } as SessionOptions);
    await client.opened;
    const exchange = async (options: Record<string, unknown>, write?: (stream: any) => void) => {
      let status = "";
      const stream = await client.createBidirectionalStream({
        ...options,
        onheaders(received) {
          status = received[":status"] as string;
        },
      });
      stream.closed.catch(() => {});
      write?.(stream);
      let body = "";
      try {
        for await (const batch of stream as AsyncIterable<Uint8Array[]>) {
          for (const chunk of batch) body += Buffer.from(chunk).toString("latin1");
        }
      } catch (error: any) {
        return `${error.code}`;
      }
      return `${status} ${body}`;
    };

    const held = exchange({ headers: requestHeaders("/held") });
    const subject = await exchange({}, stream => {
      stream.sendHeaders({ ...requestHeaders("/subject"), ":method": "POST" });
      stream.sendHeaders({}, { terminal: true });
    });
    release.resolve();
    expect({ subject, held: await held }).toEqual({ subject: "200 hello", held: "200 first,second" });
  });

  test("requestCert with rejectUnauthorized only serves QUIC clients whose certificate chains to the configured CA", async () => {
    const keysDir = join(import.meta.dir, "..", "..", "node", "test", "fixtures", "keys");
    const pem = (name: string) => readFileSync(join(keysDir, name), "utf8");
    let handled = 0;
    await using server = Bun.serve({
      port: 0,
      tls: {
        key: pem("agent1-key.pem"),
        cert: pem("agent1-cert.pem"),
        ca: pem("ca1-cert.pem"),
        requestCert: true,
        rejectUnauthorized: true,
      },
      http3: true,
      fetch() {
        handled++;
        return new Response(String(handled));
      },
    });

    const clientIdentity = (name: string) => ({
      keys: [createPrivateKey(pem(`${name}-key.pem`))],
      certs: [readFileSync(join(keysDir, `${name}-cert.pem`))],
    });
    const selfSigned = await h3Exchange(server.port!, requestHeaders("/"), clientIdentity("agent2"));
    const chained = await h3Exchange(server.port!, requestHeaders("/"), clientIdentity("agent1"));

    expect({ selfSigned, chained }).toEqual({ selfSigned: "closed", chained: "200 1" });
  });

  test("a `ca` without requestCert serves cert-less QUIC clients, and a per-serverName rejectUnauthorized: false tolerates an unverifiable certificate", async () => {
    const keysDir = join(import.meta.dir, "..", "..", "node", "test", "fixtures", "keys");
    const pem = (name: string) => readFileSync(join(keysDir, name), "utf8");
    const credentials = { key: pem("agent1-key.pem"), cert: pem("agent1-cert.pem"), ca: pem("ca1-cert.pem") };
    await using server = Bun.serve({
      port: 0,
      tls: [
        // No requestCert: the `ca` must not make the server ask for a certificate.
        credentials,
        // Asks, but accepts whatever comes back. agent2 is self-signed, so ca1 cannot verify it.
        { ...credentials, serverName: "lenient.example.com", requestCert: true, rejectUnauthorized: false },
      ],
      http3: true,
      fetch: () => new Response("served"),
    });

    const agent2 = {
      keys: [createPrivateKey(pem("agent2-key.pem"))],
      certs: [readFileSync(join(keysDir, "agent2-cert.pem"))],
    };
    const lenient = { servername: "lenient.example.com" };
    const results = {
      defaultNoCert: await h3Exchange(server.port!, requestHeaders("/")),
      lenientNoCert: await h3Exchange(server.port!, requestHeaders("/", { ":authority": lenient.servername }), lenient),
      lenientUnverifiable: await h3Exchange(server.port!, requestHeaders("/", { ":authority": lenient.servername }), {
        ...lenient,
        ...agent2,
      }),
    };

    expect(results).toEqual({
      defaultNoCert: "200 served",
      lenientNoCert: "200 served",
      lenientUnverifiable: "200 served",
    });
  });
});

// RFC 9110 section 10.1.1: a client that sent Expect: 100-continue can hold the
// request content until it has the 100. The handler answers only when it has
// all of the content, so the client ends the request only if the 100 arrived
// on its own. The client waits for the event, with no timer: a server that
// keeps the 100 until the final response makes the test time out.
describe.concurrent("Bun.serve HTTP/3 sends the automatic 100 Continue ahead of the final response", () => {
  async function exchange(server: Bun.Server<undefined>, { handshakeFirst }: { handshakeFirst: boolean }) {
    // A session or a stream that ends before a response fails the test with
    // its reason. Once a response is in, these rejections do nothing.
    const firstResponse = Promise.withResolvers<void>();
    const endedEarly = (what: string) => () => firstResponse.reject(new Error(`${what} closed before a response`));
    await using endpoint = new QuicEndpoint();
    const client = await connect(`127.0.0.1:${server.port}`, {
      endpoint,
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 5 },
      onerror: firstResponse.reject,
    } as SessionOptions);
    client.closed.then(endedEarly("the session"), firstResponse.reject);
    if (handshakeFirst) await client.opened;

    const seen: string[] = [];
    const stream = await client.createBidirectionalStream({
      oninfo(received) {
        seen.push("info " + received[":status"]);
        firstResponse.resolve();
      },
      onheaders(received) {
        seen.push("headers " + received[":status"]);
        firstResponse.resolve();
      },
    });
    stream.closed.then(endedEarly("the stream"), firstResponse.reject);
    const writer = stream.writer;
    stream.sendHeaders(requestHeaders("/", { ":method": "POST", expect: "100-continue" }));
    await firstResponse.promise;
    seen.push("client sends the content");
    writer.writeSync(new TextEncoder().encode("request-content"));
    writer.endSync();

    let body = "";
    for await (const batch of stream as AsyncIterable<Uint8Array[]>) {
      for (const chunk of batch) body += Buffer.from(chunk).toString("latin1");
    }
    if (!client.destroyed) client.close().catch(() => {});
    return [...seen, "body " + body];
  }

  const expected = ["info 100", "client sends the content", "headers 200", "body content:request-content"];
  const serve = () =>
    Bun.serve({
      port: 0,
      tls,
      http3: true,
      http1: false,
      fetch: async req => new Response("content:" + (await req.text())),
    });

  test("on a connection that completed its handshake", async () => {
    await using server = serve();
    expect(await exchange(server, { handshakeFirst: true })).toEqual(expected);
  });

  // The request leaves with the client's handshake. The server then still has
  // the first byte of its QPACK encoder stream to send, and lsquic holds the 100
  // header block back until that byte is out.
  test("on the first request of a connection, sent with the handshake", async () => {
    await using server = serve();
    expect(await exchange(server, { handshakeFirst: false })).toEqual(expected);
  });

  // A 100 Continue would start an upload that the 413 behind it refuses. HTTP/1.1 and HTTP/2 do the same.
  test("but not when content-length exceeds maxRequestBodySize", async () => {
    await using server = Bun.serve({
      port: 0,
      tls,
      http3: true,
      http1: false,
      maxRequestBodySize: 100,
      fetch: async req => new Response("content:" + (await req.text())),
    });
    await using endpoint = new QuicEndpoint();
    const client = await connect(`127.0.0.1:${server.port}`, {
      endpoint,
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 5 },
      onerror() {},
    } as SessionOptions);
    await client.opened;
    const seen: string[] = [];
    const final = Promise.withResolvers<void>();
    const stream = await client.createBidirectionalStream({
      oninfo(received) {
        seen.push("info " + received[":status"]);
      },
      onheaders(received) {
        seen.push("headers " + received[":status"]);
        final.resolve();
      },
    });
    stream.closed.then(final.resolve, final.resolve);
    stream.sendHeaders(requestHeaders("/", { ":method": "POST", expect: "100-continue", "content-length": "101" }));
    await final.promise;
    if (!client.destroyed) client.close().catch(() => {});
    expect(seen).toEqual(["headers 413"]);
  });

  // https://github.com/oven-sh/bun/issues/33082
  // fetch() doesn't wait for the 100, so the handler answers while lsquic still holds the 100 back.
  describe("on the first request of a connection, when the client sends its body right away", () => {
    const big = Buffer.alloc(512 * 1024, "abcdefghijklmnop").toString();
    const summarize = (body: string) => (body.length > 64 ? `${body.length} bytes, hash ${Bun.hash(body)}` : body);
    const streamed = () =>
      new Response(
        new ReadableStream({
          async pull(controller) {
            controller.enqueue(new TextEncoder().encode("streamed"));
            controller.close();
          },
        }),
      );
    test.each([
      ["a string body", { fetch: () => new Response("sync") }, { status: 200, body: "sync" }],
      [
        "a string body after reading the request body",
        { fetch: async (req: Request) => new Response("body:" + (await req.bytes()).length) },
        { status: 200, body: "body:15" },
      ],
      ["a body larger than one write", { fetch: () => new Response(big) }, { status: 200, body: summarize(big) }],
      ["a ReadableStream body", { fetch: streamed }, { status: 200, body: "streamed" }],
      ["an empty body", { fetch: () => new Response("") }, { status: 200, body: "" }],
      ["a 204", { fetch: () => new Response(null, { status: 204 }) }, { status: 204, body: "" }],
      ["a static route", { routes: { "/": new Response("static") } }, { status: 200, body: "static" }],
    ])("%s", async (_, handlers, expected) => {
      await using server = Bun.serve({
        port: 0,
        tls,
        http3: true,
        http1: false,
        ...handlers,
      } as Bun.Serve.Options<undefined>);
      const res = await fetchH3(server.port!, "/", {
        method: "POST",
        body: "request-content",
        headers: { expect: "100-continue" },
      });
      expect({ status: res.status, body: summarize(await res.text()) }).toEqual(expected);
    });
  });
});

// lsquic_global_init() allocates the SSL ex_data index that every TLS callback uses to find its QUIC
// session, so a second call breaks the sessions still in their handshake. Each case needs a fresh process.
describe.concurrent("lsquic is initialized once per process", () => {
  const script = `
import { connect, QuicEndpoint } from "node:quic";
const port = Number(process.env.PORT);
const client = await connect("127.0.0.1:" + port, {
  endpoint: new QuicEndpoint(),
  servername: "localhost",
  verifyPeer: "manual",
  transportParams: { maxIdleTimeout: 5 },
  onerror() {},
});
client.closed.catch(() => {});
// connect() resolves in a microtask, so no server packet has been processed yet.
const other =
  process.env.OTHER === "serve"
    ? Bun.serve({ port: 0, tls: ${JSON.stringify(tls)}, http3: true, http1: false, fetch: () => new Response("x") })
    : fetch("https://127.0.0.1:" + port + "/hello", { protocol: "http3", tls: { rejectUnauthorized: false } }).then(r => r.text());
await client.opened;
let status = "";
const stream = await client.createBidirectionalStream({
  headers: { ":method": "GET", ":path": "/hello", ":scheme": "https", ":authority": "localhost" },
  onheaders(received) {
    status = received[":status"];
  },
});
stream.closed.catch(() => {});
for await (const _ of stream) {
}
client.close().catch(() => {});
console.log("status=" + status);
if (process.env.OTHER === "serve") other.stop(true);
else console.log("fetch=" + (await other));
process.exit(0);
`;

  test.each([
    ["an HTTP/3 server", "serve", "status=200\n"],
    ["a fetch() over HTTP/3", "fetch", "status=200\nfetch=hello over h3\n"],
  ])("a node:quic handshake survives %s starting in the middle of it", async (_, other, expected) => {
    await withServer(async port => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: { ...bunEnv, PORT: String(port), OTHER: other },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr: stderr.replace(/^.*ExperimentalWarning.*\n.*\n/, ""), exitCode }).toEqual({
        stdout: expected,
        stderr: "",
        exitCode: 0,
      });
    });
  });
});

// The HTTP/3 twin of the HTTP/1 cases in websocket-server.test.ts: ws.close()
// runs close() before it returns, and a request handler that calls it must still
// run to completion before the nextTick and promise callbacks it queued. The
// socket being closed lives on a plain HTTP/1 server, since HTTP/3 carries no
// WebSockets; any handler can close it.
describe("Bun.serve HTTP/3 request handlers run to completion before the callbacks they queued", () => {
  async function openHeldSocket() {
    const order: string[] = [];
    const opened = Promise.withResolvers<ServerWebSocket<unknown>>();
    const closed = Promise.withResolvers<void>();
    const wsServer = Bun.serve({
      port: 0,
      fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("upgrade() failed", { status: 500 })),
      websocket: {
        open: ws => opened.resolve(ws),
        message() {},
        close() {
          order.push("close()");
        },
      },
    });
    const client = new WebSocket(wsServer.url.href.replace(/^http/, "ws"));
    client.onerror = () => closed.resolve();
    client.onclose = () => closed.resolve();
    const held = await opened.promise;
    return {
      order,
      closed: closed.promise,
      handler() {
        process.nextTick(() => order.push("nextTick"));
        Promise.resolve().then(() => order.push("microtask"));
        held.close();
        order.push("rest of handler");
        return new Response("ok");
      },
      [Symbol.dispose]: () => wsServer.stop(true),
    };
  }

  test("fetch() and a route handler closing an open ServerWebSocket", async () => {
    using viaFetch = await openHeldSocket();
    using viaRoute = await openHeldSocket();
    await using server = Bun.serve({
      port: 0,
      tls,
      http3: true,
      routes: { "/route": viaRoute.handler },
      fetch: viaFetch.handler,
    });

    const responses = {
      fetch: await h3Exchange(server.port!, requestHeaders("/")),
      route: await h3Exchange(server.port!, requestHeaders("/route")),
    };
    await Promise.all([viaFetch.closed, viaRoute.closed]);

    const expectedOrder = ["close()", "rest of handler", "nextTick", "microtask"];
    expect({ responses, fetch: viaFetch.order, route: viaRoute.order }).toEqual({
      responses: { fetch: "200 ok", route: "200 ok" },
      fetch: expectedOrder,
      route: expectedOrder,
    });
  });
});

describe("Bun.serve HTTP/3 SNI", () => {
  const tlsFixtures = join(import.meta.dir, "..", "..", "node", "tls", "fixtures");
  const pem = (name: string) => readFileSync(join(tlsFixtures, name), "utf8");
  // Each agent certificate has its own CN, which tells the entries apart.
  const identity = (agent: string) => ({ key: pem(`${agent}-key.pem`), cert: pem(`${agent}-cert.pem`) });

  // fetch() lowercases the URL host. node:quic sends `servername` as written
  // and exposes the certificate the server picked.
  async function servedCN(port: number, servername: string): Promise<string> {
    const session = await connect(
      { address: "127.0.0.1", port } as SocketAddress,
      { alpn: "h3", servername, verifyPeer: "manual" } as SessionOptions,
    );
    try {
      await session.opened;
      const cert = session.peerCertificate;
      const x509 = cert instanceof X509Certificate ? cert : new X509Certificate(Buffer.from(cert as any));
      return x509.subject.match(/CN=([^\s,]+)/)![1];
    } finally {
      await session.close();
    }
  }

  test("a later entry with the same serverName replaces the earlier one", async () => {
    using server = Bun.serve({
      port: 0,
      tls: [
        identity("agent1"),
        { serverName: "admin.example.com", ...identity("agent2") },
        { serverName: "admin.example.com.", ...identity("agent3") },
      ],
      http3: true,
      fetch: () => new Response("ok"),
    });
    const served = {
      admin: await servedCN(server.port!, "admin.example.com"),
      dottedAdmin: await servedCN(server.port!, "admin.example.com."),
      other: await servedCN(server.port!, "other.example.com"),
    };
    // The TCP listener selects the same entry for these names.
    expect(served).toEqual({ admin: "agent3", dottedAdmin: "agent3", other: "agent1" });
  });

  test("serverName entries match regardless of case and a wildcard covers one label", async () => {
    using server = Bun.serve({
      port: 0,
      tls: [
        identity("agent1"),
        { serverName: "Agent2.Example", ...identity("agent2") },
        { serverName: "*.wild.example", ...identity("agent3") },
      ],
      http3: true,
      fetch: () => new Response("ok"),
    });
    const served: Record<string, string> = {};
    const overTCP: Record<string, string> = {};
    for (const servername of [
      "Agent2.Example",
      "agent2.example",
      "AGENT2.EXAMPLE",
      "a.wild.example",
      "A.WILD.EXAMPLE",
      "a.b.wild.example",
      "wild.example",
      "other.example",
    ]) {
      served[servername] = await servedCN(server.port!, servername);
      const socket = connectTLS({ host: "127.0.0.1", port: server.port, servername, rejectUnauthorized: false });
      await once(socket, "secureConnect");
      overTCP[servername] = socket.getPeerCertificate().subject.CN as string;
      socket.destroy();
    }
    expect(overTCP).toEqual(served);
    expect(served).toEqual({
      "Agent2.Example": "agent2",
      "agent2.example": "agent2",
      "AGENT2.EXAMPLE": "agent2",
      "a.wild.example": "agent3",
      "A.WILD.EXAMPLE": "agent3",
      "a.b.wild.example": "agent1",
      "wild.example": "agent1",
      "other.example": "agent1",
    });
  });

  // The client picks the SNI, so a spelling that misses the entry would skip its policy.
  test("a strict entry is enforced for every spelling of its name", async () => {
    const strict = { ...identity("agent3"), ca: pem("ca1-cert.pem"), requestCert: true, rejectUnauthorized: true };
    using server = Bun.serve({
      port: 0,
      tls: [
        identity("agent2"),
        { serverName: "Admin.Example.com", ...strict },
        { serverName: "*.gated.example", ...strict },
      ],
      http3: true,
      fetch: () => new Response("served"),
    });
    const client = (agent: string) => ({
      keys: [createPrivateKey(pem(`${agent}-key.pem`))],
      certs: [readFileSync(join(tlsFixtures, `${agent}-cert.pem`))],
    });
    const spellings = [
      "admin.example.com",
      "ADMIN.EXAMPLE.COM",
      "aDmIn.eXaMpLe.CoM.",
      "a.gated.example",
      "A.GATED.EXAMPLE",
      "a.Gated.Example.",
    ];
    const exchange = (servername: string, options = {}) =>
      h3Exchange(server.port!, requestHeaders("/"), { servername, ...options });
    const outcomes = await Promise.all(
      spellings.map(async name => [
        name,
        await exchange(name),
        await exchange(name, client("agent3")), // issued by ca2
        await exchange(name, client("agent1")), // issued by ca1
      ]),
    );
    expect(outcomes).toEqual(spellings.map(name => [name, "closed", "closed", "200 served"]));
    expect(await exchange("other.example")).toBe("200 served");
  });
});

// A graceful stop() keeps the UDP socket open for connections that still have a
// response to deliver. Its promise resolves once the last of them is gone and
// the socket is closed.
describe("Bun.serve HTTP/3 stop()", () => {
  async function run(script: string) {
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // Nothing is awaited at the top level, so only the server keeps the process
  // alive. stop() in the microtask runs inside lsquic's process_conns.
  test.concurrent.each([
    ["in a microtask of the handler", ""],
    ["in a later task", "await new Promise(resolve => setImmediate(resolve));"],
  ])("frees the port for a Bun.serve() after the await, called %s", async (_where, beforeStop) => {
    const result = await run(`
      const inHandler = Promise.withResolvers();
      const proceed = Promise.withResolvers();
      const options = { hostname: "127.0.0.1", tls: ${JSON.stringify(tls)}, http3: true };
      const h3 = { protocol: "http3", tls: { rejectUnauthorized: false } };
      const server = Bun.serve({
        ...options,
        port: 0,
        async fetch() {
          inHandler.resolve();
          await proceed.promise;
          return new Response("first");
        },
      });
      const port = server.port;
      const first = fetch("https://127.0.0.1:" + port + "/", h3).then(r => r.text());
      inHandler.promise.then(async () => {
        ${beforeStop}
        const stopped = server.stop();
        proceed.resolve();
        await stopped;
        const second = Bun.serve({ ...options, port, fetch: () => new Response("second") });
        const answers = [await first, await fetch("https://127.0.0.1:" + port + "/", h3).then(r => r.text())];
        await second.stop(true);
        console.log(answers.join(","));
      });
    `);
    expect(result).toEqual({ stdout: "first,second\n", stderr: "", exitCode: 0 });
  });

  // 1 MB takes several round trips of acknowledgements.
  test.concurrent("delivers a response in flight before the process exits", async () => {
    const expected = Buffer.alloc(1024 * 1024, "abcdefghijklmnop");
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const body = Buffer.alloc(1024 * 1024, "abcdefghijklmnop");
          const server = Bun.serve({
            port: 0, hostname: "127.0.0.1", tls: ${JSON.stringify(tls)}, http3: true,
            fetch() {
              setImmediate(async () => {
                await server.stop();
                process.exit(0);
              });
              return new Response(body);
            },
          });
          console.log(server.port);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const { value } = await proc.stdout.getReader().read();
    const body = await fetchH3(Number(new TextDecoder().decode(value)), "/").then(res => res.bytes());
    expect(Buffer.compare(body, expected)).toBe(0);
    expect(await proc.exited).toBe(0);
  });

  test("frees the port when only an idle connection is left", async () => {
    const options = { hostname: "127.0.0.1", tls, http3: true, http1: false, fetch: () => new Response("ok") };
    await using first = Bun.serve({ ...options, port: 0 });
    const port = first.port!;
    for (let i = 0; i < 2; i++) expect(await fetchH3(port, "/").then(res => res.text())).toBe("ok");
    await first.stop();
    await using second = Bun.serve({ ...options, port });
    expect(second.port).toBe(port);
  });

  // Nothing acknowledges the response, so the connection drains until the idle timeout or an abrupt stop.
  test("stays pending after the peer vanished, until stop(true)", async () => {
    const inHandler = Promise.withResolvers<void>();
    const proceed = Promise.withResolvers<void>();
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls,
      http3: true,
      http1: false,
      idleTimeout: 30,
      async fetch() {
        inHandler.resolve();
        await proceed.promise;
        return new Response("first");
      },
    });
    const port = server.port!;
    try {
      await using client = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `await fetch("https://127.0.0.1:${port}/", { protocol: "http3", tls: { rejectUnauthorized: false } }).then(r => r.text());`,
        ],
        env: bunEnv,
        stdout: "ignore",
        stderr: "inherit",
      });
      client.exited.then(code => inHandler.reject(new Error(`the client exited before its request arrived: ${code}`)));
      await inHandler.promise;
      client.kill("SIGKILL");
      await client.exited;
      const stopped = server.stop();
      proceed.resolve();
      while (server.pendingRequests !== 0) await new Promise<void>(resolve => setImmediate(resolve));
      expect({ same: server.stop() === stopped, status: Bun.peek.status(stopped) }).toEqual({
        same: true,
        status: "pending",
      });
      server.stop(true);
      await stopped;
      (await Bun.udpSocket({ port, hostname: "127.0.0.1" })).close();
    } finally {
      server.stop(true);
    }
  });

  // The event loop closes a UDP socket whose receive fails. Its connections can't
  // reach their peers any more, so stop() must not wait out their idle timeout.
  test.skipIf(!socketFaultInjection.available())("doesn't wait for connections whose UDP socket closed", async () => {
    const script = `
      import { socketFaultInjection as fault } from "bun:internal-for-testing";
      const armed = Promise.withResolvers();
      const server = Bun.serve({
        port: 0, hostname: "127.0.0.1", tls: ${JSON.stringify(tls)}, http3: true, http1: false,
        fetch(req) {
          if (new URL(req.url).pathname !== "/arm") return new Response("ok");
          fault.set({ syscall: "recvmsg", action: "errno", errno: "ENOBUFS" });
          armed.resolve();
          return new Response("armed");
        },
      });
      const port = server.port;
      console.error("PORT=" + port);
      await armed.promise;
      // The next datagram from a client fails the receive. Wait until the port is free.
      while (true) {
        try {
          (await Bun.udpSocket({ port, hostname: "127.0.0.1" })).close();
          break;
        } catch (e) {
          if (e.code !== "EADDRINUSE") throw e;
        }
        await new Promise(resolve => setImmediate(resolve));
      }
      server.stop();
      console.error("STOPPED " + Bun.peek.status(server.stop()));
    `;
    await withCustomServer(script, async (port, _send, waitForStderr) => {
      using sessions = new DisposableStack();
      // More connections than lsquic's first send batch holds.
      const open = Array.from({ length: 32 }, () => sessions.use(new Bun.FetchSession()));
      const get = (session: Bun.FetchSession, path: string) =>
        fetchH3(port, path, { session } as RequestInit).then(res => res.text());
      for (const session of open) expect(await get(session, "/")).toBe("ok");
      expect(await get(open[0], "/arm")).toBe("armed");
      expect((await waitForStderr(/STOPPED (\w+)/))[1]).toBe("fulfilled");
    });
  });
});

// Bun.serve pauses a request body nobody reads by holding the stream's
// flow-control window (1 MiB). It keeps reading the stream, because data left in
// lsquic uses up the connection's window (1.5 MiB) and is dropped with the
// connection.
describe("Bun.serve HTTP/3 request body that isn't read yet", () => {
  test("leaves the connection's flow-control window to other requests", async () => {
    // Two of these, unread, are more than the connection's window.
    const body = Buffer.alloc(2 * 1024 * 1024, "abcdefghijklmnop");
    const gate = Promise.withResolvers<void>();
    await using server = Bun.serve({
      port: 0,
      tls,
      http3: true,
      http1: false,
      routes: {
        "/hello": () => new Response("hello"),
        "/read": async req => new Response(String((await req.bytes()).length)),
        "/held": async req => {
          await gate.promise;
          return new Response(String((await req.bytes()).length));
        },
      },
    });
    const post = (path: string) => fetchH3(server.port!, path, { method: "POST", body }).then(r => r.text());

    const held = [post("/held"), post("/held")];
    // Same size, same connection: once this one is through, the held uploads have sent all they may.
    const read = await post("/read");
    const sibling = await fetchH3(server.port!, "/hello").then(r => r.text());
    gate.resolve();
    expect({ read, sibling, held: await Promise.all(held) }).toEqual({
      read: String(body.length),
      sibling: "hello",
      held: [String(body.length), String(body.length)],
    });
  });

  test("arrives whole after its connection closed", async () => {
    // Over the 1 MiB at which a stalled reader pauses the stream.
    const body = Buffer.alloc(1408 * 1024, "abcdefghijklmnop");
    const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
    const seen = Promise.withResolvers<{ length: number; sha: string } | { name: string }>();
    await using server = Bun.serve({
      port: 0,
      tls,
      http3: true,
      http1: false,
      async fetch(req) {
        const reader = req.body!.getReader();
        const chunks = [(await reader.read()).value!];
        // Stall until the client is gone.
        await new Promise(resolve => req.signal.addEventListener("abort", resolve));
        try {
          for (let next; !(next = await reader.read()).done;) chunks.push(next.value);
          const bytes = Buffer.concat(chunks);
          seen.resolve({ length: bytes.length, sha: sha(bytes) });
        } catch (e) {
          seen.resolve({ name: (e as Error).name });
        }
        return new Response();
      },
    });

    await using endpoint = new QuicEndpoint();
    const client = await connect(`127.0.0.1:${server.port}`, {
      endpoint,
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 5 },
      onerror() {},
    } as SessionOptions);
    client.closed.catch(() => {});
    const stream = await client.createBidirectionalStream();
    stream.closed.catch(() => {});
    stream.sendHeaders(requestHeaders("/", { ":method": "POST" }));
    // One piece per turn of the event loop, which the server shares. A burst
    // would overflow the loopback socket and wait for retransmissions.
    for (let offset = 0; offset < body.length;) {
      await new Promise(resolve => setImmediate(resolve));
      if (stream.writer.writeSync(body.subarray(offset, offset + 16 * 1024))) offset += 16 * 1024;
    }
    stream.writer.endSync();
    // An application close waits until the server has acknowledged the whole stream.
    client.close({ type: "application", code: 0x100 }).catch(() => {});

    expect(await seen.promise).toEqual({ length: body.length, sha: sha(body) });
  });
});

// Only a FIN completes an HTTP/3 message, so a body that fails after the status
// was sent has to end with RESET_STREAM. HTTP/1 closes the socket without the
// last chunk.
describe("Bun.serve HTTP/3 response body that fails after its first chunk", () => {
  // The body fails once the client, which has the first chunk by then, requests /release.
  const script = `
    const { promise: released, resolve: release } = Promise.withResolvers();
    const server = Bun.serve({
      port: 0,
      tls: ${JSON.stringify(tls)},
      http3: true,
      http1: false,
      routes: {
        "/ok": () => new Response("ok"),
        "/release": () => {
          release();
          return new Response("released");
        },
        "/fails": () => {
          let pulls = 0;
          return new Response(new ReadableStream({
            async pull(c) {
              if (pulls++ === 0) return c.enqueue(new Uint8Array(1024).fill(65));
              await released;
              c.error(new Error("boom"));
            },
          }));
        },
      },
    });
    console.error("PORT=" + server.port);
    ${STOP_ON_STDIN_END}
  `;
  const release = (port: number) => fetchH3(port, "/release").then(r => r.text());

  test("resets the stream with H3_INTERNAL_ERROR", async () => {
    await withCustomServer(script, async port => {
      await using endpoint = new QuicEndpoint();
      const client = await connect(`127.0.0.1:${port}`, {
        endpoint,
        servername: "localhost",
        verifyPeer: "manual",
        transportParams: { maxIdleTimeout: 5 },
        onerror() {},
      } as SessionOptions);
      await client.opened;
      const stream = await client.createBidirectionalStream({ headers: requestHeaders("/fails") });
      const closed = stream.closed.then(
        () => "fin",
        (e: Error & { code?: string; errorCode?: bigint }) => `${e.code} ${e.errorCode}`,
      );
      let chunks = 0;
      try {
        for await (const _ of stream as AsyncIterable<Uint8Array[]>) {
          if (chunks++ === 0) await release(port);
        }
      } catch {}
      const result = { chunks, closed: await closed };
      client.close().catch(() => {});
      expect(result).toEqual({ chunks: 1, closed: "ERR_QUIC_APPLICATION_ERROR 258" });
    });
  });

  test("rejects fetch()'s body read and keeps the connection", async () => {
    await withCustomServer(script, async port => {
      const res = await fetchH3(port, "/fails");
      const reader = res.body!.getReader();
      const first = await reader.read();
      await release(port);
      const rest = await reader.read().then(
        ({ done }) => (done ? "done" : "chunk"),
        (e: Error & { code?: string }) => e.code,
      );
      const after = await fetchH3(port, "/ok").then(r => r.text());
      expect({ status: res.status, first: first.value?.length, rest, after }).toEqual({
        status: 200,
        first: 1024,
        rest: "HTTP3StreamReset",
        after: "ok",
      });
    });
  });
});

// After the client's STOP_SENDING, lsquic answers every write with -1. The stream doesn't
// close on its own while the request side is open, so the server has to give it up.
describe("Bun.serve HTTP/3 response that the client stopped while its request is still open", () => {
  const taskHop = () => new Promise<void>(resolve => setImmediate(resolve));

  // Resolves to `late` if `event` doesn't settle before the connection's idle timeout ends every stream anyway.
  async function settledWithin<T>(ms: number, event: Promise<T>, late: T): Promise<T> {
    let settled: { value: T } | undefined;
    event.then(value => (settled = { value }));
    const deadline = performance.now() + ms;
    while (!settled && performance.now() < deadline) await taskHop();
    return settled ? settled.value : late;
  }

  // Sends a POST, leaves its request side open, then sends STOP_SENDING for the response.
  async function stoppedRequest(port: number, stopWhen: () => Promise<unknown>, onheaders?: () => void) {
    const endpoint = new QuicEndpoint();
    const client = await connect(`127.0.0.1:${port}`, {
      endpoint,
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 5 },
      onerror() {},
    } as SessionOptions);
    await client.opened;
    const stream: any = await client.createBidirectionalStream({ onheaders });
    stream.closed.catch(() => {});
    stream.sendHeaders(requestHeaders("/", { ":method": "POST" }));
    stream.writer.writeSync(new TextEncoder().encode("the start of an upload"));
    (async () => {
      for await (const _ of stream as AsyncIterable<Uint8Array[]>);
    })().catch(() => {});
    await stopWhen();
    stream.stopSending(0x10cn);
    return {
      client,
      stream,
      async [Symbol.asyncDispose]() {
        client.destroy();
        await endpoint.close();
      },
    };
  }

  test("aborts the request when the response writes again", async () => {
    const started = Promise.withResolvers<void>();
    const ended = Promise.withResolvers<string>();
    await using server = Bun.serve({
      port: 0,
      tls,
      http3: true,
      fetch(req) {
        return new Response(
          new ReadableStream({
            type: "direct",
            // Writes on every turn without waiting for the sink to drain, like a timer-driven event stream.
            async pull(controller) {
              const giveUpAt = performance.now() + 3000;
              for (let writes = 0; !req.signal.aborted && performance.now() < giveUpAt; writes++) {
                controller.write("event\n");
                if (writes === 8) started.resolve();
                await taskHop();
              }
              ended.resolve(req.signal.aborted ? "aborted" : "never aborted");
            },
          }),
        );
      },
    });

    await using _ = await stoppedRequest(server.port!, () => started.promise);

    expect(await ended.promise).toBe("aborted");
  });

  // With bytes already queued, a later write only appends to them and asks for a writable callback. lsquic
  // refuses that once its RESET_STREAM is out. In the flight that carried the STOP_SENDING it isn't out yet,
  // so the callback runs and its write gets the -1. The response writes once, so each row tests one path.
  test.each([
    { when: "a later flight", turnsBetween: 2 },
    { when: "the same flight", turnsBetween: 0 },
  ])(
    "aborts the request when bytes were already queued and the response writes again in $when",
    async ({ turnsBetween }) => {
      const queued = Promise.withResolvers<void>();
      const sawHeaders = Promise.withResolvers<void>();
      const writeAgain = Promise.withResolvers<void>();
      const aborted = Promise.withResolvers<string>();
      await using server = Bun.serve({
        port: 0,
        tls,
        http3: true,
        routes: {
          "/write-again": () => {
            writeAgain.resolve();
            return new Response("ok");
          },
        },
        fetch(req) {
          req.signal.addEventListener("abort", () => aborted.resolve("aborted"));
          return new Response(
            new ReadableStream({
              type: "direct",
              async pull(controller) {
                // Far more than the client's window.
                controller.write(Buffer.alloc(8 * 1024 * 1024, "q"));
                controller.flush();
                queued.resolve();
                await writeAgain.promise;
                controller.write("tail");
                controller.flush();
                await aborted.promise;
              },
            }),
          );
        },
      });

      await using stopped = await stoppedRequest(
        server.port!,
        () => Promise.all([queued.promise, sawHeaders.promise]),
        sawHeaders.resolve,
      );
      for (let i = 0; i < turnsBetween; i++) await taskHop();
      const second = await stopped.client.createBidirectionalStream({ headers: requestHeaders("/write-again") });
      for await (const _ of second as AsyncIterable<Uint8Array[]>);

      expect(await settledWithin(3000, aborted.promise, "no abort within 3 s")).toBe("aborted");
    },
  );

  // end() completes the response even if its bytes can't go out, as over HTTP/1, so there's no abort event.
  test("closes the stream when the response ends after the STOP_SENDING", async () => {
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    await using server = Bun.serve({
      port: 0,
      tls,
      http3: true,
      routes: {
        "/finish": () => {
          finish.resolve();
          return new Response("ok");
        },
      },
      fetch() {
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(controller) {
              controller.write("head");
              await controller.flush();
              started.resolve();
              await finish.promise;
              // The sink passes this tail to end(), not to write().
              controller.write("tail");
              Promise.resolve(controller.end()).catch(() => {});
            },
          }),
        );
      },
    });

    await using stopped = await stoppedRequest(server.port!, () => started.promise);
    // Two turns put the STOP_SENDING on the wire, so the server has it before the second request.
    await taskHop();
    await taskHop();
    const second = await stopped.client.createBidirectionalStream({ headers: requestHeaders("/finish") });
    for await (const _ of second as AsyncIterable<Uint8Array[]>);

    const closed = stopped.stream.closed.then(
      () => "closed",
      () => "closed",
    );
    const upload = await settledWithin(3000, closed, "still open after 3 s");
    expect({ upload, pendingRequests: server.pendingRequests }).toEqual({ upload: "closed", pendingRequests: 0 });
  });
});

// A handler runs while lsquic processes that handler's connection. A write it
// makes to another connection's stream has to go out right away, not with that
// connection's next packet or alarm.
describe("Bun.serve HTTP/3 writes to another connection's stream from a handler", () => {
  type Session = Awaited<ReturnType<typeof connect>>;

  async function open(port: number, endpoint: QuicEndpoint) {
    const session = await connect(`127.0.0.1:${port}`, {
      endpoint,
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 30 },
      onerror() {},
    } as SessionOptions);
    session.closed.catch(() => {});
    await session.opened;
    return session;
  }

  // Sends a GET. The returned function resolves once the body ends with `text`.
  async function request(session: Session, path: string) {
    const stream = await session.createBidirectionalStream({ headers: requestHeaders(path) });
    stream.closed.catch(() => {});
    let body = "";
    let ended = false;
    let more = Promise.withResolvers<void>();
    (async () => {
      try {
        for await (const batch of stream as AsyncIterable<Uint8Array[]>) {
          for (const chunk of batch) body += Buffer.from(chunk).toString("latin1");
          more.resolve();
          more = Promise.withResolvers<void>();
        }
      } finally {
        ended = true;
        more.resolve();
      }
    })().catch(() => {});
    return async (text: string) => {
      while (!body.endsWith(text)) {
        if (ended) throw new Error(`the response ended before "${text}"`);
        await more.promise;
      }
      return text;
    };
  }
  const get = async (session: Session, path: string, body: string) => (await request(session, path))(body);

  // `hold` sends a request on its own connection. `released` resolves with what
  // "/kick", sent on a second connection, makes the server write to it. That
  // write must reach the client before the response to a later "/marker".
  async function run(
    routes: Record<string, () => Response | Promise<Response>>,
    hold: (holder: Session) => Promise<{ released: Promise<string> }>,
  ) {
    await using kickerEndpoint = new QuicEndpoint();
    await using holderEndpoint = new QuicEndpoint();
    const server = Bun.serve({
      port: 0,
      tls,
      http3: true,
      http1: false,
      routes: { ...routes, "/marker": () => new Response("marker") },
    });
    const sessions: Session[] = [];
    try {
      const kicker = await open(server.port!, kickerEndpoint);
      sessions.push(kicker);
      const holder = await open(server.port!, holderEndpoint);
      sessions.push(holder);
      const events: string[] = [];
      const released = (await hold(holder)).released.then(text => events.push(text));
      // Any packet on the holder's connection gets it ticked, which would hide
      // the bug. Wait until it's been quiet for 20 requests on the other one.
      const stats = holder.stats as unknown as { pktSent: bigint; pktRecv: bigint };
      for (let quiet = 0, last = -1n, requests = 0; quiet < 20 && requests < 60; requests++) {
        const packets = stats.pktSent + stats.pktRecv;
        quiet = packets === last ? quiet + 1 : 0;
        last = packets;
        await get(kicker, "/marker", "marker");
      }
      await get(kicker, "/kick", "kicked");
      events.push(await get(kicker, "/marker", "marker"));
      await released;
      return events;
    } finally {
      // Before the sessions close, because they wait for open responses.
      await server.stop(true);
      for (const session of sessions) if (!session.destroyed) session.close().catch(() => {});
    }
  }

  test("sends a response right away", async () => {
    const arrived = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    const events = await run(
      {
        "/held": async () => {
          arrived.resolve();
          await gate.promise;
          return new Response("held response");
        },
        "/kick": () => {
          gate.resolve();
          return new Response("kicked");
        },
      },
      async holder => {
        const response = await request(holder, "/held");
        await arrived.promise;
        return { released: response("held response") };
      },
    );
    expect(events).toEqual(["held response", "marker"]);
  });

  test("sends a chunk of a streamed response right away", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const events = await run(
      {
        "/held": () =>
          new Response(
            new ReadableStream({
              start(c) {
                controller = c;
                c.enqueue(new TextEncoder().encode("first chunk"));
              },
            }),
          ),
        "/kick": () => {
          controller.enqueue(new TextEncoder().encode("second chunk"));
          return new Response("kicked");
        },
      },
      async holder => {
        const response = await request(holder, "/held");
        await response("first chunk");
        return { released: response("second chunk") };
      },
    );
    expect(events).toEqual(["second chunk", "marker"]);
  });
});

// Bun.build() runs the event loop while it waits for an async plugin setup(),
// so a handler that calls it can have a packet for its own connection read in
// the middle of lsquic's pass. The server gets its own process because it hangs
// or aborts when this breaks.
test("Bun.serve HTTP/3 accepts a packet for a connection whose handler is running the event loop", async () => {
  const script = /* js */ `
    import { connect, QuicEndpoint } from "node:quic";

    let session;
    async function request(path) {
      const stream = await session.createBidirectionalStream({
        headers: { ":method": "GET", ":path": path, ":scheme": "https", ":authority": "localhost" },
      });
      stream.closed.catch(() => {});
      let body = "";
      for await (const batch of stream) for (const chunk of batch) body += Buffer.from(chunk).toString("latin1");
      return body;
    }

    let second;
    const server = Bun.serve({
      port: 0,
      tls: ${JSON.stringify(tls)},
      http3: true,
      http1: false,
      routes: {
        "/build": () => {
          Bun.build({
            entrypoints: ["./entry.js"],
            plugins: [
              {
                name: "second request",
                async setup() {
                  const sent = session.stats.pktSent;
                  second = request("/second");
                  // Wait until the request is in the server's socket, then
                  // one more turn of the event loop so the server reads it.
                  while (session.stats.pktSent === sent) await new Promise(setImmediate);
                  await new Promise(setImmediate);
                },
              },
            ],
          }).catch(() => {});
          return new Response("built");
        },
        "/second": () => new Response("second"),
      },
    });

    session = await connect("127.0.0.1:" + server.port, {
      endpoint: new QuicEndpoint(),
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 30 },
      onerror() {},
    });
    session.closed.catch(() => {});
    await session.opened;
    await request("/second");
    console.log(JSON.stringify([await request("/build"), await second]));
    process.exit(0);
  `;
  using dir = tempDir("serve-http3-nested-loop", { "entry.js": "export default 1;\n", "server.mjs": script });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    // Kills a server that hangs, before the test's own timeout.
    timeout: 20_000,
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: JSON.stringify(["built", "second"]),
    exitCode: 0,
    signalCode: null,
  });
}, 30_000);
