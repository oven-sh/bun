import { gunzipSync, gzipSync, type Server } from "bun";
import { fetchH3Internals } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, expiredTls, isDebug, isLinux, tempDir, tls } from "harness";
import { createPrivateKey } from "node:crypto";
import { join } from "node:path";
import { listen, QuicError } from "node:quic";

// In-process server with `http1: false` so the build under test binds UDP only.
// A fetch that silently fell back to HTTP/1.1 would get ECONNREFUSED, which
// is what makes this suite prove `protocol: "http3"` actually works.
let server: Server<undefined>;
let base: string;
const big = Buffer.alloc(256 * 1024, "abcdefghijklmnop");
const { liveCounts } = fetchH3Internals;

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    tls,
    http3: true,
    http1: false,
    routes: {
      "/hello": () => new Response("hello over h3", { headers: { "x-proto": "h3" } }),
      "/echo": async req => {
        const body = await req.bytes();
        return new Response(body, {
          headers: {
            "x-method": req.method,
            "x-recv-len": String(body.length),
            "x-content-type": req.headers.get("content-type") ?? "",
            "x-custom": req.headers.get("x-custom") ?? "",
          },
        });
      },
      "/json": req => Response.json({ ok: true, q: new URL(req.url).searchParams.get("q") }),
      "/big": () => new Response(big),
      "/status": req => {
        const u = new URL(req.url);
        return new Response(u.searchParams.get("body"), { status: Number(u.searchParams.get("code")) });
      },
      "/gzip": () =>
        new Response(gzipSync("compressed body over h3"), {
          headers: { "content-encoding": "gzip", "content-type": "text/plain" },
        }),
      "/redirect": () => Response.redirect("/hello", 302),
      "/head": () => new Response("should not appear", { headers: { "x-head": "1" } }),
      "/route/:id": req => new Response("id=" + req.params.id, { headers: { "x-route": "param" } }),
      "/headers-echo": req => Response.json(Object.fromEntries(req.headers)),
      "/raw-echo": async req => {
        const raw = Buffer.from(await req.arrayBuffer());
        return new Response(raw, {
          headers: {
            "x-recv-len": String(raw.length),
            "x-recv-encoding": req.headers.get("content-encoding") ?? "",
            "x-recv-content-length": req.headers.get("content-length") ?? "",
          },
        });
      },

      // Response body driven by pull — one chunk per consumer read.
      "/pull": () => {
        const chunks = ["first;", "second;", "third;"];
        let i = 0;
        return new Response(
          new ReadableStream({
            pull(ctrl) {
              if (i < chunks.length) ctrl.enqueue(chunks[i++]);
              else ctrl.close();
            },
          }),
        );
      },

      // Response body via type:"direct" — controller.write/end, exercises the
      // sink fast-path on the server side.
      "/direct": () =>
        new Response(
          new ReadableStream({
            type: "direct",
            async pull(ctrl) {
              ctrl.write("alpha;");
              await Bun.sleep(1);
              ctrl.write("beta;");
              ctrl.write("gamma;");
              await ctrl.end();
            },
          }),
        ),

      "/direct-big": () =>
        new Response(
          new ReadableStream({
            type: "direct",
            async pull(ctrl) {
              for (let i = 0; i < 8; i++) {
                ctrl.write(big.subarray(0, 32 * 1024));
                await ctrl.flush();
              }
              await ctrl.end();
            },
          }),
        ),

      // Read the request stream chunk-by-chunk and echo upper-cased through a
      // pull-driven response — full-duplex without buffering either side.
      "/bidi": req => {
        const reader = req.body!.getReader();
        let i = 0;
        return new Response(
          new ReadableStream({
            async pull(ctrl) {
              const { value, done } = await reader.read();
              if (done) {
                ctrl.enqueue("[end]");
                ctrl.close();
                return;
              }
              ctrl.enqueue(`[${i++}:${Buffer.from(value).toString().toUpperCase()}]`);
            },
          }),
          { headers: { "x-bidi": "1" } },
        );
      },

      // Same shape, but the response uses type:"direct".
      "/bidi-direct": req => {
        const reader = req.body!.getReader();
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(ctrl) {
              while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                ctrl.write(value);
                await ctrl.flush();
              }
              await ctrl.end();
            },
          }),
        );
      },

      // Per-chunk byte checksum so the client can correlate request chunks
      // to response bytes without depending on stream framing.
      "/bidi-bytes": req => {
        const reader = req.body!.getReader();
        return new Response(
          new ReadableStream({
            async pull(ctrl) {
              const { value, done } = await reader.read();
              if (done) return ctrl.close();
              let sum = 0;
              for (const b of value) sum = (sum + b) & 0xff;
              ctrl.enqueue(new Uint8Array([sum]));
            },
          }),
        );
      },
    },
    fetch: () => new Response("not found", { status: 404 }),
  });
  base = `https://127.0.0.1:${server.port}`;

  // Gate the suite: plain HTTPS over TCP must be refused.
  let tcpReached = false;
  try {
    await fetch(`${base}/hello`, { tls: { rejectUnauthorized: false } });
    tcpReached = true;
  } catch {}
  if (tcpReached) throw new Error("server accepted TCP; http1:false not honoured — suite would not prove HTTP/3");
});

// Don't await: the H3 client's pooled session to this origin stays open
// until lsquic's idle timeout, so stop(true) would block on it draining.
afterAll(() => void server?.stop(true));

const h3 = { protocol: "http3", tls: { rejectUnauthorized: false } } as const;

// Request body that emits one entry per pull() call.
function pullBody(chunks: (string | Uint8Array)[]) {
  let i = 0;
  return new ReadableStream({
    pull(ctrl) {
      if (i < chunks.length) ctrl.enqueue(chunks[i++]);
      else ctrl.close();
    },
  });
}

