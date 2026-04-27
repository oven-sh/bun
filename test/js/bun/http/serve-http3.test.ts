import { which } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "crypto";
import { bunEnv, bunExe, tempDir, tls } from "harness";
import { join } from "path";

// HTTP/3 needs a curl that was built with nghttp3/ngtcp2. CI provisions one
// as `curl-h3`; locally fall back to whichever `curl` reports HTTP3 in
// --version. Everything is skipped otherwise so the suite stays green on
// stock macOS/Windows curl.
let curlH3: string | null = null;

beforeAll(async () => {
  for (const candidate of [process.env.CURL_HTTP3, "curl-h3", "curl"]) {
    if (!candidate) continue;
    const bin = which(candidate);
    if (!bin) continue;
    const proc = Bun.spawn({ cmd: [bin, "--version"], stdout: "pipe", stderr: "ignore" });
    const out = await proc.stdout.text();
    await proc.exited;
    if (/\bHTTP3\b/.test(out)) {
      curlH3 = bin;
      break;
    }
  }
});

const itH3: typeof test = ((name: string, fn: any) =>
  test(name, async () => {
    if (!curlH3) {
      console.warn("skipping (no HTTP/3-capable curl in PATH; set CURL_HTTP3=/path/to/curl)");
      return;
    }
    return fn();
  })) as any;

/** Spawn `curl --http3-only` against the given port+path. */
async function curl3(
  port: number,
  path: string,
  extra: string[] = [],
  opts: { stdin?: string | Uint8Array } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number; raw: Uint8Array }> {
  const proc = Bun.spawn({
    cmd: [
      curlH3!,
      "-sk",
      "--http3-only",
      "--connect-timeout",
      "8",
      "--max-time",
      "15",
      ...extra,
      `https://127.0.0.1:${port}${path}`,
    ],
    env: bunEnv,
    stdin:
      opts.stdin === undefined
        ? "ignore"
        : typeof opts.stdin === "string"
          ? new TextEncoder().encode(opts.stdin)
          : opts.stdin,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [rawBuf, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);
  const raw = new Uint8Array(rawBuf);
  return { stdout: new TextDecoder().decode(raw), stderr, exitCode, raw };
}

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
    return new Response("not found: " + url.pathname, { status: 404 });
  },
});

console.error("PORT=" + server.port);
process.stdin.on("data", () => {}); // keep alive
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
    proc.kill();
    await proc.exited;
  }
}

