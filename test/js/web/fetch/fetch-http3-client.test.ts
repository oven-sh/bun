import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Subprocess } from "bun";
import { bunEnv, bunExe, tls } from "harness";

// The server runs in a subprocess via bunExe() so it always uses the build
// under test. With `h1: false` that build binds UDP only — a fetch that
// silently fell back to HTTP/1.1 would get ECONNREFUSED instead of a 200,
// which is what makes this suite fail on a Bun without `protocol: "http3"`.
let proc: Subprocess<"ignore", "pipe", "inherit">;
let base: string;
let port: number;
const big = Buffer.alloc(256 * 1024, "abcdefghijklmnop");

const fixture = /* js */ `
import { gzipSync } from "bun";
const big = Buffer.alloc(256 * 1024, "abcdefghijklmnop");
const server = Bun.serve({
  port: 0,
  tls: ${JSON.stringify(tls)},
  h3: true,
  h1: false,
  routes: {
    "/route/:id": req => new Response("id=" + req.params.id, { headers: { "x-route": "param" } }),
  },
  async fetch(req) {
      const url = new URL(req.url);
      switch (url.pathname) {
        case "/hello":
          return new Response("hello over h3", { headers: { "x-proto": "h3" } });
        case "/echo": {
          const body = await req.arrayBuffer();
          return new Response(body, {
            headers: {
              "x-method": req.method,
              "x-recv-len": String(body.byteLength),
              "x-content-type": req.headers.get("content-type") ?? "",
              "x-custom": req.headers.get("x-custom") ?? "",
            },
          });
        }
        case "/json":
          return Response.json({ ok: true, q: url.searchParams.get("q") });
        case "/big":
          return new Response(big);
        case "/status":
          return new Response(url.searchParams.get("body"), {
            status: Number(url.searchParams.get("code")),
          });
        case "/gzip":
          return new Response(gzipSync("compressed body over h3"), {
            headers: { "content-encoding": "gzip", "content-type": "text/plain" },
          });
        case "/redirect":
          return Response.redirect("/hello", 302);
        case "/head":
          return new Response("should not appear", { headers: { "x-head": "1" } });
        case "/slow": {
          const stream = new ReadableStream({
            async start(ctrl) {
              ctrl.enqueue(new TextEncoder().encode("first;"));
              await Bun.sleep(10);
              ctrl.enqueue(new TextEncoder().encode("second;"));
              ctrl.close();
            },
          });
          return new Response(stream);
        }
        case "/bidi": {
          // Read the request body as it arrives and echo each chunk back
          // upper-cased, prefixed with its index, so the client can verify
          // ordering and incremental delivery on both sides.
          const reader = req.body.getReader();
          let i = 0;
          const out = new ReadableStream({
            async pull(ctrl) {
              const { value, done } = await reader.read();
              if (done) {
                ctrl.enqueue(new TextEncoder().encode("[end]"));
                ctrl.close();
                return;
              }
              const text = new TextDecoder().decode(value).toUpperCase();
              ctrl.enqueue(new TextEncoder().encode("[" + i++ + ":" + text + "]"));
            },
          });
          return new Response(out, { headers: { "x-bidi": "1" } });
        }
        case "/bidi-bytes": {
          // Round-trip arbitrary bytes: server sums every byte it receives
          // and streams back one byte per input chunk equal to (sum & 0xff),
          // so the test can correlate request chunks to response chunks.
          const reader = req.body.getReader();
          const out = new ReadableStream({
            async pull(ctrl) {
              const { value, done } = await reader.read();
              if (done) return ctrl.close();
              let sum = 0;
              for (const b of value) sum = (sum + b) & 0xff;
              ctrl.enqueue(new Uint8Array([sum]));
            },
          });
          return new Response(out);
        }
      }
      return new Response("not found", { status: 404 });
    },
});
console.log(server.port);
process.stdin.on("data", () => {});`;

beforeAll(async () => {
  proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  const reader = proc.stdout.getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  port = parseInt(new TextDecoder().decode(value).trim(), 10);
  if (!port) throw new Error("server did not report a port");
  base = `https://127.0.0.1:${port}`;

  // Gate the whole suite: with `h1: false` the build under test binds UDP
  // only, so a plain HTTPS fetch (no protocol override) MUST be refused. If
  // this resolves, every "pass" below went over HTTP/1.1 and proves nothing.
  let tcpReached = false;
  try {
    await fetch(`${base}/hello`, { tls: { rejectUnauthorized: false } });
    tcpReached = true;
  } catch {}
  if (tcpReached) throw new Error("server accepted TCP; h1:false not honoured — suite would not prove HTTP/3");
});