describe("fetch protocol: http3", () => {
  test("GET text", async () => {
    const res = await fetch(`${base}/hello`, h3);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-proto")).toBe("h3");
    expect(await res.text()).toBe("hello over h3");
  });

  test("'h3' alias", async () => {
    const res = await fetch(`${base}/hello`, { ...h3, protocol: "h3" });
    expect(await res.text()).toBe("hello over h3");
  });

  test("POST echo with headers", async () => {
    const res = await fetch(`${base}/echo`, {
      ...h3,
      method: "POST",
      body: "hello body",
      headers: { "content-type": "text/custom", "X-Custom": "abc" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-method")).toBe("POST");
    expect(res.headers.get("x-recv-len")).toBe("10");
    expect(res.headers.get("x-content-type")).toBe("text/custom");
    expect(res.headers.get("x-custom")).toBe("abc");
    expect(await res.text()).toBe("hello body");
  });

  test("JSON + query string", async () => {
    const res = await fetch(`${base}/json?q=h3`, h3);
    expect(await res.json()).toEqual({ ok: true, q: "h3" });
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  test("route params", async () => {
    const res = await fetch(`${base}/route/42`, h3);
    expect(res.headers.get("x-route")).toBe("param");
    expect(await res.text()).toBe("id=42");
  });

  test("large response body (multi-packet)", async () => {
    const res = await fetch(`${base}/big`, h3);
    const buf = await res.bytes();
    expect(buf.length).toBe(big.length);
    expect(Buffer.from(buf).equals(big)).toBe(true);
  });

  test("large request body", async () => {
    const payload = Buffer.alloc(128 * 1024, "Q");
    const res = await fetch(`${base}/echo`, { ...h3, method: "POST", body: payload });
    expect(res.headers.get("x-recv-len")).toBe(String(payload.length));
    expect(Buffer.from(await res.bytes()).equals(payload)).toBe(true);
  });

  test.each([
    ["small (shared-buffer fast path)", 32 * 1024],
    ["large (zlib-streaming spill path)", 600 * 1024],
  ])("compress: gzip request body — %s", async (_, size) => {
    const payload = Buffer.alloc(size, "abcdefghij");
    const res = await fetch(`${base}/raw-echo`, {
      ...h3,
      method: "POST",
      body: payload,
      compress: "gzip",
    });
    const raw = Buffer.from(await res.bytes());
    expect(res.headers.get("x-recv-encoding")).toBe("gzip");
    expect(Number(res.headers.get("x-recv-len"))).toBeLessThan(size);
    expect(res.headers.get("x-recv-content-length")).toBe(String(raw.length));
    expect(Buffer.from(gunzipSync(raw)).equals(payload)).toBe(true);
  });

  test.each([200, 204, 404, 500])("status %d", async code => {
    const res = await fetch(`${base}/status?code=${code}&body=${code === 204 ? "" : "x"}`, h3);
    expect(res.status).toBe(code);
    expect(await res.text()).toBe(code === 204 ? "" : "x");
  });

  test("HEAD has no body", async () => {
    const res = await fetch(`${base}/head`, { ...h3, method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-head")).toBe("1");
    expect(await res.text()).toBe("");
  });

  test("TRACE has a body", async () => {
    const res = await fetch(`${base}/hello`, { ...h3, method: "TRACE" });
    expect({ status: res.status, text: await res.text() }).toEqual({ status: 200, text: "hello over h3" });
  });

  test.each([
    ["a 204", "/status?code=204&body=", {}],
    ["a 304", "/status?code=304&body=", {}],
    ["a HEAD request", "/head", { method: "HEAD" }],
  ])("the response to %s has a null body", async (_, path, init) => {
    const res = await fetch(`${base}${path}`, { ...h3, ...init });
    expect({
      body: res.body,
      text: await res.text(),
      bodyUsed: res.bodyUsed,
      cloneBody: res.clone().body,
    }).toEqual({ body: null, text: "", bodyUsed: false, cloneBody: null });
  });

  test("gzip response is decompressed", async () => {
    const res = await fetch(`${base}/gzip`, h3);
    expect(await res.text()).toBe("compressed body over h3");
  });

  test("redirect follow", async () => {
    const res = await fetch(`${base}/redirect`, h3);
    expect(res.status).toBe(200);
    expect(res.redirected).toBe(true);
    expect(await res.text()).toBe("hello over h3");
  });

  test("pull-driven response body", async () => {
    const res = await fetch(`${base}/pull`, h3);
    expect(await res.text()).toBe("first;second;third;");
  });

  test("type:direct response body", async () => {
    const res = await fetch(`${base}/direct`, h3);
    expect(await res.text()).toBe("alpha;beta;gamma;");
  });

  test("type:direct large response", async () => {
    const res = await fetch(`${base}/direct-big`, h3);
    const buf = await res.bytes();
    expect(buf.length).toBe(8 * 32 * 1024);
    expect(Bun.hash(buf)).toBe(Bun.hash(Buffer.concat(Array.from({ length: 8 }, () => big.subarray(0, 32 * 1024)))));
  });

  test("response consumed via reader", async () => {
    const res = await fetch(`${base}/pull`, h3);
    let out = "";
    for await (const chunk of res.body!) out += Buffer.from(chunk);
    expect(out).toBe("first;second;third;");
  });

  test("concurrent requests multiplex on one connection", async () => {
    const n = 16;
    const results = await Promise.all(
      Array.from({ length: n }, (_, i) => fetch(`${base}/json?q=${i}`, h3).then(r => r.json())),
    );
    for (let i = 0; i < n; i++) expect(results[i]).toEqual({ ok: true, q: String(i) });
  });

  test("sequential requests reuse the connection", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${base}/hello`, h3);
      expect(await res.text()).toBe("hello over h3");
    }
  });

  test("a FetchSession has its own connection, and close() closes it once idle", async () => {
    using one = new Bun.FetchSession();
    using other = new Bun.FetchSession();
    const text = (session: Bun.FetchSession) => fetch(`${base}/hello`, { ...h3, session }).then(r => r.text());
    const before = liveCounts().sessions;
    expect(await text(one)).toBe("hello over h3");
    expect(await text(one)).toBe("hello over h3");
    expect(liveCounts().sessions).toBe(before + 1);
    expect(await text(other)).toBe("hello over h3");
    expect(liveCounts().sessions).toBe(before + 2);
    one.close();
    while (liveCounts().sessions !== before + 1) await new Promise(resolve => setImmediate(resolve));
    // `other` still has its connection.
    expect(await text(other)).toBe("hello over h3");
    expect(liveCounts().sessions).toBe(before + 1);
  });

  test("50 concurrent requests", async () => {
    const n = 50;
    const results = await Promise.all(
      Array.from({ length: n }, (_, i) => fetch(`${base}/route/${i}`, h3).then(r => r.text())),
    );
    for (let i = 0; i < n; i++) expect(results[i]).toBe(`id=${i}`);
  });

  test("http:// rejects with HTTP3Unsupported", async () => {
    await expect(fetch(`http://127.0.0.1:${server.port}/hello`, h3)).rejects.toThrow();
  });

  test("Uint8Array body", async () => {
    const body = new Uint8Array([0, 1, 2, 254, 255]);
    const res = await fetch(`${base}/echo`, { ...h3, method: "POST", body });
    expect(await res.bytes()).toEqual(body);
  });

  test("empty POST body", async () => {
    const res = await fetch(`${base}/echo`, { ...h3, method: "POST", body: "" });
    expect(res.headers.get("x-recv-len")).toBe("0");
    expect(await res.text()).toBe("");
  });

  test("DELETE without body", async () => {
    const res = await fetch(`${base}/echo`, { ...h3, method: "DELETE" });
    expect(res.headers.get("x-method")).toBe("DELETE");
    expect(res.headers.get("x-recv-len")).toBe("0");
  });

  test("PUT and DELETE methods", async () => {
    for (const method of ["PUT", "DELETE"] as const) {
      const res = await fetch(`${base}/echo`, { ...h3, method, body: method });
      expect(res.headers.get("x-method")).toBe(method);
      expect(await res.text()).toBe(method);
    }
  });

  test("long path + many request headers (>32)", async () => {
    const path = "/echo?" + Buffer.alloc(2000, "p").toString();
    const headers: Record<string, string> = {};
    for (let i = 0; i < 40; i++) headers[`x-h${i}`] = `v${i}`;
    const res = await fetch(`${base}${path}`, { ...h3, method: "POST", body: "x", headers });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-recv-len")).toBe("1");
  });

  // Regression: src/uws_sys/quic/Header.zig defines `Qpack = enum(u8) { ... _ }`
  // (non-exhaustive — any u8 is a valid value). The Rust port uses an exhaustive
  // `#[repr(u8)] enum`, so the only safety net against discriminant drift / a UB
  // `from_raw` is that every named index must equal its RFC 9204 Appendix A
  // static-table entry. This pins that contract end-to-end: each header below
  // hits `Qpack::classify` → `qpack_index` → lsqpack encode → wire → server
  // decode. A wrong discriminant makes lsqpack emit the wrong static-table
  // name (or garbage), so the echoed value disappears.
  test("QPACK static-table indexed headers round-trip", async () => {
    // Every `Class::Indexed` entry in Header.zig's classify map, minus
    // content-length / accept-encoding (build_request rewrites those).
    // Mixed case on a few to exercise the case-insensitive lookup.
    const sent: Record<string, string> = {
      "accept": "application/qpack-test",
      "Accept-Language": "zz-ZZ",
      "accept-ranges": "none",
      "Authorization": "Bearer qpack-84",
      "cache-control": "no-store",
      "Content-Disposition": "inline",
      "content-encoding": "identity",
      "content-type": "text/plain",
      "cookie": "qpack=5",
      "date": "Mon, 01 Jan 2001 00:00:00 GMT",
      "ETag": '"qpack-7"',
      "forwarded": "for=127.0.0.1",
      "If-Modified-Since": "Mon, 01 Jan 2001 00:00:00 GMT",
      "if-none-match": '"qpack-9"',
      "if-range": '"qpack-89"',
      "last-modified": "Mon, 01 Jan 2001 00:00:00 GMT",
      "link": "</a>; rel=preload",
      "location": "/qpack-12",
      "Origin": "https://qpack.test",
      "range": "bytes=0-0",
      "Referer": "https://qpack.test/13",
      "server": "qpack-92",
      "set-cookie": "k=v",
      "User-Agent": "qpack-ua/95",
      "vary": "qpack-59",
      "X-Forwarded-For": "10.0.0.96",
      // Not in the static table — exercises the `classify() == None` lowercase path.
      "X-Unindexed-Probe": "fallthrough",
    };
    const res = await fetch(`${base}/headers-echo`, { ...h3, headers: sent });
    expect(res.status).toBe(200);
    const got = (await res.json()) as Record<string, string>;
    for (const [name, value] of Object.entries(sent)) {
      expect(got[name.toLowerCase()]).toBe(value);
    }
  });

  test("response consumed as blob / bytes", async () => {
    const r1 = await fetch(`${base}/hello`, h3);
    expect(await r1.blob().then(b => b.text())).toBe("hello over h3");
    const r2 = await fetch(`${base}/hello`, h3);
    expect(Buffer.from(await r2.bytes()).toString()).toBe("hello over h3");
  });

  test("AbortController during response body", async () => {
    const ac = new AbortController();
    const p = fetch(`${base}/pull`, { ...h3, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow();
  });

  test("connection failure rejects", async () => {
    using closed = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const port = closed.port;
    closed.stop(true);
    await expect(fetch(`https://127.0.0.1:${port}/`, { ...h3, signal: AbortSignal.timeout(2000) })).rejects.toThrow();
  });

  test("invalid protocol value throws", () => {
    expect(() => fetch(`${base}/hello`, { protocol: "spdy" } as any)).toThrow(/protocol/);
  });

  test("1MB request → 1MB response round-trip", async () => {
    const payload = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < payload.length; i++) payload[i] = i & 0xff;
    const res = await fetch(`${base}/echo`, { ...h3, method: "POST", body: payload });
    expect(res.headers.get("x-recv-len")).toBe(String(payload.length));
    const out = await res.bytes();
    expect(out.length).toBe(payload.length);
    expect(Buffer.from(out).equals(payload)).toBe(true);
  });

  test("hostname (DNS path) instead of IP literal", async () => {
    const res = await fetch(`https://localhost:${server.port}/hello`, h3);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello over h3");
  });

  test("rejectUnauthorized: true fails self-signed cert", async () => {
    await expect(
      fetch(`${base}/hello`, { protocol: "http3", tls: { rejectUnauthorized: true } } as any),
    ).rejects.toThrow();
  });

  test("rejectUnauthorized defaults to true and fails self-signed cert", async () => {
    await expect(fetch(`${base}/hello`, { protocol: "http3" } as any)).rejects.toThrow();
  });

  test("a trusted certificate with a blocked public key fails the handshake", async () => {
    using dir = tempDir("h3-blocked-key", { "ca.pem": tls.cert });
    const script = /* js */ `
      import { addBlockedSPKIForTesting } from "bun:internal-for-testing";
      import { createHash, X509Certificate } from "node:crypto";
      import { readFileSync } from "node:fs";
      if (process.env.H3_BLOCK_KEY) {
        const cert = new X509Certificate(readFileSync(process.env.NODE_EXTRA_CA_CERTS));
        addBlockedSPKIForTesting(
          createHash("sha256").update(cert.publicKey.export({ type: "spki", format: "der" })).digest(),
        );
      }
      console.log(await fetch(process.env.H3_URL, { protocol: "http3" }).then(res => res.text(), err => err.code));
    `;
    async function run(env: Record<string, string>) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: { ...bunEnv, NODE_EXTRA_CA_CERTS: join(String(dir), "ca.pem"), H3_URL: `${base}/hello`, ...env },
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      return { stdout: stdout.trim(), exitCode };
    }
    expect(await Promise.all([run({}), run({ H3_BLOCK_KEY: "1" })])).toEqual([
      { stdout: "hello over h3", exitCode: 0 },
      { stdout: "HTTP3HandshakeFailed", exitCode: 0 },
    ]);
  });

  test("session retired on GOAWAY: rapid serve/stop cycles", async () => {
    // Each stop(true) sends GOAWAY; the client must mark the pooled session
    // unusable so the next fetch (new port → new session) isn't disrupted by
    // the draining ones still on the shared UDP socket.
    for (let i = 0; i < 30; i++) {
      const s = Bun.serve({ port: 0, tls, http3: true, http1: false, routes: { "/n": () => new Response(String(i)) } });
      const res = await fetch(`https://127.0.0.1:${s.port}/n`, h3);
      expect(await res.text()).toBe(String(i));
      s.stop(true);
    }
  });

  // ───── streaming uploads (pull-driven request bodies) ─────

  test("ReadableStream request body (pull)", async () => {
    const res = await fetch(`${base}/echo`, {
      ...h3,
      method: "POST",
      body: pullBody(["hello ", "from ", "a ", "stream"]),
    });
    expect(res.headers.get("x-recv-len")).toBe("19");
    expect(await res.text()).toBe("hello from a stream");
  });

  test("ReadableStream request body that does not match its declared content-length rejects", async () => {
    const outcomes: unknown[] = [];
    for (const declared of ["19", "2", "50"]) {
      // An origin of its own per case: resetting an upload that declared a
      // content-length can take the whole pooled QUIC session down with it.
      await using origin = Bun.serve({
        port: 0,
        tls,
        http3: true,
        http1: false,
        fetch: async req => new Response(await req.bytes()),
      });
      outcomes.push(
        await fetch(`https://127.0.0.1:${origin.port}/echo`, {
          ...h3,
          method: "POST",
          headers: { "content-length": declared },
          body: pullBody(["hello ", "from ", "a ", "stream"]),
        }).then(
          res => res.text(),
          e => e.code,
        ),
      );
    }
    expect(outcomes).toEqual([
      "hello from a stream",
      "ERR_HTTP_CONTENT_LENGTH_MISMATCH",
      "ERR_HTTP_CONTENT_LENGTH_MISMATCH",
    ]);
  });

  test("ReadableStream request body (pull, large)", async () => {
    const piece = Buffer.alloc(32 * 1024, "S");
    const res = await fetch(`${base}/echo`, {
      ...h3,
      method: "POST",
      body: pullBody(Array.from({ length: 8 }, () => piece)),
    });
    expect(res.headers.get("x-recv-len")).toBe(String(piece.length * 8));
    const out = await res.bytes();
    expect(out.length).toBe(piece.length * 8);
    expect(Buffer.from(out.subarray(0, piece.length)).equals(piece)).toBe(true);
  });

  test("ReadableStream request body (type:direct)", async () => {
    const res = await fetch(`${base}/echo`, {
      ...h3,
      method: "POST",
      body: new ReadableStream({
        type: "direct",
        async pull(ctrl) {
          ctrl.write("hello ");
          await ctrl.flush();
          ctrl.write("direct ");
          ctrl.write("upload");
          await ctrl.end();
        },
      }),
    });
    expect(res.headers.get("x-recv-len")).toBe("19");
    expect(await res.text()).toBe("hello direct upload");
  });

  // ───── bidirectional ─────

  test("bidi: pull request → pull response", async () => {
    const res = await fetch(`${base}/bidi`, {
      ...h3,
      method: "POST",
      body: pullBody(["alpha", "bravo", "charlie", "delta"]),
    });
    expect(res.headers.get("x-bidi")).toBe("1");
    const text = await res.text();
    // QUIC delivers a byte stream — server may coalesce reads, so reassemble.
    expect(text.endsWith("[end]")).toBe(true);
    const payload = [...text.matchAll(/\[\d+:([A-Z]+)\]/g)].map(m => m[1]).join("");
    expect(payload).toBe("ALPHABRAVOCHARLIEDELTA");
  });

  test("bidi: server starts responding before upload finishes", async () => {
    // The second pull() awaits a deferred that's only released after the
    // client has read the first echoed chunk. If either side buffered the
    // whole request before responding, the first read would deadlock.
    const { promise, resolve } = Promise.withResolvers<void>();
    let i = 0;
    const body = new ReadableStream({
      async pull(ctrl) {
        if (i === 0) {
          i++;
          ctrl.enqueue("first");
        } else if (i === 1) {
          i++;
          await promise;
          ctrl.enqueue("second");
        } else ctrl.close();
      },
    });
    const res = await fetch(`${base}/bidi`, { ...h3, method: "POST", body });
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    expect(Buffer.from(value!).toString()).toContain("FIRST");
    resolve();
    let assembled = Buffer.from(value!).toString();
    while (true) {
      const { value: v, done } = await reader.read();
      if (done) break;
      assembled += Buffer.from(v!).toString();
    }
    const payload = [...assembled.matchAll(/\[\d+:([A-Z]+)\]/g)].map(m => m[1]).join("");
    expect(payload).toBe("FIRSTSECOND");
    expect(assembled.endsWith("[end]")).toBe(true);
  });

  // The first chunk waits until the handler runs, so the request headers have
  // to leave on their own. A client that holds them until it has body bytes
  // never reaches the handler, and the test times out. The two requests cover
  // a new connection and a reused one.
  test("bidi: the request headers leave before the first body chunk exists", async () => {
    let handlerRuns = Promise.withResolvers<void>();
    using origin = Bun.serve({
      port: 0,
      tls,
      http3: true,
      http1: false,
      async fetch(req) {
        handlerRuns.resolve();
        return new Response("got:" + (await req.text()));
      },
    });
    const bodies: string[] = [];
    for (const chunk of ["first-connection", "same-connection"]) {
      handlerRuns = Promise.withResolvers<void>();
      const body = new ReadableStream({
        async pull(ctrl) {
          await handlerRuns.promise;
          ctrl.enqueue(chunk);
          ctrl.close();
        },
      });
      const res = await fetch(`https://127.0.0.1:${origin.port}/`, { ...h3, method: "POST", body });
      bodies.push(await res.text());
    }
    expect(bodies).toEqual(["got:first-connection", "got:same-connection"]);
  });

  test("bidi: type:direct on both sides", async () => {
    const piece = Buffer.alloc(4096, "D");
    const body = new ReadableStream({
      type: "direct",
      async pull(ctrl) {
        for (let i = 0; i < 16; i++) {
          ctrl.write(piece);
          await ctrl.flush();
        }
        await ctrl.end();
      },
    });
    const res = await fetch(`${base}/bidi-direct`, { ...h3, method: "POST", body });
    const out = await res.bytes();
    expect(out.length).toBe(16 * piece.length);
    expect(out.every(b => b === 0x44)).toBe(true);
  });

  test("bidi: binary per-chunk checksum", async () => {
    const chunks = Array.from({ length: 10 }, (_, i) => {
      const a = new Uint8Array(1024);
      for (let j = 0; j < a.length; j++) a[j] = (i * 7 + j) & 0xff;
      return a;
    });
    const expected = chunks.map(c => c.reduce((s, b) => (s + b) & 0xff, 0));
    const res = await fetch(`${base}/bidi-bytes`, { ...h3, method: "POST", body: pullBody(chunks) });
    const out = await res.bytes();
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(chunks.length);
    expect(out.reduce((s, b) => (s + b) & 0xff, 0)).toBe(expected.reduce((s, b) => (s + b) & 0xff, 0));
  });

  test("bidi: 32 chunks × 8KB", async () => {
    const piece = Buffer.alloc(8 * 1024, "B");
    const res = await fetch(`${base}/bidi`, {
      ...h3,
      method: "POST",
      body: pullBody(Array.from({ length: 32 }, () => piece)),
    });
    const text = await res.text();
    expect(text.endsWith("[end]")).toBe(true);
    const totalB = (text.match(/B/g) ?? []).length;
    expect(totalB).toBe(32 * piece.length);
  });
});

// An aborted upload must end with RESET_STREAM. A FIN tells the server that the
// truncated body is the whole body. If the request declared a content-length,
// the server's lsquic answers that FIN by closing the whole connection.
describe("aborted upload", () => {
  let server: Server<undefined>;
  let origin: string;
  let firstChunkRead: PromiseWithResolvers<void>;
  let serverSaw: PromiseWithResolvers<{ body: string; received: number; contentLength: string | null }>;
  let holdRelease: PromiseWithResolvers<void>;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      tls,
      http3: true,
      http1: false,
      routes: {
        "/echo": async req => new Response(await req.bytes()),
        // Sends "first;" at once, and "last;" after `holdRelease`.
        "/hold": () => {
          let pulls = 0;
          return new Response(
            new ReadableStream({
              async pull(ctrl) {
                if (pulls++ === 0) return ctrl.enqueue("first;");
                await holdRelease.promise;
                ctrl.enqueue("last;");
                ctrl.close();
              },
            }),
          );
        },
        // Reports how the request body ended: "complete" after FIN, "aborted" after a reset.
        "/upload": async req => {
          let body = "complete";
          let received = 0;
          try {
            for await (const chunk of req.body!) {
              received += chunk.length;
              firstChunkRead.resolve();
            }
          } catch {
            body = "aborted";
          }
          serverSaw.resolve({ body, received, contentLength: req.headers.get("content-length") });
          return new Response("ok");
        },
      },
    });
    origin = `https://127.0.0.1:${server.port}`;
  });
  afterAll(() => void server?.stop(true));

  // Streams "hello " and aborts after the server has read it.
  async function abortUpload(headers: Record<string, string> = {}) {
    firstChunkRead = Promise.withResolvers();
    serverSaw = Promise.withResolvers();
    const controller = new AbortController();
    let pulls = 0;
    const upload = fetch(`${origin}/upload`, {
      ...h3,
      method: "POST",
      headers,
      signal: controller.signal,
      body: new ReadableStream({
        async pull(ctrl) {
          if (pulls++ === 0) return ctrl.enqueue("hello ");
          await firstChunkRead.promise;
          controller.abort();
        },
      }),
    });
    await expect(upload).rejects.toMatchObject({ name: "AbortError" });
  }

  test("the server sees an abort, not the end of the body", async () => {
    await abortUpload();
    expect(await serverSaw.promise).toEqual({ body: "aborted", received: 6, contentLength: null });
  });

  test("with a declared content-length, the pooled session stays usable", async () => {
    holdRelease = Promise.withResolvers();
    try {
      // This response stays open on the pooled session while the upload is
      // aborted. Its headers are in, so the client cannot move it to another
      // session: it completes only if the server keeps the connection.
      const held = await fetch(`${origin}/hold`, h3);
      await abortUpload({ "content-length": "50" });
      // The next request has a stream body on purpose. The client re-sends any
      // other body on a fresh session, and that would hide a dead pooled session.
      const piece = Buffer.alloc(32 * 1024, "S");
      const res = await fetch(`${origin}/echo`, {
        ...h3,
        method: "POST",
        body: pullBody(Array.from({ length: 8 }, () => piece)),
      });
      expect((await res.bytes()).length).toBe(8 * piece.length);
      // The held response is released only after the server has seen the upload
      // end. Released sooner, it completes before the server closes anything.
      expect(await serverSaw.promise).toEqual({ body: "aborted", received: 6, contentLength: "50" });
      holdRelease.resolve();
      expect(await held.text()).toBe("first;last;");
    } finally {
      holdRelease.resolve();
    }
  });
});

// A response can carry any number of 1xx header blocks ahead of the final one
// (RFC 9114 section 4.1). Bun.serve sends one at most, so a node:quic server is
// the origin here. It writes every block in one call, so they reach the client
// in one STREAM frame.
describe("interim responses ahead of the final response", () => {
  const encoder = new TextEncoder();
  const listenOrigin = () =>
    listen(
      async (session: any) => {
        session.onstream = (stream: any) => stream.closed.catch(() => {});
        await session.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [createPrivateKey(tls.key)], certs: [Buffer.from(tls.cert)] } },
        transportParams: { maxIdleTimeout: 5 },
        onheaders(this: any, received: NodeJS.Dict<string | string[]>) {
          this.sendInformationalHeaders({ ":status": "100" });
          this.sendInformationalHeaders({ ":status": "103", link: "</style.css>; rel=preload" });
          if (received[":path"] === "/no-body") {
            this.sendHeaders({ ":status": "204", "x-final": "yes" }, { terminal: true });
            return;
          }
          this.sendHeaders({ ":status": "200", "x-final": "yes" });
          this.writer.writeSync(encoder.encode("hello"));
          this.writer.endSync();
        },
      },
    );

  test.each([
    ["/no-body", { status: 204, final: "yes", body: "" }],
    ["/body", { status: 200, final: "yes", body: "hello" }],
  ])("100 and 103, then the final response of %s", async (path, expected) => {
    const origin = await listenOrigin();
    try {
      const res = await fetch(`https://127.0.0.1:${origin.address!.port}${path}`, h3);
      expect({ status: res.status, final: res.headers.get("x-final"), body: await res.text() }).toEqual(expected);
    } finally {
      // Not close(): it waits for the session that fetch() keeps in its pool.
      await origin.destroy();
    }
  });
});