describe("Bun.serve HTTP/3", () => {
  itH3("basic GET", async () => {
    await withServer(async port => {
      const { stdout, exitCode, stderr } = await curl3(port, "/hello", ["-D", "-"]);
      expect(stderr).toBe("");
      expect(stdout).toContain("HTTP/3 200");
      expect(stdout).toContain("x-proto: h3");
      expect(stdout).toContain("hello over h3");
      expect(exitCode).toBe(0);
    });
  });

  itH3("POST echoes body, status, request headers", async () => {
    await withServer(async port => {
      const body = "the quick brown fox jumps over the lazy dog";
      const { stdout, exitCode } = await curl3(port, "/echo", [
        "-D",
        "-",
        "-X",
        "POST",
        "-H",
        "x-echo: pong",
        "--data-binary",
        body,
      ]);
      expect(stdout).toContain("HTTP/3 201");
      expect(stdout).toContain("x-method: POST");
      expect(stdout).toContain("x-echo: pong");
      expect(stdout).toContain(`x-len: ${body.length}`);
      expect(stdout.endsWith(body)).toBe(true);
      expect(exitCode).toBe(0);
    });
  });

  itH3("204 with no body", async () => {
    await withServer(async port => {
      const { stdout, exitCode } = await curl3(port, "/status", ["-D", "-"]);
      expect(stdout).toContain("HTTP/3 204");
      expect(exitCode).toBe(0);
    });
  });

  itH3("query string is preserved", async () => {
    await withServer(async port => {
      const { stdout, exitCode } = await curl3(port, "/query?q=hello%20world&x=1");
      expect(stdout).toBe("hello world");
      expect(exitCode).toBe(0);
    });
  });

  itH3("large response body crosses multiple QUIC packets", async () => {
    await withServer(async port => {
      const { raw, exitCode } = await curl3(port, "/big");
      expect(raw.length).toBe(512 * 1024);
      // verify content integrity at both ends
      expect(new TextDecoder().decode(raw.subarray(0, 16))).toBe("abcdefghijklmnop");
      expect(new TextDecoder().decode(raw.subarray(-16))).toBe("abcdefghijklmnop");
      expect(exitCode).toBe(0);
    });
  });

  itH3("concurrent requests across separate connections", async () => {
    await withServer(async port => {
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => curl3(port, `/query?q=r${i}`)));
      for (let i = 0; i < results.length; i++) {
        expect(results[i].stdout).toBe(`r${i}`);
        expect(results[i].exitCode).toBe(0);
      }
    });
  });

  itH3("client abort mid-response does not crash the server", async () => {
    await withServer(async port => {
      // First request: tiny timeout forces curl to abort during /slow
      const aborted = await curl3(port, "/slow", ["--max-time", "0.01"]);
      expect(aborted.exitCode).not.toBe(0);
      // Server must still be alive for a follow-up
      const ok = await curl3(port, "/hello");
      expect(ok.stdout).toContain("hello over h3");
      expect(ok.exitCode).toBe(0);
    });
  });

  itH3("h1: false rejects HTTP/1.1 but accepts HTTP/3", async () => {
    await withServer(
      async port => {
        const h3 = await curl3(port, "/hello");
        expect(h3.stdout).toContain("hello over h3");
        // TCP listener should not be bound at all
        const proc = Bun.spawn({
          cmd: [curlH3!, "-sk", "--http1.1", "--connect-timeout", "2", `https://127.0.0.1:${port}/hello`],
          stdout: "pipe",
          stderr: "pipe",
        });
        await proc.exited;
        expect(proc.exitCode).not.toBe(0);
      },
      { H3_ONLY: "1" },
    );
  });

  // With h1:false the TCP listen socket is never created, so server.url /
  // server.address / server.stop() must consult the QUIC listener.
  itH3("h1: false — url/address/stop see the QUIC listener", async () => {
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
      const ok = await curl3(port, "/");
      expect(ok.stdout).toBe("ok");
      send("stop");
      await waitForStderr(/STOPPED/);
      // After stop(), the UDP socket should be closed; a new request fails.
      const after = await curl3(port, "/", ["--connect-timeout", "2"]);
      expect(after.exitCode).not.toBe(0);
    });
  });

  // RFC 9114 §4.2.2: Content-Length is optional on H3. The up-front 413
  // check only sees CL, so without it the per-chunk cap in
  // onBufferedBodyChunk is what enforces maxRequestBodySize.
  itH3("maxRequestBodySize is enforced for H3 bodies without Content-Length", async () => {
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
      // 256 KB body, no Content-Length header (curl sends raw DATA + FIN over H3).
      const body = Buffer.alloc(256 * 1024, "A");
      const r = await curl3(
        port,
        "/",
        [
          "-X",
          "POST",
          "--data-binary",
          "@-",
          "-H",
          "Content-Length:",
          "-H",
          "Content-Type: application/octet-stream",
          "-D",
          "-",
        ],
        { stdin: body },
      );
      expect(r.stdout).toContain("HTTP/3 413");
    });
  });

  itH3("unknown route returns 404", async () => {
    await withServer(async port => {
      const { stdout, exitCode } = await curl3(port, "/nope", ["-D", "-"]);
      expect(stdout).toContain("HTTP/3 404");
      expect(stdout).toContain("not found: /nope");
      expect(exitCode).toBe(0);
    });
  });

  itH3("routes: handler with :params", async () => {
    await withServer(async port => {
      const { stdout, exitCode } = await curl3(port, "/api/abc%20123", ["-D", "-"]);
      expect(stdout).toContain("HTTP/3 200");
      expect(stdout).toContain("x-route: api");
      expect(stdout).toContain("id=abc 123");
      expect(exitCode).toBe(0);
    });
  });

  itH3("routes: per-method handler", async () => {
    await withServer(async port => {
      const post = await curl3(port, "/route-only", ["-X", "POST"]);
      expect(post.stdout).toBe("posted");
      // GET falls through to fetch() since the route is POST-only
      const get = await curl3(port, "/route-only");
      expect(get.stdout).toContain("not found: /route-only");
    });
  });

  // A method-specific "/*" must not suppress the fetch() fallback for the
  // other methods on the H3 router (it doesn't on H1).
  itH3("routes: method-specific '/*' falls through to fetch() on other methods", async () => {
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
      const get = await curl3(port, "/anything");
      expect(get.stdout).toBe("from-route");
      const post = await curl3(port, "/anything", ["-X", "POST"]);
      expect(post.stdout).toBe("from-fetch:POST");
      const put = await curl3(port, "/anything", ["-X", "PUT", "-d", "x"]);
      expect(put.stdout).toBe("from-fetch:PUT");
    });
  });

  itH3("ReadableStream response body", async () => {
    await withServer(async port => {
      const { stdout, exitCode } = await curl3(port, "/stream");
      expect(stdout).toBe("one two three");
      expect(exitCode).toBe(0);
    });
  });

  itH3("Bun.file response body", async () => {
    await withServer(async port => {
      const { raw, exitCode } = await curl3(port, "/file");
      expect(raw.length).toBe(200 * 1024);
      expect(new TextDecoder().decode(raw.subarray(0, 8))).toBe("FILEfile");
      expect(new TextDecoder().decode(raw.subarray(-8))).toBe("FILEfile");
      expect(exitCode).toBe(0);
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

  itH3("static route (Response value) is mirrored onto H3", async () => {
    await withServer(async port => {
      const { stdout, exitCode } = await curl3(port, "/static", ["-D", "-"]);
      expect(stdout).toContain("HTTP/3 200");
      expect(stdout).toContain("from-static-route");
      expect(stdout.toLowerCase()).toContain('etag: "v1"');
      // If-None-Match -> 304 over H3
      const second = await curl3(port, "/static", ["-D", "-", "-H", 'if-none-match: "v1"']);
      expect(second.stdout).toContain("HTTP/3 304");
      expect(exitCode).toBe(0);
    });
  });

  itH3("file route (Bun.file value) streams over H3", async () => {
    await withServer(async port => {
      const { raw, exitCode } = await curl3(port, "/file-route");
      expect(raw.length).toBe(200 * 1024);
      expect(Buffer.from(raw.subarray(0, 8)).toString()).toBe("FILEfile");
      // Range request over H3 hits the same FileResponseStream path
      const ranged = await curl3(port, "/file-route", ["-D", "-", "-H", "range: bytes=4-11"]);
      expect(ranged.stdout).toContain("HTTP/3 206");
      expect(ranged.stdout.split("\r\n\r\n")[1]).toBe("file" + "FILE");
      expect(exitCode).toBe(0);
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
// server (withServer) so they can run concurrently; everything goes through
// raw curl --http3-only so multi-URL/--parallel reuse a single QUIC connection.
describe("Bun.serve HTTP/3 adversarial", () => {
  const md5 = (b: Uint8Array | ArrayBuffer) => createHash("md5").update(Buffer.from(b)).digest("hex");

  itH3("64 concurrent streams on one connection", async () => {
    // h2o uses 1000; 64 stays inside lsquic's default initial-max-streams
    // and the debug-build 5s budget while still being 4× the existing
    // 16-concurrent coverage.
    await withServer(async port => {
      const N = 64;
      const url = `https://127.0.0.1:${port}/hello`;
      const proc = Bun.spawn({
        cmd: [
          curlH3!,
          "-sk",
          "--http3-only",
          "--connect-timeout",
          "10",
          "--max-time",
          "20",
          "--parallel",
          "--parallel-max",
          String(N),
          ...Array.from({ length: N }, () => url),
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const matches = stdout.match(/hello over h3/g) ?? [];
      expect(matches.length).toBe(N);
      expect(stdout.length).toBe("hello over h3".length * N);
      expect(exitCode).toBe(0);
    });
  });

  itH3("large request headers (7k value + 50×100B) reach handler", async () => {
    await withServer(async port => {
      const big = Buffer.alloc(7000, "H").toString();
      const small = Buffer.alloc(100, "v").toString();
      const args = ["-D", "-", "-H", `x-huge: ${big}`];
      for (let i = 0; i < 50; i++) args.push("-H", `x-h${i}: ${small}`);
      const { stdout, exitCode } = await curl3(port, "/headers", args);
      expect(stdout).toContain("HTTP/3 200");
      const body = stdout.slice(stdout.indexOf("\r\n\r\n") + 4);
      const seen = JSON.parse(body) as Record<string, string>;
      expect(seen["x-huge"]?.length).toBe(7000);
      for (let i = 0; i < 50; i++) expect(seen[`x-h${i}`]).toBe(small);
      expect(exitCode).toBe(0);
    });
  });

  itH3("8 MB POST body echoes byte-exact", async () => {
    await withServer(async port => {
      // Patterned (not crypto-random) so the test is deterministic but still
      // crosses many QUIC packets and stresses the recvmmsg/sendmmsg paths.
      const payload = Buffer.alloc(8 * 1024 * 1024);
      for (let i = 0; i < payload.length; i++) payload[i] = (i * 131) & 0xff;
      const { raw, exitCode } = await curl3(
        port,
        "/echo-bytes",
        ["--data-binary", "@-", "-H", "content-type: application/octet-stream"],
        { stdin: payload },
      );
      expect(raw.length).toBe(payload.length);
      expect(md5(raw)).toBe(md5(payload));
      expect(exitCode).toBe(0);
    });
  });

  itH3("slow client read (--limit-rate) drains streamed response", async () => {
    await withServer(async port => {
      // Body is tiny ("one two three") so 1 KB/s is fine; the point is the
      // server sees backpressure from the QUIC flow-control window and the
      // H3ResponseSink onWritable path completes instead of hanging.
      const { stdout, exitCode } = await curl3(port, "/stream", ["--limit-rate", "1k"]);
      expect(stdout).toBe("one two three");
      expect(exitCode).toBe(0);
    });
  });

  itH3("204 then 200 on the same connection", async () => {
    await withServer(async port => {
      const proc = Bun.spawn({
        cmd: [
          curlH3!,
          "-sk",
          "--http3-only",
          "-D",
          "-",
          `https://127.0.0.1:${port}/status`,
          `https://127.0.0.1:${port}/hello`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toContain("HTTP/3 204");
      expect(stdout).toContain("HTTP/3 200");
      expect(stdout).toContain("hello over h3");
      expect(exitCode).toBe(0);
    });
  });

  itH3("HEAD on /big returns content-length and no body", async () => {
    await withServer(async port => {
      const { stdout, raw, exitCode } = await curl3(port, "/big", ["-I"]);
      expect(stdout).toContain("HTTP/3 200");
      expect(stdout.toLowerCase()).toMatch(/content-length:\s*524288/);
      // -I writes only the header block to stdout; no body bytes follow.
      const headerEnd = stdout.indexOf("\r\n\r\n");
      expect(headerEnd).toBeGreaterThan(0);
      expect(raw.length - (headerEnd + 4)).toBeLessThanOrEqual(0);
      expect(exitCode).toBe(0);
    });
  });

  itH3("lying content-length doesn't take down the listener", async () => {
    await withServer(async port => {
      // RFC 9114 §4.1.2: a request whose payload doesn't match content-length
      // is malformed. lsquic/nghttp3 may RESET_STREAM here — we don't care
      // about the exact response, only that the process keeps serving.
      await curl3(port, "/echo", ["-X", "POST", "-H", "content-length: 5", "--data-binary", "@-"], {
        stdin: Buffer.alloc(100, "x"),
      });
      const { stdout, exitCode } = await curl3(port, "/hello");
      expect(stdout).toBe("hello over h3");
      expect(exitCode).toBe(0);
    });
  });

  itH3("client RST mid-/big does not break the listener", async () => {
    await withServer(async port => {
      // --limit-rate keeps curl reading at 10 KB/s so the 512 KB body is
      // guaranteed to be mid-drain when --max-time fires; pure --max-time
      // races the handshake (too short) or completes (too long). 2s leaves
      // handshake headroom under full-suite load while staying far below
      // the 51s a complete drain would need.
      const aborted = await curl3(port, "/big", ["--limit-rate", "10k", "--max-time", "2"]);
      expect(aborted.exitCode).not.toBe(0);
      expect(aborted.raw.length).toBeLessThan(512 * 1024);
      const { stdout, exitCode } = await curl3(port, "/hello");
      expect(stdout).toBe("hello over h3");
      expect(exitCode).toBe(0);
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
        curl3(port, "/transform", ["--data-binary", "@-", "-H", "content-type: application/octet-stream"], {
          stdin: b,
        }),
      ),
    );
    for (let i = 0; i < count; i++) {
      const { raw, exitCode } = results[i];
      expect(exitCode).toBe(0);
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
  // window. Separate curl process per stream = separate QUIC connection,
  // so this checks per-connection state isolation too. Aliasing bugs
  // reproduce at any N≥2; 8 fits the debug-build 5s default.
  itH3("per-stream body isolation: 8 concurrent 96KB transformed echoes", async () => {
    await withServer(port => isolationRound(port, 8, 96 * 1024));
  });

  // 3 × 300KB — forces Http3Response backpressure → onWritable → drain.
  itH3("per-stream body isolation: 3 concurrent 300KB transformed echoes", async () => {
    await withServer(port => isolationRound(port, 3, 300 * 1024));
  });

  itH3("Response(subprocess.stdout) streams over H3", async () => {
    await withServer(async port => {
      const { raw, exitCode } = await curl3(port, "/spawn");
      expect(raw.length).toBe(40 * 1001);
      const text = Buffer.from(raw).toString();
      const lines = text.split("\n").filter(Boolean);
      expect(lines.length).toBe(40);
      expect(lines.every(l => l === Buffer.alloc(1000, "x").toString())).toBe(true);
      expect(exitCode).toBe(0);
    });
  });

  itH3("Response(req.body) passthrough echoes byte-exact", async () => {
    await withServer(async port => {
      const body = new Uint8Array(randomBytes(80 * 1024));
      const { raw, stdout, exitCode } = await curl3(
        port,
        "/passthrough",
        ["-D", "-", "--data-binary", "@-", "-H", "content-type: application/octet-stream"],
        { stdin: body },
      );
      expect(stdout).toContain("HTTP/3 200");
      expect(stdout.toLowerCase()).toContain("x-passthrough: 1");
      const headerEnd = Buffer.from(raw).indexOf("\r\n\r\n");
      const payload = raw.subarray(headerEnd + 4);
      expect(payload.length).toBe(body.length);
      expect(md5(payload)).toBe(md5(body));
      expect(exitCode).toBe(0);
    });
  });

  itH3("req.{url,method,headers,params} survive micro/macrotask awaits", async () => {
    // uws.H3.Request lives on the on_stream_headers stack frame; the JS
    // Request must have copied everything before the first await returns.
    await withServer(async port => {
      const modes = ["none", "micro", "macro", "double"];
      const results = await Promise.all(
        modes.map(mode =>
          curl3(port, `/lifetime?d=${mode}`, ["-X", "POST", "-H", `x-probe: alive-${mode}`, "--data-binary", "@-"], {
            stdin: `payload-${mode}`,
          }),
        ),
      );
      for (let i = 0; i < modes.length; i++) {
        const mode = modes[i];
        const body = `payload-${mode}`;
        const { stdout, exitCode } = results[i];
        const out = JSON.parse(stdout) as {
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
        expect(out.bodyLen).toBe(body.length);
        expect(exitCode).toBe(0);
      }
      const { stdout, exitCode } = await curl3(port, "/lifetime/abc123");
      expect(stdout).toBe("abc123|abc123");
      expect(exitCode).toBe(0);
    });
  });

  itH3("Response(Bun.file().stream()) goes through H3ResponseSink", async () => {
    await withServer(async (port, dir) => {
      const { raw, exitCode } = await curl3(port, "/file-stream");
      expect(raw.length).toBe(200 * 1024);
      const onDisk = await Bun.file(join(dir, "big.bin")).bytes();
      expect(md5(raw)).toBe(md5(onDisk));
      expect(exitCode).toBe(0);
    });
  });

  // bughunt #4: canSendfile() must not pick the sendfile() path for H3 — it
  // has no socket fd. A 2 MB file is over the 1 MiB sendfile threshold.
  itH3("Bun.file >=1 MiB takes the reader path, not sendfile", async () => {
    await withServer(async port => {
      const { raw, exitCode } = await curl3(port, "/huge-file");
      expect(raw.length).toBe(2 * 1024 * 1024);
      expect(md5(raw)).toBe(md5(Buffer.alloc(2 * 1024 * 1024, "0123456789abcdef")));
      expect(exitCode).toBe(0);
    });
  });

  // bughunt #5: getRemoteSocketInfo must return a slice with a valid length.
  itH3("server.requestIP(req) returns the peer address", async () => {
    await withServer(async port => {
      const { stdout, exitCode } = await curl3(port, "/remote");
      const ip = JSON.parse(stdout);
      expect(ip.address).toBe("127.0.0.1");
      expect(ip.family).toBe("IPv4");
      expect(typeof ip.port).toBe("number");
      expect(exitCode).toBe(0);
    });
  });

  // bughunt #6: H3 bodies are FIN-terminated; Content-Length is optional.
  // `curl -T -` streams from stdin without setting Content-Length.
  itH3("POST body without Content-Length still reaches the handler", async () => {
    await withServer(async port => {
      const body = Buffer.alloc(40_000, "noCL");
      const { raw, stdout, exitCode } = await curl3(
        port,
        "/echo-bytes",
        ["-D", "-", "-X", "POST", "-H", "content-type: application/octet-stream", "-T", "-"],
        { stdin: body },
      );
      expect(stdout).toContain("HTTP/3 200");
      expect(stdout).toContain(`x-len: ${body.length}`);
      const got = raw.slice(raw.length - body.length);
      expect(md5(got)).toBe(md5(body));
      expect(exitCode).toBe(0);
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
  itH3("server.reload() clears stale H3 routes", async () => {
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
      const before = await curl3(port, "/old");
      expect(before.stdout).toBe("old-route");
      send("reload");
      await waitForStderr(/RELOADED/);
      const oldAfter = await curl3(port, "/old", ["-D", "-"]);
      expect(oldAfter.stdout).toContain("HTTP/3 404");
      expect(oldAfter.stdout).toContain("fallback");
      const newAfter = await curl3(port, "/new");
      expect(newAfter.stdout).toBe("new-route");
    });
  });

  // bughunt #3: server.stop() must not leave the lsquic engine pointing at a
  // freed listen-socket. The follow-up GET should cleanly fail to connect,
  // and the process must still be alive to exit 0 on its own.
  itH3("server.stop() with live H3 connections does not UAF", async () => {
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
      const ok = await curl3(port, "/");
      expect(ok.stdout).toBe("alive");
      send("stop");
      await waitForStderr(/STOPPED/);
      // port should now be dead — connect must fail, not hang
      const dead = await curl3(port, "/", ["--connect-timeout", "2"]);
      expect(dead.exitCode).not.toBe(0);
    });
  });

  // B: server.stop() (graceful) sends GOAWAY and lets in-flight H3 requests
  // finish before the engine tears down. lsquic_engine_cooldown drops mini
  // (still-handshaking) conns immediately, so we wait until the server has
  // actually entered every handler before stopping — no arbitrary sleep.
  itH3("graceful stop: in-flight H3 requests complete after server.stop()", async () => {
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
            await Bun.sleep(20);
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
      const inflight = Array.from({ length: N }, () => curl3(port, "/slow"));
      // Poll until the server has entered all N handlers (handshakes promoted),
      // then it's safe to cooldown — drop_all_mini_conns won't bite.
      while (true) {
        const r = await curl3(port, "/inflight");
        if (Number(r.stdout) >= N) break;
      }
      send("stop");
      const results = await Promise.all(inflight);
      for (const r of results) {
        expect(r.stdout).toBe("late");
        expect(r.exitCode).toBe(0);
      }
      // New connection during drain is rejected (engine cooling down).
      const fresh = await curl3(port, "/", ["--connect-timeout", "2", "--max-time", "3"]);
      expect(fresh.exitCode).not.toBe(0);
      send("exit");
    });
  });

  // Each QUIC connection counts as a virtual poll (loop->num_polls); after
  // server.stop() drains, the last conn close releases the UDP fd and the
  // loop has no polls left — the process exits without process.exit().
  itH3("h3-only server exits naturally after stop() drains", async () => {
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
    const ok = await curl3(port, "/");
    expect(ok.stdout).toBe("ok");
    proc.stdin!.write("stop\n");
    proc.stdin!.end();
    // No process.exit() in the script — exiting proves the QUIC poll refs
    // were released. Timeout would mean the UDP fd is still holding the loop.
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });

  // C: req.signal fires when the client resets the H3 stream mid-request.
  itH3("req.signal aborts on client RST", async () => {
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
      // --max-time 1 makes curl give up while the handler is awaiting the
      // abort; lsquic delivers STOP_SENDING/RESET → onAbort.
      const r = await curl3(port, "/hang", ["--max-time", "1"]);
      expect(r.exitCode).not.toBe(0);
      // The signal fires from on_stream_close, which runs on the next
      // process_conns tick after the RST lands.
      let count = "0";
      for (let i = 0; i < 30 && count === "0"; i++) {
        count = (await curl3(port, "/aborted")).stdout;
        if (count === "0") await Bun.sleep(50);
      }
      expect(Number(count)).toBeGreaterThan(0);
    });
  });
});

describe("Bun.serve HTTP/3 production", () => {
  // E: H1 responses advertise the H3 endpoint so browsers can discover it.
  itH3("Alt-Svc emitted on HTTP/1.1 responses when h3 is enabled", async () => {
    await withServer(async port => {
      const res = await fetch(`https://127.0.0.1:${port}/hello`, { tls: { rejectUnauthorized: false } });
      expect(res.status).toBe(200);
      const alt = res.headers.get("alt-svc") ?? "";
      expect(alt).toContain('h3=":');
      expect(alt).toContain(String(port));
    });
  });

  // RFC 9114 §4.2 forbids Transfer-Encoding; the server rejects it with 400
  // (server.zig prepareJsRequestContextFor). Not testable via curl —
  // nghttp3 strips the header client-side, as it must — so the check is
  // defense-in-depth against raw QUIC clients.

  // I: server.upgrade() returns false over H3 instead of crashing, and the
  // handler can still send a normal response.
  itH3("server.upgrade(req) over H3 returns false cleanly", async () => {
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
      const r = await curl3(port, "/");
      expect(r.stdout).toBe("upgrade=false");
      expect(r.exitCode).toBe(0);
    });
  });

  // Expect: 100-continue is handled at the uWS layer for both transports
  // (HttpContext.h / Http3Context.h call writeContinue before routing); a
  // curl --expect100-timeout assertion was flaky enough to drop here.
});