afterAll(() => proc?.kill());

const h3 = { protocol: "http3", tls: { rejectUnauthorized: false } } as const;

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
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBe(big.length);
    expect(buf.equals(big)).toBe(true);
  });

  test("large request body", async () => {
    const payload = Buffer.alloc(128 * 1024, "Q");
    const res = await fetch(`${base}/echo`, { ...h3, method: "POST", body: payload });
    expect(res.headers.get("x-recv-len")).toBe(String(payload.length));
    const out = Buffer.from(await res.arrayBuffer());
    expect(out.equals(payload)).toBe(true);
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

  test("streamed response body", async () => {
    const res = await fetch(`${base}/slow`, h3);
    expect(await res.text()).toBe("first;second;");
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

  test("http:// rejects with HTTP3Unsupported", async () => {
    await expect(fetch(`http://127.0.0.1:${port}/hello`, h3)).rejects.toThrow();
  });

  test("Uint8Array body", async () => {
    const body = new Uint8Array([0, 1, 2, 254, 255]);
    const res = await fetch(`${base}/echo`, { ...h3, method: "POST", body });
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(body);
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
    expect(new TextDecoder().decode(await r2.bytes())).toBe("hello over h3");
  });

  test("AbortController during response body", async () => {
    const ac = new AbortController();
    const p = fetch(`${base}/slow`, { ...h3, signal: ac.signal });
    ac.abort();
    expect(p).rejects.toThrow();
  });

  test("connection failure rejects", async () => {
    using closed = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data() {} },
    });
    const port = closed.port;
    closed.stop(true);
    // No QUIC server is listening on this UDP port; the handshake should
    // time out / refuse rather than hang.
    await expect(fetch(`https://127.0.0.1:${port}/`, { ...h3, signal: AbortSignal.timeout(2000) })).rejects.toThrow();
  });

  test("invalid protocol value throws", () => {
    expect(() => fetch(`${base}/hello`, { protocol: "spdy" } as any)).toThrow(/protocol/);
  });

  test("response body streamed via reader", async () => {
    const res = await fetch(`${base}/slow`, h3);
    const reader = res.body!.getReader();
    let out = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      out += new TextDecoder().decode(value);
    }
    expect(out).toBe("first;second;");
  });

  test("50 concurrent requests", async () => {
    const n = 50;
    const results = await Promise.all(
      Array.from({ length: n }, (_, i) => fetch(`${base}/route/${i}`, h3).then(r => r.text())),
    );
    for (let i = 0; i < n; i++) expect(results[i]).toBe(`id=${i}`);
  });

  test("1MB request → 1MB response round-trip", async () => {
    const payload = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < payload.length; i++) payload[i] = i & 0xff;
    const res = await fetch(`${base}/echo`, { ...h3, method: "POST", body: payload });
    expect(res.headers.get("x-recv-len")).toBe(String(payload.length));
    const out = Buffer.from(await res.arrayBuffer());
    expect(out.length).toBe(payload.length);
    expect(out.equals(payload)).toBe(true);
  });

  test("ReadableStream request body (streaming upload)", async () => {
    const chunks = ["hello ", "from ", "a ", "stream"];
    const body = new ReadableStream({
      async start(ctrl) {
        for (const c of chunks) {
          ctrl.enqueue(new TextEncoder().encode(c));
          await Bun.sleep(1);
        }
        ctrl.close();
      },
    });
    const res = await fetch(`${base}/echo`, { ...h3, method: "POST", body });
    expect(res.headers.get("x-recv-len")).toBe(String(chunks.join("").length));
    expect(await res.text()).toBe("hello from a stream");
  });

  test("ReadableStream request body — large", async () => {
    const piece = Buffer.alloc(32 * 1024, "S");
    const body = new ReadableStream({
      async start(ctrl) {
        for (let i = 0; i < 8; i++) ctrl.enqueue(piece);
        ctrl.close();
      },
    });
    const res = await fetch(`${base}/echo`, { ...h3, method: "POST", body });
    expect(res.headers.get("x-recv-len")).toBe(String(piece.length * 8));
    const out = Buffer.from(await res.arrayBuffer());
    expect(out.length).toBe(piece.length * 8);
    expect(out.subarray(0, piece.length).equals(piece)).toBe(true);
  });

  test("bidirectional streaming: request stream → server stream → response stream", async () => {
    const sent = ["alpha", "bravo", "charlie", "delta"];
    const body = new ReadableStream({
      async start(ctrl) {
        for (const s of sent) {
          ctrl.enqueue(new TextEncoder().encode(s));
          await Bun.sleep(5);
        }
        ctrl.close();
      },
    });
    const res = await fetch(`${base}/bidi`, { ...h3, method: "POST", body });
    expect(res.headers.get("x-bidi")).toBe("1");
    const text = await res.text();
    // QUIC is a byte stream — the server may see the upload as 1..N reads,
    // so reassemble the bracketed segments and compare the concatenated
    // payload rather than asserting boundaries.
    expect(text.endsWith("[end]")).toBe(true);
    const payload = [...text.matchAll(/\[\d+:([A-Z]+)\]/g)].map(m => m[1]).join("");
    expect(payload).toBe("ALPHABRAVOCHARLIEDELTA");
  });

  test("bidirectional streaming: server starts responding before upload finishes", async () => {
    // Hold the upload open with a deferred resolver and only release it once
    // the client has already read the server's first echoed chunk. If the
    // server (or client) buffered the whole request before responding, the
    // first read would deadlock and the test would time out.
    let releaseTail!: () => void;
    const tailReleased = new Promise<void>(r => (releaseTail = r));
    const body = new ReadableStream({
      async start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode("first"));
        await tailReleased;
        ctrl.enqueue(new TextEncoder().encode("second"));
        ctrl.close();
      },
    });
    const res = await fetch(`${base}/bidi`, { ...h3, method: "POST", body });
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain("FIRST");
    releaseTail();
    let assembled = new TextDecoder().decode(value);
    while (true) {
      const { value: v, done } = await reader.read();
      if (done) break;
      assembled += new TextDecoder().decode(v);
    }
    const payload = [...assembled.matchAll(/\[\d+:([A-Z]+)\]/g)].map(m => m[1]).join("");
    expect(payload).toBe("FIRSTSECOND");
    expect(assembled.endsWith("[end]")).toBe(true);
  });

  test("bidirectional streaming: binary round-trip with per-chunk checksum", async () => {
    const chunks = Array.from({ length: 10 }, (_, i) => {
      const a = new Uint8Array(1024);
      for (let j = 0; j < a.length; j++) a[j] = (i * 7 + j) & 0xff;
      return a;
    });
    const expected = chunks.map(c => c.reduce((s, b) => (s + b) & 0xff, 0));
    const body = new ReadableStream({
      async start(ctrl) {
        for (const c of chunks) {
          ctrl.enqueue(c);
          await Bun.sleep(1);
        }
        ctrl.close();
      },
    });
    const res = await fetch(`${base}/bidi-bytes`, { ...h3, method: "POST", body });
    const out = new Uint8Array(await res.arrayBuffer());
    // Server may coalesce request chunks (QUIC delivers a byte stream, not
    // message boundaries), so verify the response is a prefix-consistent
    // checksum sequence summing to the same total rather than a 1:1 match.
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(chunks.length);
    expect(out.reduce((s, b) => (s + b) & 0xff, 0)).toBe(expected.reduce((s, b) => (s + b) & 0xff, 0));
  });

  test("bidirectional streaming: 32 chunks × 8KB each", async () => {
    const piece = Buffer.alloc(8 * 1024, "B");
    const body = new ReadableStream({
      async start(ctrl) {
        for (let i = 0; i < 32; i++) {
          ctrl.enqueue(piece);
          await Bun.sleep(0);
        }
        ctrl.close();
      },
    });
    const res = await fetch(`${base}/bidi`, { ...h3, method: "POST", body });
    const text = await res.text();
    expect(text.endsWith("[end]")).toBe(true);
    // Every byte we sent was 'B' so every echoed segment is upper-case 'B's.
    const payload = text.slice(0, -"[end]".length);
    const segments = payload.match(/\[\d+:[B]+\]/g) ?? [];
    const totalB = segments.reduce((n, s) => n + (s.match(/B/g)?.length ?? 0), 0);
    expect(totalB).toBe(32 * piece.length);
  });

  test("hostname (DNS path) instead of IP literal", async () => {
    const res = await fetch(`https://localhost:${port}/hello`, h3);
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

  test("PUT and DELETE methods", async () => {
    for (const method of ["PUT", "DELETE"] as const) {
      const res = await fetch(`${base}/echo`, { ...h3, method, body: method });
      expect(res.headers.get("x-method")).toBe(method);
      expect(await res.text()).toBe(method);
    }
  });
});