// A response `:status` is three digits from 100 to 999, and never 101, which
// HTTP/3 doesn't have (RFC 9114 section 4.5). The origin answers every request
// with one header block that ends the stream.
describe("response :status", () => {
  async function probe(status: string) {
    let requests = 0;
    const origin = await listen(
      async (session: any) => {
        session.onstream = (stream: any) => stream.closed.catch(() => {});
        await session.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [createPrivateKey(tls.key)], certs: [Buffer.from(tls.cert)] } },
        transportParams: { maxIdleTimeout: 5 },
        onheaders(this: any) {
          requests++;
          this.sendHeaders({ ":status": status }, { terminal: true });
        },
      },
    );
    try {
      const result = await fetch(`https://127.0.0.1:${origin.address!.port}/`, h3).then(
        res => res.status,
        e => e.code,
      );
      return { result, requests };
    } finally {
      // Not close(): it waits for the session that fetch() keeps in its pool.
      await origin.destroy();
    }
  }

  // Treated as interim, a lone 101 ends the stream with no final response and the request is retried.
  test.each(["101", "99", "1000", "+200", "2_00"])("%j fails the request without a retry", async status => {
    expect(await probe(status)).toEqual({ result: "HTTP3ProtocolError", requests: 1 });
  });

  test("999 is delivered", async () => {
    expect(await probe("999")).toEqual({ result: 999, requests: 1 });
  });
});

