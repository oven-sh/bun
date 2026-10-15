import { gunzipSync, gzipSync, type Server } from "bun";
import { fetchH3Internals } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isIPv6, isLinux, tempDir, tls } from "harness";
import { createPrivateKey } from "node:crypto";
import { join } from "node:path";
import { listen } from "node:quic";

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

  // RFC 7838 section 2.4: when the connection to the alternative fails, the
  // client may fall back to the origin. A case is an origin (HTTPS over TCP),
  // the UDP peer the origin advertises as its h3 alternative, and the client
  // under test. `dials` is the number of QUIC connections the client opened to
  // that peer, counted by the client's own connection IDs.
  describe("when the QUIC connection to the alternative cannot be established", () => {
    const fixture = /* ts */ `
      import { createCipheriv, createHmac } from "node:crypto";
      import { writeFileSync } from "node:fs";
      const tls = ${JSON.stringify(tls)};

      // A Version Negotiation packet (RFC 8999 section 6) that offers one
      // version nobody speaks: the handshake of that connection fails at once.
      function versionNegotiation(m) {
        const dcid = m.subarray(6, 6 + m[5]);
        const scid = m.subarray(7 + m[5], 7 + m[5] + m[6 + m[5]]);
        return Buffer.concat([
          Buffer.from([0x80, 0, 0, 0, 0, scid.length]),
          scid,
          Buffer.from([dcid.length]),
          dcid,
          Buffer.from([0x0a, 0x0a, 0x0a, 0x0a]),
        ]);
      }

      // HKDF-Expand-Label of TLS 1.3 (RFC 8446 section 7.1), for one hash block at most.
      const expand = (secret, label, length) =>
        createHmac("sha256", secret)
          .update(Buffer.concat([Buffer.from([0, length, 6 + label.length]), Buffer.from("tls13 " + label), Buffer.from([0, 1])]))
          .digest()
          .subarray(0, length);

      // The answer of a server that refuses the connection: an Initial packet
      // with CONNECTION_CLOSE (RFC 9000 section 19.19), under the Initial keys
      // of the connection (RFC 9001 section 5).
      function connectionClose(m) {
        const dcid = m.subarray(6, 6 + m[5]);
        const scid = m.subarray(7 + m[5], 7 + m[5] + m[6 + m[5]]);
        const salt = Buffer.from("38762cf7f55934b34d179ae6a4c80cadccbb7f0a", "hex");
        const secret = expand(createHmac("sha256", salt).update(dcid).digest(), "server in", 32);
        // CONNECTION_CLOSE: error CONNECTION_REFUSED, no frame type, no reason. Then PADDING.
        const frames = Buffer.concat([Buffer.from([0x1c, 0x02, 0x00, 0x00]), Buffer.alloc(20)]);
        // The last three bytes: a length of two bytes, and packet number 0 in one.
        const header = Buffer.concat([
          Buffer.from([0xc0, 0, 0, 0, 1, scid.length]),
          scid,
          Buffer.from([dcid.length]),
          dcid,
          Buffer.from([0x00, 0x40, 1 + frames.length + 16, 0x00]),
        ]);
        const aead = createCipheriv("aes-128-gcm", expand(secret, "quic key", 16), expand(secret, "quic iv", 12));
        aead.setAAD(header);
        const sealed = Buffer.concat([aead.update(frames), aead.final(), aead.getAuthTag()]);
        const mask = createCipheriv("aes-128-ecb", expand(secret, "quic hp", 16), null).update(sealed.subarray(3, 19));
        header[0] ^= mask[0] & 0x0f;
        header[header.length - 1] ^= mask[1];
        return Buffer.concat([header, sealed]);
      }

      // What the UDP peer does with each connection it has not seen before.
      // The last entry stays.
      //   "fail":   it answers with Version Negotiation.
      //   "refuse": it answers with CONNECTION_CLOSE, as a server does that
      //             takes no connection now. That says nothing about the next one.
      //   "live":   it passes the packets on to an HTTP/3 listener.
      const plans = {
        healthy: ["live"],
        written: ["live"],
        "written-refused": ["live"],
        "strict-fails": ["live"],
        resolver: ["live"],
        deadline: ["fail", "live"],
        "refused-once": ["refuse", "live"],
        "refused-twice": ["refuse"],
        "redial-unroutable": ["refuse"],
        "redirect-to-refusing": ["refuse", "live"],
        "refusing-site": ["refuse", "live"],
        "live-site": ["live"],
      };

      // "refusing-site" and "live-site" are a second origin for another case:
      // \`use\` gets its URL and its fetch, and the origin lives until \`use\` settles.
      async function run(scenario, host, urlHost, use) {
        const literal = host.includes(":") ? "[" + host + "]" : host;
        // The shim cases name the origin by a hostname.
        urlHost ??= literal;

        let plan = [...(plans[scenario] ?? ["fail"])];
        // The peer keeps the packets of a connection that it does not serve, and does not answer yet.
        let holding = ["abort", "session-close", "redial-unroutable"].includes(scenario);
        let liveGone = false;
        // Where a 302 of this case leads.
        let elsewhere = "/landed";
        const treatment = new Map();
        const held = [];
        const initial = Promise.withResolvers();
        const written = Promise.withResolvers();
        let client;
        const listen = () =>
          Bun.serve({
            port: 0,
            hostname: host,
            tls,
            http3: true,
            http1: false,
            async fetch(req) {
              const path = new URL(req.url).pathname;
              if (path === "/written") {
                // The whole request is here, so the client wrote it. It gets no response.
                await req.text();
                written.resolve();
                await new Promise(() => {});
              }
              if (path === "/redirect") return new Response(null, { status: 302, headers: { location: elsewhere } });
              return new Response("alternative");
            },
          });
        let live =
          plan.includes("live") || scenario === "moved" || scenario === "session-close" ? listen() : undefined;
        const upstream = await Bun.udpSocket({
          hostname: host,
          socket: {
            data(socket, m) {
              // No client yet: the datagram is for a socket that had this port before.
              if (client) alt.send(m, client.port, client.address);
            },
          },
        });
        const alt = await Bun.udpSocket({
          hostname: host,
          socket: {
            data(socket, m, port, address) {
              let to = "live";
              // A long header names the client's connection ID.
              if (m[0] & 0x80) {
                const id = m.subarray(7 + m[5], 7 + m[5] + m[6 + m[5]]).toString("hex");
                if (!treatment.has(id)) treatment.set(id, plan.length > 1 ? plan.shift() : plan[0]);
                to = treatment.get(id);
              }
              if (to !== "live") {
                if (holding) {
                  held.push({ m: Buffer.from(m), port, address, to });
                  initial.resolve();
                } else {
                  socket.send(to === "fail" ? versionNegotiation(m) : connectionClose(m), port, address);
                }
                return;
              }
              if (!live || liveGone) return;
              client = { port, address };
              upstream.send(m, live.port, host);
            },
          },
        });
        // A second UDP peer that fails every connection. See drained().
        const barrier = await Bun.udpSocket({
          hostname: host,
          socket: {
            data(socket, m, port, address) {
              if (m[0] & 0x80) socket.send(versionNegotiation(m), port, address);
            },
          },
        });
        // The shim refuses a UDP connect() to the port in this file.
        if (scenario === "unroutable") writeFileSync(process.env.H3_REFUSE_UDP_PORT_FILE, String(alt.port));

        // The port the origin names in Alt-Svc, on every response.
        let advertised = alt.port;
        const ma = scenario === "deadline" ? 100 : 3600;
        const hits = [];
        const origin = Bun.serve({
          port: 0,
          hostname: host,
          tls,
          async fetch(req) {
            const path = new URL(req.url).pathname;
            const body = await req.text();
            hits.push(req.method + " " + path + (body && " got " + body));
            const headers = { "alt-svc": 'h3=":' + advertised + '"; ma=' + ma };
            if (path === "/redirect") {
              return new Response(null, { status: 302, headers: { ...headers, location: elsewhere } });
            }
            return new Response("origin", { headers });
          },
        });
        const url = "https://" + urlHost + ":" + origin.port;

        const settle = promise =>
          promise.then(
            async r => r.status + " " + (await r.text()),
            e => (typeof e.code === "string" ? e.code : e.name),
          );
        const lax = { tls: { rejectUnauthorized: false } };
        const send = (path, init) => settle(fetch(url + path, { ...lax, ...init }));
        // A request that names HTTP/3 itself, to the UDP peer.
        const pinned = name => settle(fetch("https://" + name + ":" + alt.port + "/", { protocol: "http3", ...lax }));
        // When this settles, the UDP peer has handled every packet the client
        // sent before, and the client every answer. This request names HTTP/3
        // itself and goes to the second peer: its packets are behind the others
        // on the same sockets, and it takes several exchanges to fail.
        const drained = () =>
          settle(fetch("https://" + literal + ":" + barrier.port + "/", { protocol: "http3", ...lax }));
        // The peer answers the packets that it kept, and keeps none from here.
        const release = () => {
          holding = false;
          for (const { m, port, address, to } of held) {
            alt.send(to === "fail" ? versionNegotiation(m) : connectionClose(m), port, address);
          }
        };

        const out = {};
        switch (scenario) {
          case "sequential":
          case "unroutable":
          case "healthy":
          case "refused-once":
          case "refused-twice":
            out.fetches = [await send("/0"), await send("/1"), await send("/2")];
            break;
          case "concurrent":
            out.fetches = [await send("/0"), ...(await Promise.all([send("/a"), send("/b"), send("/c")]))];
            hits.sort();
            break;
          case "stream-body":
            out.fetches = [
              await send("/0"),
              await send("/upload", {
                method: "POST",
                body: new ReadableStream({
                  start(controller) {
                    controller.enqueue(new TextEncoder().encode("streamed"));
                    controller.close();
                  },
                }),
              }),
            ];
            break;
          case "redirect":
            out.fetches = [await send("/redirect")];
            break;
          case "pinned":
            out.fetches = [await pinned(literal)];
            break;
          case "pinned-resolver":
            // The shim fails the next lookup of the name.
            writeFileSync(process.env.H3_FAIL_LOOKUP_FILE, "1");
            out.fetches = [await pinned(urlHost)];
            break;
          case "resolver":
            out.fetches = [await send("/0")];
            writeFileSync(process.env.H3_FAIL_LOOKUP_FILE, "1");
            out.fetches.push(await send("/1"), await send("/2"));
            break;
          case "strict-fails":
            out.fetches = [
              await send("/0"),
              // The certificate of the test listeners is self-signed.
              await send("/strict", { tls: { rejectUnauthorized: true } }),
              await send("/2"),
            ];
            break;
          case "lax-fails":
            out.fetches = [await send("/0"), await send("/1"), await send("/strict", { tls: { rejectUnauthorized: true } })];
            break;
          case "abort": {
            const learned = await send("/0");
            const controller = new AbortController();
            const queued = send("/aborted", { signal: controller.signal });
            // The request is on a connection that got no answer yet.
            await Promise.race([initial.promise, queued]);
            controller.abort();
            const aborted = await queued;
            release();
            await drained();
            out.fetches = [learned, aborted, await send("/next")];
            break;
          }
          case "session-close": {
            const session = new Bun.FetchSession();
            const learned = await send("/0");
            const controller = new AbortController();
            const queued = send("/aborted", { session, signal: controller.signal });
            await Promise.race([initial.promise, queued]);
            controller.abort();
            const aborted = await queued;
            // The session closes its idle connection, which is still in its handshake.
            session.close();
            await drained();
            // The alternative works from here.
            holding = false;
            plan = ["live"];
            out.fetches = [learned, aborted, await send("/next")];
            break;
          }
          case "redial-unroutable": {
            const learned = await send("/0");
            const queued = send("/1");
            await Promise.race([initial.promise, queued]);
            // From here the shim refuses a UDP connect() to the peer: no second connection can start.
            writeFileSync(process.env.H3_REFUSE_UDP_PORT_FILE, String(alt.port));
            release();
            out.fetches = [learned, await queued, await send("/2")];
            break;
          }
          case "refusing-site":
          case "live-site":
            await use({ url, send });
            break;
          case "redirect-to-refusing":
          case "redirect-to-live": {
            // A second origin with its own UDP peer. The 302 of this origin leads there.
            const site = scenario === "redirect-to-live" ? "live-site" : "refusing-site";
            const other = await run(site, host, undefined, async there => {
              elsewhere = there.url + "/landed";
              out.fetches = [await send("/0"), await there.send("/0"), await send("/redirect"), await there.send("/next")];
            });
            out.there = { hits: other.hits, dials: other.dials };
            break;
          }
          case "moved":
            out.fetches = [await send("/0"), await send("/1")];
            // From here the origin names the live listener itself, on another port.
            advertised = live.port;
            out.fetches.push(await send("/2"), await send("/3"));
            break;
          case "written": {
            out.fetches = [await send("/0"), await send("/1")];
            const inFlight = send("/written", { method: "PUT", body: "payload" });
            await Promise.race([written.promise, inFlight]);
            // The alternative goes away, and every new connection to it fails.
            plan = ["fail"];
            liveGone = true;
            live.stop(true);
            out.fetches.push(await inFlight, await send("/next"));
            break;
          }
          case "written-refused": {
            out.fetches = [await send("/0"), await send("/1")];
            const inFlight = send("/written", { method: "PUT", body: "payload" });
            await Promise.race([written.promise, inFlight]);
            // The listener goes away, and its connection with it. A new listener
            // takes its place, and the peer refuses the next connection only.
            plan = ["refuse", "live"];
            const gone = live;
            live = listen();
            gone.stop(true);
            out.fetches.push(await inFlight, await send("/next"));
            break;
          }
          case "deadline": {
            // The shim moves the wall clock ahead by the seconds in this file.
            const clock = seconds => writeFileSync(process.env.H3_CLOCK_FILE, String(seconds));
            out.dialsAfterEachFetch = [];
            const step = async path => {
              const result = await send(path);
              await drained();
              out.dialsAfterEachFetch.push(treatment.size);
              return result;
            };
            out.fetches = [await send("/0"), await step("/1"), await step("/2")];
            for (const seconds of [200, 200, 400, 400]) {
              clock(seconds);
              out.fetches.push(await step("/at-" + seconds));
            }
            break;
          }
        }
        await drained();
        // The listener closes its connections through the peer, so it stops first.
        live?.stop(true);
        alt.close();
        upstream.close();
        barrier.close();
        origin.stop(true);
        return { ...out, hits, dials: treatment.size };
      }

      // Each argument is one case, "scenario@host". They run at the same time.
      const specs = process.argv.slice(2);
      const results = await Promise.all(specs.map(spec => run(...spec.split("@"))));
      console.log(JSON.stringify(Object.fromEntries(specs.map((spec, i) => [spec, results[i]]))));
    `;

    async function run(specs: string[], env?: Record<string, string>) {
      using dir = tempDir("h3-altsvc-fallback", { "fixture.ts": fixture });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--experimental-http3-fetch", "fixture.ts", ...specs],
        env: { ...bunEnv, ...env },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      let results: Record<string, unknown> = {};
      try {
        results = JSON.parse(stdout);
      } catch {}
      return { results, stdout, stderr, exitCode };
    }
    type Run = Awaited<ReturnType<typeof run>>;
    const resultOf = ({ results, stdout, stderr, exitCode }: Run, spec: string) => ({
      result: results[spec] ?? { stdout, stderr },
      exitCode,
    });

    const origin = "200 origin";
    const alternative = "200 alternative";

    // Each case has its own origin and its own UDP peers. The cases share one
    // process, which has its own time limit: no case waits for another one.
    describe("in one process", () => {
      const hosts = isIPv6() ? ["127.0.0.1", "::1"] : ["127.0.0.1"];
      const specs = [
        ...hosts.flatMap(host => ["sequential@" + host, "abort@" + host]),
        ...[
          "concurrent",
          "stream-body",
          "redirect",
          "session-close",
          "healthy",
          "moved",
          "written",
          "written-refused",
          "pinned",
          "strict-fails",
          "lax-fails",
          "refused-once",
          "refused-twice",
          "redirect-to-refusing",
          "redirect-to-live",
        ].map(scenario => scenario + "@127.0.0.1"),
      ];
      let shared: Run;
      beforeAll(async () => {
        shared = await run(specs);
      });

      for (const host of ["127.0.0.1", "::1"]) {
        const skip = host === "::1" && !isIPv6();

        // Fetch 2 is queued on a connection that fails its handshake, and goes
        // to the origin. Fetch 3 opens no connection, although the response to
        // fetch 2 advertised the alternative again.
        test.skipIf(skip)(`the request goes to the origin, and so does the next one (${host})`, () => {
          const { result, exitCode } = resultOf(shared, "sequential@" + host);
          expect(result).toEqual({ fetches: [origin, origin, origin], hits: ["GET /0", "GET /1", "GET /2"], dials: 1 });
          expect(exitCode).toBe(0);
        });

        // No request is left on the connection when it fails. The failure still
        // keeps the next request off the alternative.
        test.skipIf(skip)(`a connection that fails after its request was aborted counts (${host})`, () => {
          const { result, exitCode } = resultOf(shared, "abort@" + host);
          expect(result).toEqual({ fetches: [origin, "AbortError", origin], hits: ["GET /0", "GET /next"], dials: 1 });
          expect(exitCode).toBe(0);
        });
      }

      test("every request queued on the failed connection goes to the origin", () => {
        const { result, exitCode } = resultOf(shared, "concurrent@127.0.0.1");
        expect(result).toEqual({
          fetches: [origin, origin, origin, origin],
          hits: ["GET /0", "GET /a", "GET /b", "GET /c"],
          dials: 1,
        });
        expect(exitCode).toBe(0);
      });

      test("a streamed request body reaches the origin", () => {
        const { result, exitCode } = resultOf(shared, "stream-body@127.0.0.1");
        expect(result).toEqual({ fetches: [origin, origin], hits: ["GET /0", "POST /upload got streamed"], dials: 1 });
        expect(exitCode).toBe(0);
      });

      // The 302 is the first response of the origin, so the hop that follows it
      // is the first request routed to the alternative.
      test("a redirect hop goes to the origin", () => {
        const { result, exitCode } = resultOf(shared, "redirect@127.0.0.1");
        expect(result).toEqual({ fetches: [origin], hits: ["GET /redirect", "GET /landed"], dials: 1 });
        expect(exitCode).toBe(0);
      });

      // The client closed that connection itself, so it says nothing about the
      // alternative: fetch 3 is routed there.
      test("a connection that a FetchSession closes in its handshake does not count", () => {
        const { result, exitCode } = resultOf(shared, "session-close@127.0.0.1");
        expect(result).toEqual({ fetches: [origin, "AbortError", alternative], hits: ["GET /0"], dials: 2 });
        expect(exitCode).toBe(0);
      });

      test("an alternative that works serves fetch 2 and fetch 3 on one connection", () => {
        const { result, exitCode } = resultOf(shared, "healthy@127.0.0.1");
        expect(result).toEqual({ fetches: [origin, alternative, alternative], hits: ["GET /0"], dials: 1 });
        expect(exitCode).toBe(0);
      });

      // The failure belongs to the port that failed. After fetch 2 the origin
      // names another port, and fetch 4 is served there.
      test("a failed port does not keep requests off a port the origin names later", () => {
        const { result, exitCode } = resultOf(shared, "moved@127.0.0.1");
        expect(result).toEqual({
          fetches: [origin, origin, origin, alternative],
          hits: ["GET /0", "GET /1", "GET /2"],
          dials: 1,
        });
        expect(exitCode).toBe(0);
      });

      // Fetch 3 is written on a working connection, which then closes. The
      // connection that would carry it again fails its handshake. The origin
      // must not see a request that the alternative may have acted on.
      test("a request that was written does not go to the origin", () => {
        const { result, exitCode } = resultOf(shared, "written@127.0.0.1");
        expect(result).toEqual({
          fetches: [origin, alternative, "HTTP3HandshakeFailed", origin],
          hits: ["GET /0", "GET /next"],
          dials: 2,
        });
        expect(exitCode).toBe(0);
      });

      // As above, but the connection that would carry fetch 3 again is only
      // refused. That is one refused connection, after one that worked: it is
      // no failure of the alternative, which serves fetch 4.
      test("one refused connection after a working one does not count", () => {
        const { result, exitCode } = resultOf(shared, "written-refused@127.0.0.1");
        expect(result).toEqual({
          fetches: [origin, alternative, "HTTP3HandshakeFailed", alternative],
          hits: ["GET /0"],
          dials: 3,
        });
        expect(exitCode).toBe(0);
      });

      // `protocol: "http3"` is not an Alt-Svc upgrade: the request gets its
      // second connection, then rejects, and no origin sees it.
      test("a request that names HTTP/3 itself does not leave it", () => {
        const { result, exitCode } = resultOf(shared, "pinned@127.0.0.1");
        expect(result).toEqual({ fetches: ["HTTP3HandshakeFailed"], hits: [], dials: 2 });
        expect(exitCode).toBe(0);
      });

      // Fetch 2 checks the certificate, and the alternative fails that check:
      // the request goes to the origin, which fails it too. Fetch 3 does not
      // check it, and the failure of fetch 2 does not keep it off the alternative.
      test("a failed certificate check does not count for a request that has none", () => {
        const { result, exitCode } = resultOf(shared, "strict-fails@127.0.0.1");
        expect(result).toEqual({
          fetches: [origin, "DEPTH_ZERO_SELF_SIGNED_CERT", alternative],
          hits: ["GET /0"],
          dials: 2,
        });
        expect(exitCode).toBe(0);
      });

      // The connection of fetch 2 fails with no certificate check. One with the
      // check fails the same way, so fetch 3 opens none.
      test("a connection that fails with no certificate check counts for a request that has one", () => {
        const { result, exitCode } = resultOf(shared, "lax-fails@127.0.0.1");
        expect(result).toEqual({
          fetches: [origin, origin, "DEPTH_ZERO_SELF_SIGNED_CERT"],
          hits: ["GET /0", "GET /1"],
          dials: 1,
        });
        expect(exitCode).toBe(0);
      });

      // The close of connection 1 says nothing about connection 2, which works.
      test("a connection that the peer closes gets a second one, which serves the request", () => {
        const { result, exitCode } = resultOf(shared, "refused-once@127.0.0.1");
        expect(result).toEqual({ fetches: [origin, alternative, alternative], hits: ["GET /0"], dials: 2 });
        expect(exitCode).toBe(0);
      });

      // Connection 2 is closed too: fetch 2 goes to the origin, and fetch 3
      // opens no connection.
      test("two connections that the peer closes send the request to the origin", () => {
        const { result, exitCode } = resultOf(shared, "refused-twice@127.0.0.1");
        expect(result).toEqual({ fetches: [origin, origin, origin], hits: ["GET /0", "GET /1", "GET /2"], dials: 2 });
        expect(exitCode).toBe(0);
      });

      // Fetch 3 uses its second connection on the first origin, which answers
      // 302 to a second origin. The alternative of that origin closes its first
      // connection: the hop has no second connection left and goes to that
      // origin. One closed connection is no failure of the alternative, which
      // serves fetch 4.
      test("a redirect hop with no second connection left goes to the origin", () => {
        const { result, exitCode } = resultOf(shared, "redirect-to-refusing@127.0.0.1");
        expect(result).toEqual({
          fetches: [origin, origin, origin, alternative],
          hits: ["GET /0"],
          dials: 2,
          there: { hits: ["GET /0", "GET /landed"], dials: 2 },
        });
        expect(exitCode).toBe(0);
      });

      // Fetch 3 leaves its alternative for the first origin, which answers 302
      // to a second origin. The hop is a new try: the alternative of the second
      // origin serves it.
      test("a redirect hop after a fallback uses the alternative of the new origin", () => {
        const { result, exitCode } = resultOf(shared, "redirect-to-live@127.0.0.1");
        expect(result).toEqual({
          fetches: [origin, origin, alternative, alternative],
          hits: ["GET /0", "GET /redirect"],
          dials: 1,
          there: { hits: ["GET /0"], dials: 1 },
        });
        expect(exitCode).toBe(0);
      });
    });

    describe.skipIf(!isLinux || !cc)("with a shim", () => {
      const shimSource = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <netdb.h>
#include <netinet/in.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

static long number_in(const char *env) {
    const char *path = getenv(env);
    char buf[24] = {0};
    int fd = path ? open(path, O_RDONLY) : -1;
    if (fd < 0) return 0;
    long n = read(fd, buf, sizeof(buf) - 1) > 0 ? atol(buf) : 0;
    close(fd);
    return n;
}

/* A UDP connect() to the port in H3_REFUSE_UDP_PORT_FILE fails, as on a host
 * with no route for it. quic.c probes each resolved address that way. */
int connect(int fd, const struct sockaddr *addr, socklen_t len) {
    static int (*real)(int, const struct sockaddr *, socklen_t);
    if (!real) real = dlsym(RTLD_NEXT, "connect");
    int type = 0;
    socklen_t type_len = sizeof(type);
    if (addr && getsockopt(fd, SOL_SOCKET, SO_TYPE, &type, &type_len) == 0 && type == SOCK_DGRAM) {
        int port = addr->sa_family == AF_INET ? ntohs(((const struct sockaddr_in *) addr)->sin_port)
            : addr->sa_family == AF_INET6 ? ntohs(((const struct sockaddr_in6 *) addr)->sin6_port) : 0;
        if (port != 0 && port == number_in("H3_REFUSE_UDP_PORT_FILE")) {
            errno = ENETUNREACH;
            return -1;
        }
    }
    return real(fd, addr, len);
}

/* A name no resolver knows, answered with no resolver traffic. One lookup of
 * it fails after H3_FAIL_LOOKUP_FILE is written. */
int getaddrinfo(const char *node, const char *service, const struct addrinfo *hints, struct addrinfo **res) {
    static int (*real)(const char *, const char *, const struct addrinfo *, struct addrinfo **);
    if (!real) real = dlsym(RTLD_NEXT, "getaddrinfo");
    if (node && strcmp(node, "alt-svc-origin.test") == 0) {
        if (number_in("H3_FAIL_LOOKUP_FILE") != 0) {
            unlink(getenv("H3_FAIL_LOOKUP_FILE"));
            return EAI_AGAIN;
        }
        node = "127.0.0.1";
    }
    return real(node, service, hints, res);
}

/* The wall clock runs ahead by the seconds in H3_CLOCK_FILE. */
int clock_gettime(clockid_t id, struct timespec *ts) {
    static int (*real)(clockid_t, struct timespec *);
    if (!real) real = dlsym(RTLD_NEXT, "clock_gettime");
    int rc = real(id, ts);
    if (rc == 0 && id == CLOCK_REALTIME) ts->tv_sec += number_in("H3_CLOCK_FILE");
    return rc;
}
`;
      let shimDir: ReturnType<typeof tempDir>;
      let shim: string;
      beforeAll(async () => {
        shimDir = tempDir("h3-altsvc-shim", { "shim.c": shimSource });
        shim = join(String(shimDir), "shim.so");
        await using build = Bun.spawn({
          cmd: [cc!, "-shared", "-fPIC", "-O1", "-o", shim, join(String(shimDir), "shim.c"), "-ldl"],
          env: bunEnv,
          stderr: "pipe",
        });
        const [buildErr, buildExit] = await Promise.all([build.stderr.text(), build.exited]);
        if (buildExit !== 0) throw new Error("shim compile failed: " + buildErr);
      });
      afterAll(() => shimDir?.[Symbol.dispose]());

      // One process for `spec`, with the shim loaded.
      async function withShim(spec: string, env?: Record<string, string>) {
        using dir = tempDir("h3-altsvc-shim-files", {});
        const files = String(dir);
        return resultOf(
          await run([spec], {
            LD_PRELOAD: bunEnv.LD_PRELOAD ? `${shim}:${bunEnv.LD_PRELOAD}` : shim,
            H3_REFUSE_UDP_PORT_FILE: join(files, "refuse-udp-port"),
            H3_FAIL_LOOKUP_FILE: join(files, "fail-lookup"),
            H3_CLOCK_FILE: join(files, "clock"),
            ...env,
          }),
          spec,
        );
      }
      // With no DNS cache, a QUIC connect by name waits for the resolver.
      const noDnsCache = { BUN_FEATURE_FLAG_DISABLE_DNS_CACHE: "1" };

      // `localhost` resolves with no wait, so `connect()` fails before it
      // returns. Nothing was dialed, so nothing keeps fetch 3 from the same try.
      test("a QUIC connect that cannot start sends the request to the origin", async () => {
        const { result, exitCode } = await withShim("unroutable@127.0.0.1@localhost");
        expect(result).toEqual({ fetches: [origin, origin, origin], hits: ["GET /0", "GET /1", "GET /2"], dials: 0 });
        expect(exitCode).toBe(0);
      });

      // The lookup for the QUIC connect of fetch 2 fails. That says nothing
      // about the alternative, which serves fetch 3.
      test("a QUIC connect whose lookup fails sends the request to the origin", async () => {
        const { result, exitCode } = await withShim("resolver@127.0.0.1@alt-svc-origin.test", noDnsCache);
        expect(result).toEqual({ fetches: [origin, origin, alternative], hits: ["GET /0", "GET /1"], dials: 1 });
        expect(exitCode).toBe(0);
      });

      // The peer closes connection 1, and connection 2 cannot start: fetch 2
      // goes to the origin.
      test("a second QUIC connection that cannot start sends the request to the origin", async () => {
        const { result, exitCode } = await withShim("redial-unroutable@127.0.0.1@alt-svc-origin.test");
        expect(result).toEqual({ fetches: [origin, origin, origin], hits: ["GET /0", "GET /1", "GET /2"], dials: 1 });
        expect(exitCode).toBe(0);
      });

      test("a request that names HTTP/3 itself rejects when its lookup fails", async () => {
        const { result, exitCode } = await withShim("pinned-resolver@127.0.0.1@alt-svc-origin.test", noDnsCache);
        expect(result).toEqual({ fetches: ["DNSResolutionFailed"], hits: [], dials: 0 });
        expect(exitCode).toBe(0);
      });

      // Connection 1 carries fetch 2 and fails, and the alternative works from
      // then on. The origin says `ma=100`, and the failure keeps requests off
      // the alternative for 300 s. At 200 s the entry is out of date, but the
      // failure still stands: neither fetch opens a connection, although the
      // response to the first advertised again. At 400 s both are over: the
      // first fetch learns the alternative again and the second one rides it.
      test("the alternative is tried again 300 s after the failure", async () => {
        const { result, exitCode } = await withShim("deadline@127.0.0.1");
        expect(result).toEqual({
          fetches: [origin, origin, origin, origin, origin, origin, alternative],
          dialsAfterEachFetch: [1, 1, 1, 1, 1, 2],
          hits: ["GET /0", "GET /1", "GET /2", "GET /at-200", "GET /at-200", "GET /at-400"],
          dials: 2,
        });
        expect(exitCode).toBe(0);
      });
    });
  });
});

// The HTTP/3 client cannot apply per-request TLS trust configuration (custom
// ca / client cert+key / serverName): the QUIC context is created without it.
// Such requests must be refused on the forced-h3 path and kept on TCP+TLS on
// the Alt-Svc upgrade path, never connected with the options dropped.
test("custom TLS trust options are rejected on protocol: http3 and excluded from Alt-Svc h3 upgrade", async () => {
  // protocol: "http3" + a custom CA must reject up front (the CA cannot be
  // honoured over QUIC), even though the connection would otherwise succeed
  // with rejectUnauthorized: false.
  await expect(
    fetch(`${base}/hello`, {
      protocol: "http3",
      tls: { ca: tls.cert, rejectUnauthorized: false },
    } as any),
  ).rejects.toThrow();

  // Same for an mTLS client certificate, which the h3 path would never present.
  await expect(
    fetch(`${base}/hello`, {
      protocol: "http3",
      tls: { cert: tls.cert, key: tls.key, rejectUnauthorized: false },
    } as any),
  ).rejects.toThrow();

  // The plain h3 request shape (no trust customization) still works, so the
  // rejections above are about the TLS options, not h3 being broken.
  const ok = await fetch(`${base}/hello`, h3);
  expect(await ok.text()).toBe("hello over h3");

  // Alt-Svc path: with the experimental flag on, a request that carries a
  // custom CA must keep using HTTP/1.1 over TCP (where the CA is applied)
  // instead of upgrading onto a QUIC session that ignores it.
  const fixture = `
    import { fetchH3Internals } from "bun:internal-for-testing";
    const { liveCounts } = fetchH3Internals;
    const tlsOptions = ${JSON.stringify(tls)};
    using server = Bun.serve({
      port: 0,
      tls: tlsOptions,
      http3: true,
      fetch: () => new Response("ok"),
    });
    const url = "https://127.0.0.1:" + server.port + "/";
    const opts = { tls: { ca: tlsOptions.cert, rejectUnauthorized: false } };
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
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: { ...bunEnv, BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP3_CLIENT: "1" },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  // Server still advertises Alt-Svc, but with a custom CA both fetches must
  // stay off QUIC: the live h3 session count stays at 0 after the second fetch.
  expect(stdout).toMatch(/^first alt-svc=h3=":\d+"; ma=\d+ sessions=0\n/);
  expect(stdout).toMatch(/second status=200 sessions=0\n$/);
  expect(exitCode).toBe(0);
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
  // The HTTP/3 client has one context, which takes no option. QUIC is TLS 1.3, so the list would not apply to it.
  expect(JSON.parse(stdout)).toEqual({ nothing: "ok", option: "HTTP3Unsupported", assigned: "HTTP3Unsupported" });
  expect(exitCode).toBe(0);
});
