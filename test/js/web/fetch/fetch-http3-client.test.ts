import { gzipSync, type Server } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tls } from "harness";

// In-process server with `h1: false` so the build under test binds UDP only.
// A fetch that silently fell back to HTTP/1.1 would get ECONNREFUSED, which
// is what makes this suite prove `protocol: "http3"` actually works.
let server: Server;
let base: string;
const big = Buffer.alloc(256 * 1024, "abcdefghijklmnop");

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    tls,
    h3: true,
    h1: false,
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
  if (tcpReached) throw new Error("server accepted TCP; h1:false not honoured — suite would not prove HTTP/3");
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
      const s = Bun.serve({ port: 0, tls, h3: true, h1: false, routes: { "/n": () => new Response(String(i)) } });
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
    h3: true,
    h1: false,
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
  const b = Bun.serve({ port, reusePort: true, tls, h3: true, h1: false, fetch: () => new Response("b") });
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