// QPACK carries a field value verbatim, so a server can send the optional
// whitespace that the HTTP/1.1 parser strips (RFC 9110 section 5.5). The
// client decodes through the same header-set callback as the server listener.
test("strips leading and trailing whitespace from a response field value", async () => {
  const origin = await listen(
    async (session: any) => {
      session.onstream = (stream: any) => stream.closed.catch(() => {});
      await session.closed.catch(() => {});
    },
    {
      sni: { "*": { keys: [createPrivateKey(tls.key)], certs: [Buffer.from(tls.cert)] } },
      transportParams: { maxIdleTimeout: 5 },
      onheaders(this: any) {
        this.sendHeaders(
          { ":status": "204", "x-ws": " \tv\t ", "x-only-ws": " \t ", "x-inner": "a \t b" },
          { terminal: true },
        );
      },
    },
  );
  try {
    const { headers } = await fetch(`https://127.0.0.1:${origin.address!.port}/`, h3);
    expect({
      ws: headers.get("x-ws"),
      onlyWs: headers.get("x-only-ws"),
      inner: headers.get("x-inner"),
    }).toEqual({ ws: "v", onlyWs: "", inner: "a \t b" });
  } finally {
    // Not close(): it waits for the session that fetch() keeps in its pool.
    await origin.destroy();
  }
});

test("a response header set over the size limit fails that request and no other on the connection", async () => {
  const held = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let heldRequests = 0;
  await using origin = Bun.serve({
    port: 0,
    tls,
    http3: true,
    http1: false,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/held") {
        heldRequests++;
        held.resolve();
        await release.promise;
        return new Response("held");
      }
      const headers = new Headers();
      for (const cookie of cookiesOfSize(Number(pathname.slice(1)))) headers.append("set-cookie", cookie);
      return new Response(null, { headers });
    },
  });
  // RFC 9114 section 4.2.2 counts the name, the value and 32 more bytes for each field.
  const sizeOf = (name: string, value: string) => name.length + value.length + 32;
  // Empty cookies, and a last one that takes the remainder.
  function cookiesOfSize(size: number) {
    const count = Math.floor(size / sizeOf("set-cookie", ""));
    const cookies: string[] = Array(count).fill("");
    if (count > 0) cookies[count - 1] = Buffer.alloc(size % sizeOf("set-cookie", ""), "v").toString();
    return cookies;
  }

  const other = fetch(`${origin.url}held`, h3);
  await held.promise;
  // What a response carries besides the cookies.
  const rest = [...(await fetch(`${origin.url}0`, h3)).headers].reduce(
    (size, [name, value]) => size + sizeOf(name, value),
    sizeOf(":status", "200"),
  );
  const atTheLimit = 256 * 1024 - rest;
  const served = await fetch(`${origin.url}${atTheLimit}`, h3);
  expect(served.headers.getSetCookie()).toEqual(cookiesOfSize(atTheLimit));
  const refused = await fetch(`${origin.url}${atTheLimit + 1}`, h3).then(
    res => res.status,
    err => err.code,
  );
  expect(refused).toBe("ResponseHeadersTooLarge");
  release.resolve();
  expect(await (await other).text()).toBe("held");
  // A closed connection would have sent it again on a new one.
  expect(heldRequests).toBe(1);
});

test("a response header value of more than 64 KB is delivered, up to the size limit", async () => {
  await using origin = Bun.serve({
    port: 0,
    tls,
    http3: true,
    http1: false,
    fetch(req) {
      const length = Number(new URL(req.url).pathname.slice(1));
      return new Response(null, { headers: { "x-value": Buffer.alloc(length, "v").toString() } });
    },
  });
  // RFC 9114 section 4.2.2 counts the name, the value and 32 more bytes for each field.
  const rest = [...(await fetch(`${origin.url}0`, h3)).headers].reduce(
    (size, [name, value]) => size + name.length + value.length + 32,
    ":status".length + "200".length + 32,
  );
  const atTheLimit = 256 * 1024 - rest;
  const outcome = (length: number) =>
    fetch(`${origin.url}${length}`, h3).then(
      res => res.headers.get("x-value") === Buffer.alloc(length, "v").toString(),
      err => err.code,
    );
  expect({
    value70000: await outcome(70_000),
    atTheLimit: await outcome(atTheLimit),
    overTheLimit: await outcome(atTheLimit + 1),
    after: await outcome(1),
  }).toEqual({
    value70000: true,
    atTheLimit: true,
    overTheLimit: "ResponseHeadersTooLarge",
    after: true,
  });
});

// Stale-session retry: a request bound on session A when A's conn closes
// (GOAWAY/CONNECTION_CLOSE) must transparently retry on a fresh session
// instead of surfacing HTTP3StreamReset. reusePort lets B bind the same
// port while A drains so the retry has somewhere to land.
test("retries on a fresh session when a pooled session is stale (port reuse)", async () => {
  let release: () => void = () => {};
  const a = Bun.serve({
    port: 0,
    reusePort: true,
    tls,
    http3: true,
    http1: false,
    fetch: async req => {
      if (new URL(req.url).pathname === "/hang") {
        await new Promise<void>(r => (release = r));
        return new Response("never");
      }
      return new Response("a");
    },
  });
  const port = a.port;
  expect(await fetch(`https://127.0.0.1:${port}/`, h3).then(r => r.text())).toBe("a");
  const inflight = fetch(`https://127.0.0.1:${port}/hang`, h3);
  await Bun.sleep(50);
  const b = Bun.serve({ port, reusePort: true, tls, http3: true, http1: false, fetch: () => new Response("b") });
  // Abrupt stop sends CONNECTION_CLOSE then closes the fd, so /hang's
  // stream closes before any response — that's the retryOrFail trigger.
  a.stop(true);
  release();
  try {
    expect(await inflight.then(r => r.text())).toBe("b");
    expect(await fetch(`https://127.0.0.1:${port}/`, h3).then(r => r.text())).toBe("b");
  } finally {
    void b.stop(true);
  }
});

// fetch() pauses a body nobody reads by holding the stream's flow-control window
// (6 MiB). It keeps reading the stream, because data left in lsquic uses up the
// connection's window (15 MiB) and is dropped with the connection.
describe("a response body that isn't read yet", () => {
  const MiB = 1024 * 1024;
  const turn = () => new Promise(resolve => setImmediate(resolve));

  // Enough to pause the client, and within the stream window, so the server can send it all.
  const body = Buffer.alloc(2 * MiB, "abcdefghijklmnop");
  // Stored blocks: about as many bytes on the wire, and the decoder still runs.
  const gzipped = gzipSync(body, { level: 0 });
  const streamed = (bytes: Uint8Array, headers?: HeadersInit) =>
    new Response(
      new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(bytes);
          ctrl.close();
        },
      }),
      { headers },
    );

  describe.each([
    ["content-length", () => new Response(body)],
    ["no content-length", () => streamed(body)],
    ["gzip", () => streamed(gzipped, { "content-encoding": "gzip" })],
  ] as const)("arrives whole after its server is gone (%s)", (_, respond) => {
    test.each([
      ["res.bytes()", (res: Response) => res.bytes()],
      ["a streaming reader", async (res: Response) => Buffer.concat(await Array.fromAsync(res.body!))],
    ] as const)("%s", async (_, consume) => {
      const { streams } = liveCounts();
      let res: Response;
      {
        await using server = Bun.serve({ port: 0, tls, http3: true, http1: false, fetch: respond });
        res = await fetch(`https://127.0.0.1:${server.port}/`, h3);
        // A graceful stop closes the connection once the client has acknowledged the response.
        void server.stop();
        // Wait until the client has read the stream to its end.
        while (liveCounts().streams > streams) await turn();
      }
      const received = await consume(res);
      expect({ length: received.length, sha: Bun.SHA256.hash(received, "hex") }).toEqual({
        length: body.length,
        sha: Bun.SHA256.hash(body, "hex"),
      });
    });
  });

  // Moves 16.5 MiB, which takes a debug build longer than the default timeout.
  test.skipIf(isDebug)("leaves the connection's flow-control window to other requests", async () => {
    const large = Buffer.alloc(5.5 * MiB, "abcdefghijklmnop");
    await using server = Bun.serve({
      port: 0,
      tls,
      http3: true,
      http1: false,
      routes: { "/large": () => new Response(large), "/hello": () => new Response("hello") },
    });
    const { streams } = liveCounts();
    const held = await Promise.all([0, 1, 2].map(() => fetch(`https://127.0.0.1:${server.port}/large`, h3)));
    while (liveCounts().streams > streams) await turn();
    const sibling = await fetch(`https://127.0.0.1:${server.port}/hello`, h3).then(r => r.text());
    const lengths = await Promise.all(held.map(async res => (await res.bytes()).length));
    expect({ sibling, lengths }).toEqual({ sibling: "hello", lengths: [large.length, large.length, large.length] });
  });
});

// Only a FIN completes an HTTP/3 message. A response stream that goes away
// without one after the headers carries a truncated body.
describe("a response stream that ends without a FIN", () => {
  // The origin answers 200 with "partial". It runs `end` once the client, which
  // has that chunk by then, requests /release.
  async function readBodyFromOriginThat(end: (stream: any, session: any) => void) {
    const { promise: released, resolve: release } = Promise.withResolvers<void>();
    const origin = await listen(
      async (session: any) => {
        session.onstream = (stream: any) => stream.closed.catch(() => {});
        await session.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [createPrivateKey(tls.key)], certs: [Buffer.from(tls.cert)] } },
        transportParams: { maxIdleTimeout: 5 },
        async onheaders(this: any, headers: Record<string, string>) {
          this.sendHeaders({ ":status": "200" });
          if (headers[":path"] === "/release") {
            this.writer.endSync();
            release();
            return;
          }
          this.writer.writeSync(new TextEncoder().encode("partial"));
          await released;
          end(this, this.session);
        },
      },
    );
    try {
      const base = `https://127.0.0.1:${origin.address!.port}`;
      const res = await fetch(`${base}/`, h3);
      const reader = res.body!.getReader();
      const first = await reader.read();
      // Not awaited: CONNECTION_CLOSE can take this response with it.
      fetch(`${base}/release`, h3)
        .then(r => r.text())
        .catch(() => {});
      const rest = await reader.read().then(
        ({ done }) => (done ? "done" : "chunk"),
        (e: Error & { code?: string }) => e.code,
      );
      return { status: res.status, first: new TextDecoder().decode(first.value), rest };
    } finally {
      // Not close(), which waits for the session that fetch() keeps in its pool.
      await origin.destroy();
    }
  }

  test("rejects the body read with HTTP3StreamReset after RESET_STREAM", async () => {
    const result = await readBodyFromOriginThat(stream =>
      stream.destroy(new QuicError("body failed", { errorCode: 0x102 })),
    );
    expect(result).toEqual({ status: 200, first: "partial", rest: "HTTP3StreamReset" });
  });

  test("rejects the body read with ECONNRESET after CONNECTION_CLOSE", async () => {
    const result = await readBodyFromOriginThat((_stream, session) =>
      session.close({ code: 0x100, type: "application" }),
    );
    expect(result).toEqual({ status: 200, first: "partial", rest: "ECONNRESET" });
  });
});

// fetch() follows a redirect from inside lsquic's callback for the connection
// that delivered it. The request it queues on another origin's pooled
// connection has to go out right away, not with that connection's next packet
// or alarm.
test("follows a redirect onto another origin's idle pooled connection right away", async () => {
  const get = (url: string) => fetch(url, h3).then(r => r.text());

  // A node:quic server, for its session's packet counters.
  let pooled: { stats: { pktSent: bigint; pktRecv: bigint } } | undefined;
  const target = await listen(
    async (session: any) => {
      pooled = session;
      session.onstream = (stream: any) => stream.closed.catch(() => {});
      await session.closed.catch(() => {});
    },
    {
      sni: { "*": { keys: [createPrivateKey(tls.key)], certs: [Buffer.from(tls.cert)] } },
      transportParams: { maxIdleTimeout: 30 },
      onheaders(this: any) {
        this.sendHeaders({ ":status": "200" });
        this.writer.writeSync(new TextEncoder().encode("target"));
        this.writer.endSync();
      },
    },
  );
  const redirectServed = Promise.withResolvers<void>();
  using origin = Bun.serve({
    port: 0,
    tls,
    http3: true,
    http1: false,
    routes: {
      "/redirect": () => {
        redirectServed.resolve();
        return Response.redirect(`https://127.0.0.1:${target.address!.port}/`, 302);
      },
      "/marker": () => new Response("marker"),
    },
  });
  const marker = `https://127.0.0.1:${origin.port}/marker`;
  try {
    expect(await get(`https://127.0.0.1:${target.address!.port}/`)).toBe("target");
    // Any packet on the pooled connection gets it ticked, which would hide the
    // bug. Wait until it's been quiet for 20 requests to `origin`.
    for (let quiet = 0, last = -1n, requests = 0; quiet < 20 && requests < 60; requests++) {
      const packets = pooled!.stats.pktSent + pooled!.stats.pktRecv;
      quiet = packets === last ? quiet + 1 : 0;
      last = packets;
      expect(await get(marker)).toBe("marker");
    }

    const events: string[] = [];
    const redirected = get(`https://127.0.0.1:${origin.port}/redirect`).then(body => events.push(body));
    // The redirected request takes one round trip. Five sequential requests
    // that start after the redirect was served take five.
    await redirectServed.promise;
    for (let i = 0; i < 5; i++) await get(marker);
    events.push("five requests later");
    await redirected;
    expect(events).toEqual(["target", "five requests later"]);
  } finally {
    // Not close(), which waits for the session that fetch() keeps in its pool.
    await target.destroy();
  }
});

// Same retry, but the reconnect fails inside `connect()` itself. A QUIC
// connect to a resolved hostname probes each address with a throwaway UDP
// `connect(2)` (quic.c, us_quic_connect_result) and gives up when no entry is
// reachable. The shim lets the first probe through and refuses every later
// one, so the handshake failure below retries onto a connect that fails
// before it returns. On that path the request must be failed once, by the
// retry, and the session `connect()` opened for it must take nothing with it.
const PROBE_SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <netinet/in.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/socket.h>

static int (*real_connect)(int, const struct sockaddr *, socklen_t);
static int origin_port;
static int allow;
static int seen;

static void init(void) {
    if (real_connect) return;
    real_connect = dlsym(RTLD_NEXT, "connect");
    const char *p = getenv("H3_ORIGIN_PORT");
    origin_port = p ? atoi(p) : 0;
    const char *a = getenv("H3_ALLOW_PROBES");
    allow = a ? atoi(a) : 1;
}

static int is_udp(int fd) {
    int type = 0; socklen_t len = sizeof(type);
    if (getsockopt(fd, SOL_SOCKET, SO_TYPE, &type, &len) != 0) return 0;
    return type == SOCK_DGRAM;
}

int connect(int fd, const struct sockaddr *addr, socklen_t len) {
    init();
    if (origin_port && addr && is_udp(fd)) {
        /* Refuse an IPv6 entry for the origin the way a host without an IPv6
         * route does. The listener is dual-stack, so this only pins which
         * resolved address both connects use: the IPv4 one, which the counter
         * below governs whatever order /etc/hosts gives. */
        if (addr->sa_family == AF_INET6
                && ntohs(((const struct sockaddr_in6 *) addr)->sin6_port) == origin_port) {
            errno = EHOSTUNREACH;
            return -1;
        }
        if (addr->sa_family == AF_INET
                && ntohs(((const struct sockaddr_in *) addr)->sin_port) == origin_port) {
            int n = __atomic_fetch_add(&seen, 1, __ATOMIC_RELAXED);
            if (n >= allow) {
                fprintf(stderr, "[shim] probe %d refused\\n", n);
                errno = EACCES;
                return -1;
            }
            fprintf(stderr, "[shim] probe %d allowed\\n", n);
        }
    }
    return real_connect(fd, addr, len);
}
`;

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

test.skipIf(!isLinux || !cc)("a retry whose reconnect fails before it returns rejects once", async () => {
  // rejectUnauthorized with the self-signed cert fails the handshake, so the
  // request's stream closes before any response header: the retry trigger.
  // The hostname (not an IP literal) is what makes both connects take the
  // resolver path, where the refused probe makes `connect()` fail at once.
  // `localhost` answers from `is_localhost_name` without the resolver, as
  // `[::1, 127.0.0.1]` reported as a cache hit, so neither connect waits for
  // DNS and the shim below decides both.
  const fixture = /* js */ `
    const url = "https://localhost:" + process.env.H3_ORIGIN_PORT + "/hello";
    const opts = { protocol: "http3", tls: { rejectUnauthorized: true } };
    const reason = e => e?.code ?? e?.name ?? String(e);
    const first = await fetch(url, opts).then(r => "status " + r.status, reason);
    // A second request proves the client still works after the failed retry,
    // and keeps the process alive past the point where it used to crash.
    const second = await fetch(url, opts).then(r => "status " + r.status, reason);
    console.log(JSON.stringify({ first, second }));
  `;
  using dir = tempDir("h3-retry-connect", { "shim.c": PROBE_SHIM_C, "fixture.ts": fixture });
  const shim = join(String(dir), "shim.so");
  await using build = Bun.spawn({
    cmd: [cc!, "-shared", "-fPIC", "-O1", "-o", shim, join(String(dir), "shim.c"), "-ldl"],
    env: bunEnv,
    stderr: "pipe",
  });
  const [buildErr, buildExit] = await Promise.all([build.stderr.text(), build.exited]);
  if (buildExit !== 0) throw new Error("shim compile failed: " + buildErr);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.ts"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      LD_PRELOAD: bunEnv.LD_PRELOAD ? `${shim}:${bunEnv.LD_PRELOAD}` : shim,
      H3_ORIGIN_PORT: String(server.port),
      H3_ALLOW_PROBES: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const probes = stderr.split("\n").filter(line => line.startsWith("[shim] probe"));
  // The first connect reaches the origin; the retry's connect does not.
  expect(probes.slice(0, 2)).toEqual(["[shim] probe 0 allowed", "[shim] probe 1 refused"]);
  // The retried request keeps the error of the stream that closed, and the
  // next request reports its own connect error. Without the fix `connect()`
  // fails the retried request itself, which frees the client the retry still
  // holds, and the process aborts with nothing on stdout.
  expect({ stdout: stdout.trim(), signal: proc.signalCode, exitCode }).toEqual({
    stdout: '{"first":"HTTP3HandshakeFailed","second":"ECONNREFUSED"}',
    signal: null,
    exitCode: 0,
  });
});

// The same stop as in the port reuse test above, but A's handler already has a
// request that is not idempotent. The origin may have acted on it, so the client
// reports the failure and does not send it again (RFC 9110 section 9.2.2), as
// over HTTP/1.1.
test.each(["POST", "PATCH"])("does not send a %s again after it was written", async method => {
  // Its own pool: a connection left over from a server that had the same port is not reused.
  using session = new Bun.FetchSession();
  const h3 = { protocol: "http3", tls: { rejectUnauthorized: false }, session } as const;
  const hits: string[] = [];
  const received = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const a = Bun.serve({
    port: 0,
    reusePort: true,
    tls,
    http3: true,
    http1: false,
    fetch: async req => {
      hits.push(`a ${req.method}`);
      if (req.method === method) {
        received.resolve();
        await release.promise;
      }
      return new Response("a");
    },
  });
  let b: Server<undefined> | undefined;
  try {
    const port = a.port;
    expect(await fetch(`https://127.0.0.1:${port}/`, h3).then(r => r.text())).toBe("a");
    const inflight = fetch(`https://127.0.0.1:${port}/`, { ...h3, method, body: "payload" });
    await received.promise;
    b = Bun.serve({
      port,
      reusePort: true,
      tls,
      http3: true,
      http1: false,
      fetch: req => {
        hits.push(`b ${req.method}`);
        return new Response("b");
      },
    });
    void a.stop(true);
    release.resolve();
    expect(await inflight.then(r => r.text()).catch(e => e.code)).toBe("HTTP3StreamReset");
    // The origin is reachable: a new request lands on B, the first one never did.
    expect(await fetch(`https://127.0.0.1:${port}/`, h3).then(r => r.text())).toBe("b");
    expect(hits).toEqual(["a GET", `a ${method}`, "b GET"]);
  } finally {
    release.resolve();
    void a.stop(true);
    void b?.stop(true);
  }
});

// A request that never left the client is safe to send again whatever its
// method. This server answers each Initial with a Version Negotiation packet
// that lists only a reserved version, so the handshake fails before the request
// is written. Each connection attempt uses a new connection ID.
test.each(["GET", "POST"])("sends a %s again once if the connection failed before it was written", async method => {
  using session = new Bun.FetchSession();
  const attempts = new Set<string>();
  const server = await Bun.udpSocket({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket, packet, port, address) {
        if (packet.length < 7 || (packet[0] & 0x80) === 0) return;
        const dcidLength = packet[5];
        const dcid = packet.subarray(6, 6 + dcidLength);
        const scidLength = packet[6 + dcidLength];
        const scid = packet.subarray(7 + dcidLength, 7 + dcidLength + scidLength);
        attempts.add(dcid.toString("hex"));
        socket.send(
          Buffer.concat([
            Buffer.from([0xc0, 0, 0, 0, 0, scidLength]),
            scid,
            Buffer.from([dcidLength]),
            dcid,
            Buffer.from([0x0a, 0x0a, 0x0a, 0x0a]),
          ]),
          port,
          address,
        );
      },
    },
  });
  try {
    const init = method === "GET" ? {} : { method, body: "payload" };
    const outcome = await fetch(`https://127.0.0.1:${server.port}/`, { ...h3, ...init, session }).catch(e => e.code);
    expect(outcome).toBe("HTTP3HandshakeFailed");
    expect(attempts.size).toBe(2);
  } finally {
    server.close();
  }
});

// The origin can also end the stream itself, with the connection still up. A
// second send then reaches the same origin and its handler runs again. Only
// H3_REQUEST_REJECTED says that the origin did not process the request
// (RFC 9114 section 4.1.1). An origin that shuts down sends it, so that request
// goes to a new connection. Any other one stays on the connection it was on.
describe("the origin ended the stream with no final response", () => {
  const encoder = new TextEncoder();
  const listenOrigin = (
    endWithoutResponse: (stream: any) => void,
    received: { methods: string[]; sessions: Set<unknown> },
  ) =>
    listen(
      async (session: any) => {
        session.onstream = (stream: any) => stream.closed.catch(() => {});
        await session.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [createPrivateKey(tls.key)], certs: [Buffer.from(tls.cert)] } },
        transportParams: { maxIdleTimeout: 5 },
        async onheaders(this: any, headers: Record<string, string>) {
          for await (const _ of this);
          received.methods.push(headers[":method"]);
          received.sessions.add(this.session);
          if (received.methods.length === 1) return endWithoutResponse(this);
          this.sendHeaders({ ":status": "200" });
          this.writer.writeSync(encoder.encode("ok"));
          this.writer.endSync();
        },
      },
    );
  const internalError = (stream: any) => stream.resetStream(0x102n);
  const requestRejected = (stream: any) => stream.resetStream(0x10bn);
  const interimOnly = (stream: any) => {
    stream.sendInformationalHeaders({ ":status": "103" });
    stream.writer.endSync();
  };

  test.each([
    ["RESET_STREAM(H3_INTERNAL_ERROR)", "POST", internalError, "HTTP3StreamReset", ["POST"], true],
    ["RESET_STREAM(H3_INTERNAL_ERROR)", "PUT", internalError, "ok", ["PUT", "PUT"], true],
    ["a 103 and the end of the stream", "POST", interimOnly, "HTTP3StreamReset", ["POST"], true],
    ["a 103 and the end of the stream", "PUT", interimOnly, "ok", ["PUT", "PUT"], true],
    ["RESET_STREAM(H3_REQUEST_REJECTED)", "POST", requestRejected, "ok", ["POST", "POST"], false],
    ["RESET_STREAM(H3_REQUEST_REJECTED)", "PUT", requestRejected, "ok", ["PUT", "PUT"], false],
  ])("%s: %s", async (_name, method, endWithoutResponse, expectedOutcome, methods, oneConnection) => {
    using session = new Bun.FetchSession();
    const received = { methods: [] as string[], sessions: new Set() };
    const origin = await listenOrigin(endWithoutResponse, received);
    try {
      const init = { ...h3, session, method, body: "one order" };
      const outcome = await fetch(`https://127.0.0.1:${origin.address!.port}/`, init)
        .then(r => r.text())
        .catch(e => e.code);
      expect({ outcome, methods: received.methods, oneConnection: received.sessions.size === 1 }).toEqual({
        outcome: expectedOutcome,
        methods,
        oneConnection,
      });
    } finally {
      // Not close(): it waits for the session that fetch() keeps in its pool.
      await origin.destroy();
    }
  });
});

// A server that shuts down gracefully sends a GOAWAY with the id of the first
// request that it did not accept (RFC 9114 section 5.2). It did not process a
// request above that id, which is safe to send again whatever its method. The
// request at the id is not: some servers name the last request they accepted.
// The relay lets two requests leave the client without reaching A.
// A is a node:quic server because it can end the connection after the GOAWAY.
test.each([
  ["POST", "HTTP3StreamReset", ["a /below", "b /above"]],
  ["PUT", "b", ["a /below", "b /above", "b /at", "b /below"]],
])("sends a %s above the id of the server's GOAWAY again", async (method, otherOutcome, expected) => {
  using pool = new Bun.FetchSession();
  const applied: string[] = [];
  const accepted = Promise.withResolvers<void>();
  let session: any;
  const a = await listen(
    async (incoming: any) => {
      incoming.onstream = (stream: any) => stream.closed.catch(() => {});
      await incoming.closed.catch(() => {});
    },
    {
      sni: { "*": { keys: [createPrivateKey(tls.key)], certs: [Buffer.from(tls.cert)] } },
      transportParams: { maxIdleTimeout: 5 },
      async onheaders(this: any, headers: Record<string, string>) {
        for await (const _ of this);
        applied.push(`a ${headers[":path"]}`);
        session = this.session;
        accepted.resolve();
      },
    },
  );
  await using b = Bun.serve({
    port: 0,
    tls,
    http3: true,
    http1: false,
    async fetch(req) {
      await req.text();
      applied.push(`b ${new URL(req.url).pathname}`);
      return new Response("b");
    },
  });
  const body = Buffer.alloc(2_000, "x");
  const written = Promise.withResolvers<void>();
  let origin = a.address!.port;
  let client = { port: 0, address: "" };
  let bytesForB = 0;
  const firstInitial = new Map<string, Buffer | null>();
  const back = await Bun.udpSocket({
    hostname: "127.0.0.1",
    socket: { data: (_socket, packet) => void front.send(packet, client.port, client.address) },
  });
  const front = await Bun.udpSocket({
    hostname: "127.0.0.1",
    socket: {
      data(_socket, packet, port, address) {
        client = { port, address };
        if (origin === b.port && (bytesForB += packet.length) > 2 * body.length) written.resolve();
        // A ClientHello takes two Initial packets, and a server that reads the first one
        // alone answers with a Retry. It gets the first two of a connection together.
        if ((packet[0] & 0xf0) === 0xc0) {
          const sourceId = packet.subarray(7 + packet[5], 7 + packet[5] + packet[6 + packet[5]]).toString("hex");
          const first = firstInitial.get(sourceId);
          if (first === undefined) return void firstInitial.set(sourceId, Buffer.from(packet));
          if (first) back.send(first, origin, "127.0.0.1");
          firstInitial.set(sourceId, null);
        }
        back.send(packet, origin, "127.0.0.1");
      },
    },
  });
  const send = (path: string) =>
    fetch(`https://127.0.0.1:${front.port}${path}`, { ...h3, session: pool, method, body }).then(
      res => res.text(),
      err => err.code,
    );
  try {
    const below = send("/below");
    await accepted.promise;
    origin = b.port!;
    const at = send("/at");
    const above = send("/above");
    await written.promise;
    session.close().catch(() => {});
    expect(await above).toBe("b");
    session.destroy(undefined, { code: 0x100, type: "application" });
    expect(await Promise.all([below, at])).toEqual([otherOutcome, otherOutcome]);
    expect(applied.sort()).toEqual(expected);
  } finally {
    front.close();
    back.close();
    await a.destroy();
  }
});

// Subprocess so the experimental flag is process-scoped and the in-process
// server above (http1: false) doesn't interfere — this server keeps http1 on
// so the first fetch goes over TCP and reads Alt-Svc.
describe("Alt-Svc upgrade (--experimental-http3-fetch)", () => {
  // The fixture starts a server with both http1+http3 listening on the same
  // port, does two fetches with no `protocol:` hint, and prints the alt-svc
  // header plus the live http/3 session count after each. With the flag on,
  // fetch #1 goes over http/1.1 (sessions=0) and records Alt-Svc; fetch #2
  // goes over QUIC (sessions=1).
  const fixture = `
    import { fetchH3Internals } from "bun:internal-for-testing";
    const { liveCounts } = fetchH3Internals;
    using server = Bun.serve({
      port: 0,
      tls: ${JSON.stringify(tls)},
      http3: true,
      fetch: () => new Response("ok"),
    });
    const url = "https://127.0.0.1:" + server.port + "/";
    const opts = { tls: { rejectUnauthorized: false } };
    {
      const r = await fetch(url, opts);
      await r.text();
      console.log("first alt-svc=%s sessions=%d", r.headers.get("alt-svc") ?? "", liveCounts().sessions);
    }
    {
      const r = await fetch(url, opts);
      await r.text();
      console.log("second status=%d sessions=%d", r.status, liveCounts().sessions);
    }
  `;

  async function run(extra: { env?: Record<string, string>; args?: string[] }) {
    using dir = tempDir("h3-altsvc", { "fixture.ts": fixture });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...(extra.args ?? []), "fixture.ts"],
      env: { ...bunEnv, ...extra.env },
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("env var: BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP3_CLIENT=1", async () => {
    const { stdout, stderr, exitCode } = await run({ env: { BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP3_CLIENT: "1" } });
    expect(stderr).toBe("");
    expect(stdout).toMatch(/^first alt-svc=h3=":\d+"; ma=\d+ sessions=0\n/);
    expect(stdout).toMatch(/second status=200 sessions=1\n$/);
    expect(exitCode).toBe(0);
  });

  test("CLI flag: --experimental-http3-fetch", async () => {
    const { stdout, stderr, exitCode } = await run({ args: ["--experimental-http3-fetch"] });
    expect(stderr).toBe("");
    expect(stdout).toMatch(/^first alt-svc=h3=":\d+"; ma=\d+ sessions=0\n/);
    expect(stdout).toMatch(/second status=200 sessions=1\n$/);
    expect(exitCode).toBe(0);
  });

  test("off by default: both fetches stay on h1", async () => {
    const { stdout, stderr, exitCode } = await run({});
    expect(stderr).toBe("");
    // Alt-Svc header is still emitted by the server, but the client never
    // records it and never opens a QUIC session.
    expect(stdout).toMatch(/^first alt-svc=h3=":\d+"; ma=\d+ sessions=0\n/);
    expect(stdout).toMatch(/second status=200 sessions=0\n$/);
    expect(exitCode).toBe(0);
  });

  // RFC 7838 section 2.4: a client falls back to the origin when the alternative
  // fails. The origin advertises a UDP peer that fails every handshake at once,
  // with a Version Negotiation packet that offers a version nobody speaks.
  // `dials` counts the QUIC connections the client opened to it.
  describe("falls back to TCP when the alternative's handshake fails", () => {
    async function run(requests: string) {
      const fixture = `
        const dials = new Set();
        const alt = await Bun.udpSocket({
          hostname: "127.0.0.1",
          socket: {
            data(socket, m, port, address) {
              if (!(m[0] & 0x80)) return;
              const dcid = m.subarray(6, 6 + m[5]);
              const scid = m.subarray(7 + m[5], 7 + m[5] + m[6 + m[5]]);
              dials.add(scid.toString("hex"));
              const reply = [[0x80, 0, 0, 0, 0, scid.length], scid, [dcid.length], dcid, [0x0a, 0x0a, 0x0a, 0x0a]];
              socket.send(Buffer.concat(reply.map(part => Buffer.from(part))), port, address);
            },
          },
        });
        const hits = [];
        using origin = Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          tls: ${JSON.stringify(tls)},
          async fetch(req) {
            hits.push([req.method, new URL(req.url).pathname, await req.text()].join(" ").trim());
            return new Response("origin", { headers: { "alt-svc": 'h3=":' + alt.port + '"; ma=3600' } });
          },
        });
        const send = (path, init) =>
          fetch("https://127.0.0.1:" + origin.port + path, { tls: { rejectUnauthorized: false }, ...init }).then(
            r => r.text(),
            e => e.code,
          );
        const results = [await send("/learn")];
        ${requests}
        console.log(JSON.stringify({ results, hits: hits.sort(), dials: dials.size }));
        alt.close();
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: { ...bunEnv, BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP3_CLIENT: "1" },
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      return JSON.parse(stdout);
    }

    test.concurrent("and doesn't dial it again for the next request", async () => {
      expect(await run(`results.push(await send("/1"), await send("/2"));`)).toEqual({
        results: ["origin", "origin", "origin"],
        hits: ["GET /1", "GET /2", "GET /learn"],
        dials: 1,
      });
    });

    test.concurrent("with every request queued on the connection", async () => {
      expect(await run(`results.push(...(await Promise.all([send("/a"), send("/b"), send("/c")])));`)).toEqual({
        results: ["origin", "origin", "origin", "origin"],
        hits: ["GET /a", "GET /b", "GET /c", "GET /learn"],
        dials: 1,
      });
    });

    test.concurrent("with a streamed request body", async () => {
      const requests = `
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("streamed"));
            controller.close();
          },
        });
        results.push(await send("/upload", { method: "POST", body }));
      `;
      expect(await run(requests)).toEqual({
        results: ["origin", "origin"],
        hits: ["GET /learn", "POST /upload streamed"],
        dials: 1,
      });
    });

    test.concurrent('but not for protocol: "http3"', async () => {
      const requests = `
        results.push(
          await fetch("https://127.0.0.1:" + alt.port + "/", { protocol: "http3", tls: { rejectUnauthorized: false } }).then(
            r => r.text(),
            e => e.code,
          ),
        );
      `;
      expect(await run(requests)).toEqual({
        results: ["origin", "HTTP3HandshakeFailed"],
        hits: ["GET /learn"],
        dials: 2,
      });
    });
  });

  test("Alt-Svc on a proxy's CONNECT reply is not applied to the tunneled origin", async () => {
    const proxyFixture = `
      import { fetchH3Internals } from "bun:internal-for-testing";
      import net from "node:net";
      import tls from "node:tls";
      const { liveCounts } = fetchH3Internals;
      const cert = ${JSON.stringify(tls)};
      using origin = Bun.serve({ port: 0, tls: cert, fetch: () => new Response("from-origin") });
      using other = Bun.serve({
        port: 0,
        tls: cert,
        http3: true,
        http1: false,
        fetch: () => new Response("from-other"),
      });
      const proxy = tls.createServer({ ...cert }, client => {
        client.on("error", () => {});
        client.once("data", data => {
          const target = data.toString("latin1").split(" ")[1] ?? "";
          const [host, port] = target.split(":");
          const upstream = net.connect(Number(port), host, () => {
            client.write(
              'HTTP/1.1 200 Connection Established\\r\\nAlt-Svc: h3=":' +
                other.port +
                '"; ma=86400\\r\\n\\r\\n',
            );
            client.pipe(upstream);
            upstream.pipe(client);
          });
          upstream.on("error", () => client.destroy());
        });
      });
      await new Promise(r => proxy.listen(0, "127.0.0.1", r));
      const proxyUrl = "https://127.0.0.1:" + proxy.address().port;
      const url = "https://127.0.0.1:" + origin.port + "/";
      const opts = { tls: { rejectUnauthorized: false } };
      {
        const r = await fetch(url, { ...opts, proxy: proxyUrl, keepalive: false });
        console.log("proxied body=%s", await r.text());
      }
      {
        const r = await fetch(url, opts);
        console.log("direct body=%s sessions=%d", await r.text(), liveCounts().sessions);
      }
      proxy.close();
    `;
    const env = { ...bunEnv, BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP3_CLIENT: "1" } as Record<string, string>;
    for (const key of ["NO_PROXY", "no_proxy", "HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"]) {
      delete env[key];
    }
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", proxyFixture],
      env,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("proxied body=from-origin\ndirect body=from-origin sessions=0\n");
    expect(exitCode).toBe(0);
  });
});

// The harness certificate is self-signed with SAN 127.0.0.1 and localhost, so it's its own CA.
describe("per-request tls options over http3", () => {
  const attempt = (url: string, options: object) =>
    fetch(url, { protocol: "http3", tls: options } as RequestInit).then(
      res => res.text(),
      e => e.code,
    );

  test("verifies the server against tls.ca", async () => {
    expect({
      rightCA: await attempt(`${base}/hello`, { ca: tls.cert }),
      wrongCA: await attempt(`${base}/hello`, { ca: expiredTls.cert }),
      defaultStore: await attempt(`${base}/hello`, {}),
      // Not pooled with the connections above, or with the unverified ones of other tests.
      rightCAAgain: await attempt(`${base}/hello`, { ca: tls.cert }),
    }).toEqual({
      rightCA: "hello over h3",
      wrongCA: "HTTP3HandshakeFailed",
      defaultStore: "HTTP3HandshakeFailed",
      rightCAAgain: "hello over h3",
    });
  });

  test("verifies the certificate against tls.serverName", async () => {
    expect({
      inTheCertificate: await attempt(`${base}/hello`, { ca: tls.cert, serverName: "localhost" }),
      notInTheCertificate: await attempt(`${base}/hello`, { ca: tls.cert, serverName: "example.com" }),
    }).toEqual({ inTheCertificate: "hello over h3", notInTheCertificate: "HTTP3HandshakeFailed" });
  });

  test("presents the client certificate", async () => {
    await using server = Bun.serve({
      port: 0,
      tls: { ...tls, requestCert: true, rejectUnauthorized: true, ca: tls.cert },
      http3: true,
      http1: false,
      fetch: () => new Response("mutual"),
    });
    const url = `https://127.0.0.1:${server.port}/`;
    expect(await attempt(url, { ca: tls.cert, cert: tls.cert, key: tls.key })).toBe("mutual");
    expect(await attempt(url, { ca: tls.cert })).not.toBe("mutual");
  });

  test("refuses maxVersion below TLS 1.3", async () => {
    expect(await attempt(`${base}/hello`, { ca: tls.cert, maxVersion: 0x0303 })).toBe("HTTP3Unsupported");
  });

  test("verifies against tls.ca after an Alt-Svc upgrade", async () => {
    const fixture = `
      import { fetchH3Internals } from "bun:internal-for-testing";
      const tls = ${JSON.stringify(tls)};
      using server = Bun.serve({ port: 0, tls, http3: true, fetch: () => new Response("ok") });
      const sessions = [];
      for (let i = 0; i < 2; i++) {
        await fetch("https://127.0.0.1:" + server.port + "/", { tls: { ca: tls.cert } }).then(r => r.text());
        sessions.push(fetchH3Internals.liveCounts().sessions);
      }
      console.log(sessions.join(","));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP3_CLIENT: "1" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: "0,1\n", stderr: "" });
    expect(exitCode).toBe(0);
  });
});

// https://github.com/oven-sh/bun/issues/32234
test("connects to a server with an Ed25519 certificate", async () => {
  const fixtures = join(import.meta.dir, "..", "..", "node", "tls", "fixtures");
  const server = Bun.serve({
    port: 0,
    tls: { key: Bun.file(join(fixtures, "ed25519-key.pem")), cert: Bun.file(join(fixtures, "ed25519-cert.pem")) },
    http3: true,
    http1: false,
    fetch: () => new Response("ed25519 over h3"),
  });
  try {
    const res = await fetch(`https://127.0.0.1:${server.port}/`, h3);
    expect(await res.text()).toBe("ed25519 over h3");
  } finally {
    // As in afterAll: the pooled session drains on lsquic's idle timeout, so stop(true) is not awaited.
    server.stop(true);
  }
});

test("protocol: http3 is refused once tls.DEFAULT_CIPHERS is assigned, as it is with a ciphers option", async () => {
  const fixture = `
    import tls from "node:tls";
    const server = Bun.serve({ port: 0, tls: ${JSON.stringify(tls)}, http3: true, fetch: () => new Response("ok") });
    const attempt = options =>
      fetch(server.url, { protocol: "http3", tls: { rejectUnauthorized: false, ...options } }).then(
        res => res.text(),
        error => error.code,
      );
    const ciphers = "ECDHE-RSA-AES256-GCM-SHA384";
    const results = { nothing: await attempt(), option: await attempt({ ciphers }) };
    tls.DEFAULT_CIPHERS = ciphers;
    results.assigned = await attempt();
    console.log(JSON.stringify(results));
    process.exit(0);
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", fixture], env: bunEnv, stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  // QUIC is TLS 1.3, so the list would not apply to it.
  expect(JSON.parse(stdout)).toEqual({ nothing: "ok", option: "HTTP3Unsupported", assigned: "HTTP3Unsupported" });
  expect(exitCode).toBe(0);
});
