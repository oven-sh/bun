import {
  ROOT_CONTEXT as API_ROOT,
  context as apiContext,
  propagation as apiPropagation,
  trace as apiTrace,
} from "@opentelemetry/api";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import http from "node:http";

const spans: any[] = [];
function restore() {
  Bun.otel.start({
    serviceName: "otel-http-test",
    exporters: [{ export: (b: any[]) => spans.push(...b) }],
    instrumentations: { http: true, fetch: true },
  });
}
restore();
// Tests below may reconfigure; each starts from the default pipeline.
beforeEach(restore);
// The pipeline is process-global; leave nothing behind for later files.
afterAll(() => Bun.otel.shutdown());

async function collect(atLeast = 0): Promise<any[]> {
  // Server spans end when the request context is finalized, which can trail
  // the client seeing the response; poll (bounded) rather than assume one tick.
  const deadline = Date.now() + 5000;
  do {
    await Bun.sleep(0);
    await Bun.otel.forceFlush();
  } while (spans.length < atLeast && Date.now() < deadline);
  return spans.splice(0, spans.length).sort((a, b) => a.startTime - b.startTime);
}

const byName = (list: any[], scope: string) => list.filter(s => s.scope.name === scope);
/** Configure like restore() but with fetch spans off, so this process's fetch() acts as an external, uninstrumented caller. */
function asExternalClient() {
  Bun.otel.start({
    exporters: [{ export: (b: any[]) => spans.push(...b) }],
    instrumentations: { http: true, fetch: false },
  });
}

describe("Bun.serve", () => {
  test("a batch of varied requests exports each span with its own identity, timing, path, status and parent", async () => {
    asExternalClient();
    using server = Bun.serve({
      port: 0,
      routes: {
        "/r/:id": req => new Response(req.params.id, { status: 200 + (Number(req.params.id) % 3) }),
      },
      fetch(req) {
        return new Response("nf", { status: 404 });
      },
    });
    const N = 40;
    const expected: any[] = [];
    for (let i = 0; i < N; i++) {
      const traceId = i % 2 ? i.toString(16).padStart(2, "0").repeat(16) : undefined;
      const headers: Record<string, string> = { "user-agent": i % 5 ? "ua-a" : "ua-b/" + i };
      if (traceId) headers.traceparent = `00-${traceId}-${"a".repeat(16)}-01`;
      const path = i % 4 === 3 ? `/other/${i}?x=${i}` : `/r/${i}`;
      const res = await fetch(`http://127.0.0.1:${server.port}${path}`, { headers });
      await res.text();
      expected.push({ i, traceId, path, status: res.status, ua: headers["user-agent"] });
    }
    const all = await collect();
    const got = byName(all, "bun.http.server");
    const clients = byName(all, "bun.http.client");
    expect(got.length).toBe(N);
    const seen = new Set<string>();
    for (let k = 0; k < N; k++) {
      const s = got[k];
      const e = expected[k];
      const [p, q] = e.path.split("?");
      expect(s.attributes["url.path"]).toBe(p);
      expect(s.attributes["url.query"]).toBe(q);
      expect(s.attributes["http.response.status_code"]).toBe(e.status);
      expect(s.attributes["user_agent.original"]).toBe(e.ua);
      expect(s.name).toBe(p.startsWith("/r/") ? "GET /r/:id" : "GET");
      if (e.traceId) {
        expect(s.traceId).toBe(e.traceId);
        expect(s.parentSpanId).toBe("a".repeat(16));
      } else {
        // parented under this process's fetch CLIENT span
        expect(s.parentSpanId).toBe(clients.find(c => c.traceId === s.traceId)?.spanId);
      }
      expect(seen.has(s.spanId)).toBe(false);
      seen.add(s.spanId);
      expect(s.endTime).toBeGreaterThanOrEqual(s.startTime);
      if (k > 0) expect(s.startTime).toBeGreaterThanOrEqual(got[k - 1].startTime);
    }
  });

  test("server span per request with semconv attributes, parented under the fetch client span", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("hi", { status: 201, headers: { "x-test": "1" } });
      },
    });
    const res = await fetch(`http://localhost:${server.port}/path/here?q=1`, {
      headers: { "user-agent": "otel-test" },
    });
    expect(res.status).toBe(201);
    await res.text();
    const got = await collect();
    const [client] = byName(got, "bun.http.client");
    const [srv] = byName(got, "bun.http.server");
    expect(client).toBeDefined();
    expect(srv).toBeDefined();
    expect(client.kind).toBe(2); // CLIENT
    expect(srv.kind).toBe(1); // SERVER
    expect(client.parentSpanId).toBeUndefined();
    expect(srv.traceId).toBe(client.traceId);
    expect(srv.parentSpanId).toBe(client.spanId);
    expect(client.name).toBe("GET");
    expect(client.attributes).toEqual({
      "http.request.method": "GET",
      "url.full": `http://localhost:${server.port}/path/here?q=1`,
      "server.address": "localhost",
      "server.port": server.port,
      "network.protocol.version": "1.1",
      "http.response.status_code": 201,
    });
    expect(srv.name).toBe("GET");
    expect(srv.attributes).toEqual({
      "http.request.method": "GET",
      "url.path": "/path/here",
      "url.query": "q=1",
      "url.scheme": "http",
      "server.address": "localhost",
      "server.port": server.port,
      "network.protocol.version": "1.1",
      "user_agent.original": "otel-test",
      "client.address": expect.stringMatching(/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/),
      "network.peer.address": expect.stringMatching(/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/),
      "network.peer.port": expect.any(Number),
      "http.response.status_code": 201,
    });
    expect(srv.status.code).toBe(0);
    expect(client.status.code).toBe(0);
  });

  test("routes: span name and http.route use the matched pattern", async () => {
    using server = Bun.serve({
      port: 0,
      routes: {
        "/api/users/:id": req => new Response(req.params.id),
        "/static": new Response("static"),
      },
      fetch: () => new Response("fallback"),
    });
    await (await fetch(`http://localhost:${server.port}/api/users/42`)).text();
    await (await fetch(`http://localhost:${server.port}/other`)).text();
    const got = byName(await collect(), "bun.http.server");
    expect(got.map(s => [s.name, s.attributes["http.route"]])).toEqual([
      ["GET /api/users/:id", "/api/users/:id"],
      ["GET", undefined],
    ]);
  });

  test("activeSpan() inside the handler is the server span; user attributes land on it; children parent to it", async () => {
    const tracer = Bun.otel.tracer("app");
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const active = Bun.otel.activeSpan()!;
        expect(active.kind).toBe(1); // api SpanKind.SERVER
        active.setAttribute("app.user", "u1");
        active.setAttributes({ "app.plain": 1, "app.list": ["a", 2], "app.skip": undefined });
        active.setAttributes({
          get "app.getter"() {
            return "g";
          },
        });
        Bun.otel.set({ "app.set": true, "app.キー": "値" });
        await Bun.sleep(1);
        expect(Bun.otel.activeSpan()).toBe(active);
        const child = tracer.startSpan("work");
        child.end();
        return new Response("ok");
      },
    });
    await (await fetch(`http://localhost:${server.port}/`)).text();
    const got = await collect();
    const [srv] = byName(got, "bun.http.server");
    const [work] = byName(got, "app");
    expect(srv.attributes["app.user"]).toBe("u1");
    expect(srv.attributes).toMatchObject({
      "app.plain": 1,
      "app.list": ["a", 2],
      "app.getter": "g",
      "app.set": true,
      "app.キー": "値",
    });
    expect(srv.attributes).not.toHaveProperty("app.skip");
    expect(work.parentSpanId).toBe(srv.spanId);
    expect(work.traceId).toBe(srv.traceId);
  });

  test("http.route set from the handler names the span (routers on plain fetch / node:http)", async () => {
    using server = Bun.serve({
      port: 0,
      fetch() {
        Bun.otel.set("http.route", "/users/:id");
        return new Response("ok");
      },
    });
    await (await fetch(`http://localhost:${server.port}/users/7`)).text();
    const [srv] = byName(await collect(2), "bun.http.server");
    expect([srv.name, srv.attributes["http.route"], srv.attributes["url.path"]]).toEqual([
      "GET /users/:id",
      "/users/:id",
      "/users/7",
    ]);

    const node = http.createServer((req, res) => {
      Bun.otel.activeSpan()!.setAttribute("http.route", "/n/:id");
      res.end("ok");
    });
    await new Promise<void>(r => node.listen(0, r));
    await (await fetch(`http://127.0.0.1:${(node.address() as any).port}/n/1`)).text();
    await new Promise<void>(r => node.close(() => r()));
    const [nsrv] = byName(await collect(2), "bun.http.server");
    expect([nsrv.name, nsrv.attributes["http.route"]]).toEqual(["GET /n/:id", "/n/:id"]);
  });

  test("a semconv attribute set from JS replaces the derived one instead of being exported twice", async () => {
    let bytes: Uint8Array | undefined;
    Bun.otel.start({
      instrumentations: { http: true, fetch: false },
      exporters: [{ exportProtobuf: (b: Uint8Array) => (bytes = b) }],
    });
    using server = Bun.serve({
      port: 0,
      fetch() {
        // the 500 below would derive http.response.status_code=500 and error.type="500";
        // url.path / client.address are per-request tail attributes
        Bun.otel.set({
          "http.response.status_code": 299,
          "server.address": "front.example",
          "error.type": "UpstreamDown",
          "url.path": "/redacted",
          "client.address": "hidden",
        });
        return new Response("no", { status: 500 });
      },
    });
    await (await fetch(`http://localhost:${server.port}/secret/path`)).text();
    const deadline = Date.now() + 5000;
    do {
      await Bun.sleep(0);
      await Bun.otel.forceFlush();
    } while (!bytes && Date.now() < deadline);
    const raw = Buffer.from(bytes!);
    const count = (key: string) => raw.toString("latin1").split(key).length - 1;
    // one SERVER span only (fetch spans are off): every key exactly once in the wire bytes
    expect(
      ["http.response.status_code", "server.address", "error.type", "url.path", "client.address"].map(count),
    ).toEqual([1, 1, 1, 1, 1]);
    expect(raw.includes("/secret/path")).toBe(false);
    const [srv] = Bun.otel.decode(bytes!);
    expect(
      ["http.response.status_code", "server.address", "error.type", "url.path", "client.address"].map(
        k => srv.attributes[k],
      ),
    ).toEqual([299, "front.example", "UpstreamDown", "/redacted", "hidden"]);
    expect(srv.status.code).toBe(2); // still an error: the response was a 500
    expect(srv.droppedAttributesCount ?? 0).toBe(0);
  });

  test("5xx marks server span as error; 4xx does not", async () => {
    // Static route responses bypass RequestContext, so use a dynamic handler.
    using server2 = Bun.serve({
      port: 0,
      fetch(req) {
        const p = new URL(req.url).pathname;
        return new Response("x", { status: p === "/500" ? 500 : 404 });
      },
    });
    await (await fetch(`http://localhost:${server2.port}/500`)).text();
    await (await fetch(`http://localhost:${server2.port}/404`)).text();
    const got = byName(await collect(), "bun.http.server");
    expect(
      got.map(s => [s.attributes["http.response.status_code"], s.status.code, s.attributes["error.type"]]),
    ).toEqual([
      [500, 2, "500"],
      [404, 0, undefined],
    ]);
  });

  test("thrown handler error → 500 + error status", async () => {
    using server = Bun.serve({
      port: 0,
      fetch() {
        throw new Error("nope");
      },
      error() {
        return new Response("handled", { status: 500 });
      },
    });
    await (await fetch(`http://localhost:${server.port}/`)).text();
    const [srv] = byName(await collect(), "bun.http.server");
    expect(srv.attributes["http.response.status_code"]).toBe(500);
    expect(srv.status.code).toBe(2);
  });

  test("incoming traceparent is honoured and tracestate/baggage forwarded on outgoing fetch", async () => {
    let inner: Headers | undefined;
    using backend = Bun.serve({
      port: 0,
      fetch(req) {
        inner = new Headers(req.headers);
        return new Response("b");
      },
    });
    let seenTraceState: any;
    using front = Bun.serve({
      port: 0,
      async fetch() {
        const ts = Bun.otel.activeSpan()!.spanContext().traceState as Bun.otel.TraceState;
        seenTraceState = {
          vendor: ts.get("vendor"),
          serialized: ts.serialize(),
          updated: ts.set("other", "2").unset("vendor").serialize(),
          original: ts.serialize(),
        };
        await fetch(`http://localhost:${backend.port}/`);
        return new Response("f");
      },
    });
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const parentId = "00f067aa0ba902b7";
    await (
      await fetch(`http://localhost:${front.port}/`, {
        headers: {
          traceparent: `00-${traceId}-${parentId}-01`,
          tracestate: "vendor=abc,other=1",
          baggage: "userId=42",
        },
      })
    ).text();
    const got = await collect();
    const servers = byName(got, "bun.http.server");
    const clients = byName(got, "bun.http.client");
    // The test's own fetch() to `front` is traced too: caller (traceparent) → CLIENT → front SERVER.
    const outerClient = clients.find(c => c.parentSpanId === parentId)!;
    expect(outerClient).toBeDefined();
    const frontSrv = servers.find(s => s.parentSpanId === outerClient.spanId)!;
    expect(frontSrv).toBeDefined();
    expect(frontSrv.traceId).toBe(traceId);
    expect(frontSrv.traceState).toBe("vendor=abc,other=1");
    // spanContext().traceState is an api-shaped, immutable TraceState
    expect(seenTraceState).toEqual({
      vendor: "abc",
      serialized: "vendor=abc,other=1",
      updated: "other=2",
      original: "vendor=abc,other=1",
    });
    // every span downstream of the front server shares the incoming trace id
    // (the test's own outer fetch carries a user-supplied traceparent, so its
    // client span is deliberately left out of that trace)
    expect(
      new Set(
        [...servers, ...clients.filter(c => c.attributes["url.full"].includes(String(backend.port)))].map(
          s => s.traceId,
        ),
      ),
    ).toEqual(new Set([traceId]));
    // outbound propagation
    expect(inner!.get("traceparent")).toMatch(new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`));
    expect(inner!.get("tracestate")).toBe("vendor=abc,other=1");
    expect(inner!.get("baggage")).toBe("userId=42");
    const innerClient = clients.find(c => c.attributes["url.full"].includes(String(backend.port)))!;
    expect(inner!.get("traceparent")).toBe(`00-${traceId}-${innerClient.spanId}-01`);
  });

  test("a request span handed to later work still carries its tracestate and baggage after the response went out", async () => {
    asExternalClient();
    let late: Promise<any> | undefined;
    using server = Bun.serve({
      port: 0,
      fetch() {
        const span = Bun.otel.activeSpan()!; // materialized, nothing read yet
        late = new Promise(resolve =>
          setTimeout(() => {
            const carrier: Record<string, string> = {};
            Bun.otel.propagator.inject(apiTrace.setSpan(API_ROOT, span), carrier, {
              set: (c: any, k: string, v: string) => (c[k] = v),
            });
            resolve({ ts: (span.spanContext().traceState as any)?.serialize() ?? "", carrier, name: span.name });
          }, 20),
        );
        return new Response("ok");
      },
    });
    await (
      await fetch(`http://localhost:${server.port}/`, {
        headers: {
          traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
          tracestate: "vendor=late",
          baggage: "k=v",
        },
      })
    ).text();
    await collect(1); // the SERVER span has ended by now
    const { ts, carrier, name } = await late!;
    expect([ts, carrier.tracestate, carrier.baggage, name]).toEqual(["vendor=late", "vendor=late", "k=v", "GET"]);
  });

  test("a traceparent the caller sets on fetch() becomes the CLIENT span's parent and the header is re-pointed at the CLIENT span", async () => {
    let seen: string | null = null;
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        seen = req.headers.get("traceparent");
        return new Response("x");
      },
    });
    const tp = "00-11111111111111111111111111111111-2222222222222222-01";
    await (await fetch(`http://localhost:${server.port}/`, { headers: { traceparent: tp } })).text();
    const got = await collect();
    const [client] = byName(got, "bun.http.client");
    const [srv] = byName(got, "bun.http.server");
    // caller (1111…/2222…) → CLIENT → SERVER, one trace
    expect(client.traceId).toBe("1".repeat(32));
    expect(client.parentSpanId).toBe("2".repeat(16));
    expect(seen).toBe(`00-${"1".repeat(32)}-${client.spanId}-01`);
    expect(srv.traceId).toBe("1".repeat(32));
    expect(srv.parentSpanId).toBe(client.spanId);
    // with fetch spans off the header is forwarded untouched
    asExternalClient();
    await (await fetch(`http://localhost:${server.port}/`, { headers: { traceparent: tp } })).text();
    expect(seen).toBe(tp);
    await collect();
  });

  test("malformed traceparent is ignored (new root)", async () => {
    asExternalClient();
    using server = Bun.serve({ port: 0, fetch: () => new Response("x") });
    await (await fetch(`http://localhost:${server.port}/`, { headers: { traceparent: "00-zzz-yyy-01" } })).text();
    const [srv] = byName(await collect(), "bun.http.server");
    expect(srv.parentSpanId).toBeUndefined();
    expect(srv.traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  test("two traceparent headers on one request are invalid: new root (W3C test_traceparent_duplicated)", async () => {
    asExternalClient();
    using server = Bun.serve({ port: 0, fetch: () => new Response("x") });
    const tp1 = "00-11111111111111111111111111111111-2222222222222222-01";
    const tp2 = "00-33333333333333333333333333333333-4444444444444444-01";
    // fetch() would join them into one field; write the raw request so there are two
    const sock = await Bun.connect({
      hostname: "127.0.0.1",
      port: server.port,
      socket: {
        data(s) {
          s.end();
        },
      },
    });
    sock.write(`GET / HTTP/1.1\r\nHost: localhost\r\ntraceparent: ${tp1}\r\ntraceparent: ${tp2}\r\nConnection: close\r\n\r\n`);
    const [srv] = byName(await collect(1), "bun.http.server");
    expect(srv.parentSpanId).toBeUndefined();
    expect([tp1.slice(3, 35), tp2.slice(3, 35)]).not.toContain(srv.traceId);
  });

  test("websocket upgrade ends the request span with 101", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req, srv) {
        if (srv.upgrade(req)) return;
        return new Response("no");
      },
      websocket: {
        message(ws, m) {
          ws.send(m);
        },
      },
    });
    const ws = new WebSocket(`ws://localhost:${server.port}/sock`);
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("ws error"));
    ws.onclose = e => reject(new Error(`ws closed ${e.code}`));
    await promise;
    ws.onclose = null;
    ws.close();
    const [srv] = byName(await collect(), "bun.http.server");
    expect(srv.attributes["url.path"]).toBe("/sock");
    expect(srv.attributes["http.response.status_code"]).toBe(101);
  });
});

describe("fetch", () => {
  test("network error produces an error span", async () => {
    // Accepts and immediately drops every connection (held so no concurrent
    // test is handed the port).
    using server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(s) {
          s.end();
        },
        data() {},
      },
    });
    const port = server.port;
    await fetch(`http://localhost:${port}/`).then(
      r => r.text(),
      () => {},
    );
    const got = byName(await collect(), "bun.http.client");
    const failed = got.find(s => s.status.code === 2);
    expect(failed).toBeDefined();
    expect(failed.attributes["error.type"]).toEqual(expect.any(String));
    expect(failed.attributes["http.response.status_code"]).toBeUndefined();
  });

  test("credentials in URL are redacted", async () => {
    using server = Bun.serve({ port: 0, fetch: () => new Response("x") });
    await (await fetch(`http://user:secret@localhost:${server.port}/p`)).text();
    await (await fetch(`http://user:p%40ss@localhost:${server.port}/q?x=@y`)).text();
    const [a, b] = byName(await collect(), "bun.http.client");
    expect(a.attributes["url.full"]).toBe(`http://REDACTED:REDACTED@localhost:${server.port}/p`);
    expect(b.attributes["url.full"]).toBe(`http://REDACTED:REDACTED@localhost:${server.port}/q?x=@y`);
    expect(JSON.stringify([a, b])).not.toMatch(/secret|p%40ss/);
  });

  test("4xx marks the client span as error", async () => {
    using server = Bun.serve({ port: 0, fetch: () => new Response("x", { status: 418 }) });
    await (await fetch(`http://localhost:${server.port}/`)).text();
    const [client] = byName(await collect(), "bun.http.client");
    expect(client.status.code).toBe(2);
    expect(client.attributes["error.type"]).toBe("418");
  });
});

describe("node:http", () => {
  test("a client request that throws on an invalid header (array headers) still finishes its span", async () => {
    expect(() => http.request({ host: "127.0.0.1", port: 1, headers: [["bad name!", "v"]] as any })).toThrow();
    expect(() => http.request({ host: "127.0.0.1", port: 1, headers: ["bad name!", "v"] as any })).toThrow();
    // throws after the headers were stored (option validation in the constructor tail)
    expect(() => http.request({ host: "127.0.0.1", port: 1, uniqueHeaders: [null] } as any)).toThrow();
    // throws while the header array is scanned for an existing traceparent
    const hostile = new Proxy(["x-a", "1"], {
      get(t, k, r) {
        if (k === "0") throw new Error("hostile headers");
        return Reflect.get(t, k, r);
      },
    });
    // (throws while the headers are scanned, before a span exists: nothing to end, nothing leaked)
    expect(() => http.request({ host: "127.0.0.1", port: 1, headers: hostile as any })).toThrow("hostile headers");
    const got = byName(await collect(), "bun.http.client");
    expect(got.map(s => [s.status.code, typeof s.attributes["error.type"]])).toEqual([
      [2, "string"],
      [2, "string"],
      [2, "string"],
    ]);
    // nothing is left half-open in the pool
    expect(Bun.otel.stats().spansPending).toBe(0);
  });

  test("server spans for node:http createServer", async () => {
    const server = http.createServer((req, res) => {
      Bun.otel.activeSpan()?.setAttribute("node.handler", true);
      res.writeHead(202, { "content-type": "text/plain" });
      res.end("node");
    });
    const { promise, resolve } = Promise.withResolvers<void>();
    server.listen(0, () => resolve());
    await promise;
    const port = (server.address() as any).port;
    try {
      const res = await fetch(`http://localhost:${port}/n?x=2`);
      expect(res.status).toBe(202);
      await res.text();
      const got = await collect();
      const [srv] = byName(got, "bun.http.server");
      const [client] = byName(got, "bun.http.client");
      expect(srv).toBeDefined();
      expect(srv.parentSpanId).toBe(client.spanId);
      expect(srv.attributes).toMatchObject({
        "http.request.method": "GET",
        "url.path": "/n",
        "url.query": "x=2",
        "http.response.status_code": 202,
        "node.handler": true,
      });
    } finally {
      server.close();
    }
  });

  test("node:http handler that throws → 500 span with error status", async () => {
    // Under bun:test a synchronous throw in the handler is intercepted by the
    // runner, so exercise it in a plain process.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("node:http");
        const spans = [];
        Bun.otel.start({ exporters: [{ export: b => spans.push(...b) }], instrumentations: { http: true } });
        process.on("uncaughtException", () => {});
        let n = 0;
        const server = http.createServer(() => { throw n++ ? Object.assign(new Error("coded"), { code: "EBOOM" }) : new TypeError("boom"); });
        await new Promise(r => server.listen(0, r));
        const res = await fetch("http://localhost:" + server.address().port + "/boom");
        await res.text();
        await Bun.sleep(0);
        await Bun.otel.forceFlush();
        const srv = spans.find(s => s.scope.name === "bun.http.server");
        console.log(res.status, srv.attributes["http.response.status_code"], srv.status.code, Bun.otel.activeSpan());
        // the synchronous throw is described like an async rejection: exception event + error.type + message
        console.log(srv.attributes["error.type"], srv.status.message, srv.events[0]?.name, srv.events[0]?.attributes["exception.type"]);
        // an error with a .code reports the code as its type
        spans.length = 0;
        await (await fetch("http://localhost:" + server.address().port + "/boom2")).text();
        await Bun.sleep(0);
        await Bun.otel.forceFlush();
        const coded = spans.find(s => s.scope.name === "bun.http.server");
        console.log(coded.attributes["error.type"], coded.events[0]?.attributes["exception.type"]);
        server.close();
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // node:http currently answers 200 (empty body) when a handler throws with an
    // uncaughtException listener installed — pre-existing behaviour on main. What
    // this test pins is that the span is ERROR (2) and matches what was sent.
    const [line1, line2, line3] = stdout.trim().split("\n");
    expect(line1, stderr).toMatch(/^(200 200|500 500) 2 undefined$/);
    expect(line2).toBe("TypeError boom exception TypeError");
    expect(line3).toBe("EBOOM EBOOM");
    expect(exitCode, stderr).toBe(0);
  });

  test("http.request injects traceparent/tracestate under a traced request and honours propagators: []", async () => {
    let seen: Record<string, string | undefined>[] = [];
    using upstream = Bun.serve({
      port: 0,
      fetch(req) {
        seen.push({
          traceparent: req.headers.get("traceparent") ?? undefined,
          tracestate: req.headers.get("tracestate") ?? undefined,
        });
        return new Response("u");
      },
    });
    const get = () =>
      new Promise<void>((resolve, reject) => {
        const req = http.request(`http://localhost:${upstream.port}/x`, res => {
          res.resume();
          res.on("end", resolve);
        });
        req.on("error", reject);
        req.end();
      });
    using front = Bun.serve({
      port: 0,
      async fetch() {
        await get();
        return new Response("f");
      },
    });
    Bun.otel.start({
      exporters: [{ export: (b: any[]) => spans.push(...b) }],
      instrumentations: { http: true, fetch: true },
    });
    await (
      await fetch(`http://localhost:${front.port}/`, {
        headers: { traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01", tracestate: "vendor=abc" },
      })
    ).text();
    Bun.otel.start({
      exporters: [{ export: (b: any[]) => spans.push(...b) }],
      instrumentations: { http: true, fetch: true },
      propagators: [],
    });
    await (await fetch(`http://localhost:${front.port}/`)).text();
    await collect();
    expect(seen[0].traceparent).toMatch(/^00-0af7651916cd43dd8448eb211c80319c-[0-9a-f]{16}-01$/);
    expect(seen[0].tracestate).toBe("vendor=abc");
    expect(seen[1]).toEqual({ traceparent: undefined, tracestate: undefined });
  });

  test("http.request with array-form headers still carries traceparent (flat and [k, v] pairs)", async () => {
    const seen: Record<string, string | null>[] = [];
    using upstream = Bun.serve({
      port: 0,
      fetch(req) {
        seen.push({ traceparent: req.headers.get("traceparent"), xa: req.headers.get("x-a") });
        return new Response("u");
      },
    });
    const get = (headers: any) =>
      new Promise<void>((resolve, reject) => {
        const req = http.request({ host: "localhost", port: upstream.port, path: "/x", headers }, res => {
          res.resume();
          res.on("end", resolve);
          res.on("error", reject);
        });
        req.on("error", reject);
        req.end();
      });
    const span = Bun.otel.tracer("t").startSpan("parent");
    await Bun.otel.with(span, () => get(["Host", "localhost", "x-a", "1"]));
    await Bun.otel.with(span, () =>
      get([
        ["Host", "localhost"],
        ["x-a", "2"],
      ]),
    );
    // a caller-supplied traceparent in the array: under an active span it is
    // replaced (the active span is the parent); with none it becomes the parent
    await Bun.otel.with(span, () =>
      get(["Host", "localhost", "x-a", "3", "TraceParent", "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"]),
    );
    await get([
      "Host",
      "localhost",
      "x-a",
      "4",
      "TraceParent",
      "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
    ]);
    span.end();
    await collect();
    const traceId = span.spanContext().traceId;
    expect(seen[0]).toEqual({
      traceparent: expect.stringMatching(new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`)),
      xa: "1",
    });
    expect(seen[1]).toEqual({
      traceparent: expect.stringMatching(new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`)),
      xa: "2",
    });
    expect(seen[2]).toEqual({
      traceparent: expect.stringMatching(new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`)),
      xa: "3",
    });
    // no active span: the caller's trace, re-pointed at the request's own CLIENT span
    expect(seen[3]).toEqual({
      traceparent: expect.stringMatching(/^00-0af7651916cd43dd8448eb211c80319c-[0-9a-f]{16}-01$/),
      xa: "4",
    });
    expect(seen[3].traceparent).not.toBe("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01");
  });

  test("node:http client span ends with the response body, and reports a body cut short as an error", async () => {
    const { promise: release, resolve } = Promise.withResolvers<void>();
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        if (new URL(req.url).pathname === "/slow") {
          return new Response(
            new ReadableStream({
              async start(c) {
                c.enqueue(new TextEncoder().encode("part"));
                await release;
                c.enqueue(new TextEncoder().encode("rest"));
                c.close();
              },
            }),
          );
        }
        return new Response("whole");
      },
    });
    // complete body: span ends at 'end', OK
    await new Promise<void>(r => http.get(`http://127.0.0.1:${server.port}/ok`, res => res.resume().on("end", r)));
    // headers arrive, then the client destroys mid-body: span ends with an error
    await new Promise<void>(r =>
      http.get(`http://127.0.0.1:${server.port}/slow`, res => {
        res.once("data", () => {
          res.destroy();
          setTimeout(r, 10);
        });
      }),
    );
    resolve();
    const got = byName(await collect(), "bun.http.client");
    expect(got.map(s => [s.attributes["http.response.status_code"], s.status.code])).toEqual([
      [200, 0],
      [200, 2],
    ]);
  });

  test("node:http: a complete response whose socket is closed later is not an error; no 'error' listener semantics change", async () => {
    // a server that answers completely and then drops the connection
    using server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(s) {
          s.write("HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nwhole");
          s.end();
        },
      },
    });
    let sawErrorEvent = false;
    const res: any = await new Promise(resolve =>
      http.get(`http://127.0.0.1:${server.port}/`, resolve).on("error", () => (sawErrorEvent = true)),
    );
    // no resume(): the app never reads the body, so 'end' does not fire before the socket closes
    await new Promise<void>(r => (res.socket?.destroyed ? r() : res.req.once("close", r)));
    const [client] = byName(await collect(), "bun.http.client");
    expect([
      client.attributes["http.response.status_code"],
      client.status.code,
      client.attributes["error.type"],
    ]).toEqual([200, 0, undefined]);
    expect([res.errored, sawErrorEvent]).toEqual([null, false]);
  });

  test("node:http: a request the agent fails itself (proxy tunnel error) still ends its CLIENT span, once", async () => {
    // https.Agent behind a proxy: the agent emits 'error' on the request and
    // hands it the connection error, so the client skips its own error path.
    const agent = new http.Agent();
    (agent as any).createConnection = (_opts: unknown, oncreate: Function) => {
      process.nextTick(oncreate, Object.assign(new Error("tunnel"), { code: "ERR_PROXY_TUNNEL" }));
    };
    const req = http.get({ host: "127.0.0.1", port: 1, agent });
    const { promise, resolve } = Promise.withResolvers<any>();
    req.on("error", resolve);
    const err = await promise;
    await new Promise<void>(r => (req.destroyed && (req as any)._closed ? r() : req.once("close", r)));
    // a DOMException-style numeric .code is not a type: error.type is the code only when it is a string
    const failed = http.get({ host: "127.0.0.1", port: 1, agent });
    failed.on("error", () => {});
    failed.destroy(new DOMException("gone", "AbortError"));
    await new Promise<void>(r => ((failed as any)._closed ? r() : failed.once("close", r)));
    const clients = byName(await collect(2), "bun.http.client");
    expect(err.code).toBe("ERR_PROXY_TUNNEL");
    expect(clients.map(s => [s.status.code, s.attributes["error.type"]])).toEqual([
      [2, "ERR_PROXY_TUNNEL"],
      [2, "AbortError"],
    ]);
  });

  test("node:http server: a ws upgrade ends the SERVER span with 101", async () => {
    const { WebSocketServer } = require("ws");
    const httpServer = http.createServer((req, res) => res.end("no"));
    const wss = new WebSocketServer({ server: httpServer });
    try {
      wss.on("connection", ws => ws.close());
      await new Promise<void>(r => httpServer.listen(0, "127.0.0.1", r));
      const ws = new WebSocket("ws://127.0.0.1:" + (httpServer.address() as any).port);
      await new Promise(r => (ws.onclose = r));
      const [srv] = byName(await collect(), "bun.http.server");
      expect(srv.attributes["http.response.status_code"]).toBe(101);
    } finally {
      wss.close();
      httpServer.close();
    }
  });

  test("node:http: an Upgrade / CONNECT response ends the CLIENT span with its status", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req, srv) {
        if (srv.upgrade(req)) return;
        return new Response("no");
      },
      websocket: { message() {} },
    });
    await new Promise<void>((resolve, reject) => {
      const req = http.request({
        host: "127.0.0.1",
        port: server.port,
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version": "13",
        },
      });
      req.on("upgrade", (res, socket) => {
        socket.destroy();
        resolve();
      });
      req.on("error", reject);
      req.end();
    });
    const [client] = byName(await collect(), "bun.http.client");
    expect([client.attributes["http.response.status_code"], client.status.code]).toEqual([101, 0]);
    expect(Bun.otel.stats().spansPending).toBe(0);
  });

  test("node:http server: a raw 'upgrade' handoff ends the SERVER span at the handoff, not as an aborted request when the tunnel closes", async () => {
    asExternalClient();
    const srv = http.createServer((req, res) => res.end("plain"));
    srv.on("upgrade", (req, socket) => {
      socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: raw\r\n\r\n");
      socket.on("data", d => socket.write(d)); // echo tunnel
    });
    await new Promise<void>(r => srv.listen(0, r));
    const port = (srv.address() as any).port;
    const echoed = await new Promise<string>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, headers: { Connection: "Upgrade", Upgrade: "raw" } });
      req.on("upgrade", (res, socket) => {
        socket.write("ping");
        socket.once("data", d => {
          socket.destroy();
          resolve(String(d));
        });
      });
      req.on("error", reject);
      req.end();
    });
    expect(echoed).toBe("ping");
    const [server] = byName(await collect(1), "bun.http.server");
    await new Promise<void>(r => srv.close(() => r()));
    // ended at the handoff: not an error, no "aborted"
    expect([server.name, server.status.code, server.attributes["error.type"]]).toEqual(["GET", 0, undefined]);
  });

  test("node:http CONNECT through a proxy: client span names the proxy, server span ends at the tunnel handoff", async () => {
    const proxy = http.createServer((req, res) => res.end("plain"));
    proxy.on("connect", (req, socket) => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      socket.on("data", d => socket.write(d));
    });
    await new Promise<void>(r => proxy.listen(0, r));
    const port = (proxy.address() as any).port;
    await new Promise<void>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, method: "CONNECT", path: "example.com:443" });
      req.on("connect", (res, socket) => {
        socket.destroy();
        resolve();
      });
      req.on("error", reject);
      req.end();
    });
    const got = await collect(2);
    await new Promise<void>(r => proxy.close(() => r()));
    const [client] = byName(got, "bun.http.client");
    const [server] = byName(got, "bun.http.server");
    expect(client.attributes).toMatchObject({
      "http.request.method": "CONNECT",
      "url.full": `http://127.0.0.1:${port}`,
      "server.address": "127.0.0.1",
      "server.port": port,
      "http.response.status_code": 200,
    });
    expect([server.name, server.status.code, server.attributes["error.type"]]).toEqual(["CONNECT", 0, undefined]);
  });

  test("node:http and fetch describe an unknown method the same way", async () => {
    using server = Bun.serve({ port: 0, fetch: () => new Response("x") });
    await (await fetch(server.url, { method: "PROPFIND" })).text();
    await new Promise<void>(r =>
      http
        .request({ host: "127.0.0.1", port: server.port, method: "PROPFIND" }, res => res.resume().on("end", r))
        .end(),
    );
    // a token the runtime's method enum does not know at all (Bun.serve refuses
    // those, so a bare socket answers it)
    using raw = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(s) {
          s.write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
          s.end();
        },
      },
    });
    await new Promise<void>(r =>
      http.request({ host: "127.0.0.1", port: raw.port, method: "FOO" }, res => res.resume().on("end", r)).end(),
    );
    const got = byName(await collect(), "bun.http.client");
    expect(
      got.map(s => [
        s.name,
        s.attributes["http.request.method"],
        s.attributes["http.request.method_original"],
        s.attributes["network.protocol.version"],
      ]),
    ).toEqual([
      ["HTTP", "_OTHER", "PROPFIND", "1.1"],
      ["HTTP", "_OTHER", "PROPFIND", "1.1"],
      ["HTTP", "_OTHER", "FOO", "1.1"],
    ]);
  });

  test("http.request client gets a CLIENT span and injects traceparent", async () => {
    using server = Bun.serve({ port: 0, fetch: () => new Response("x") });
    await new Promise<void>((resolve, reject) => {
      const req = http.request(`http://localhost:${server.port}/hr`, res => {
        res.resume();
        res.on("end", resolve);
      });
      req.on("error", reject);
      req.end();
    });
    const [client] = byName(await collect(), "bun.http.client");
    expect(client.attributes["url.full"]).toBe(`http://localhost:${server.port}/hr`);
  });
});

describe("http.request.method", () => {
  test("methods outside the semconv known set are _OTHER with method_original and span name HTTP", async () => {
    // (methods uWS cannot parse at all never reach a handler: 400 before any span)
    const { promise: listening, resolve } = Promise.withResolvers<void>();
    const server = http.createServer((req: any, res: any) => res.end(req.method)).listen(0, resolve);
    await listening;
    try {
      const statusLine = await new Promise<string>(resolve => {
        let buf = "";
        Bun.connect({
          hostname: "127.0.0.1",
          port: server.address().port,
          socket: {
            open(s) {
              s.write("PROPFIND /x HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n");
            },
            data(_s, d) {
              buf += d.toString();
            },
            close() {
              resolve(buf.split("\r\n")[0]);
            },
          },
        });
      });
      expect(statusLine).toBe("HTTP/1.1 200 OK");
      const [srv] = byName(await collect(), "bun.http.server");
      expect([srv.name, srv.attributes["http.request.method"], srv.attributes["http.request.method_original"]]).toEqual(
        ["HTTP", "_OTHER", "PROPFIND"],
      );
    } finally {
      server.close();
    }
  });

  test("a handler that throws after entering an AsyncLocalStorage store still serves the error response", async () => {
    const als = new AsyncLocalStorage();
    using server = Bun.serve({
      port: 0,
      fetch() {
        als.enterWith("x");
        throw new Error("boom");
      },
      error() {
        return new Response("handled", { status: 555 });
      },
    });
    const res = await fetch(`http://127.0.0.1:${server.port}/`);
    expect([res.status, await res.text()]).toEqual([555, "handled"]);
    const [srv] = byName(await collect(), "bun.http.server");
    expect(srv.attributes["http.response.status_code"]).toBe(555);
  });
});

describe("baggage propagation", () => {
  test("fetch sends baggage from the active context even with the trace-context propagator off", async () => {
    const seen: (string | null)[][] = [];
    using upstream = Bun.serve({
      port: 0,
      fetch(req) {
        seen.push([req.headers.get("traceparent"), req.headers.get("baggage")]);
        return new Response("x");
      },
    });
    Bun.otel.start({
      exporters: [{ export: (b: any[]) => spans.push(...b) }],
      instrumentations: { fetch: true },
      propagators: ["baggage"],
    });
    await apiContext.with(
      apiPropagation.setBaggage(API_ROOT, apiPropagation.createBaggage({ t: { value: "1" } })),
      () => fetch(upstream.url).then(r => r.text()),
    );
    expect(seen).toEqual([[null, "t=1"]]);
    await collect();
  });
});

describe("live request span", () => {
  test("activeSpan().name inside a handler is the name the span will export with", async () => {
    using server = Bun.serve({
      port: 0,
      routes: { "/users/:id": () => new Response(Bun.otel.activeSpan()!.name) },
      fetch: () => new Response(Bun.otel.activeSpan()!.name),
    });
    const named = await (await fetch(new URL("/users/7", server.url))).text();
    const unnamed = await (await fetch(new URL("/other", server.url), { method: "POST" })).text();
    expect([named, unnamed]).toEqual(["GET /users/:id", "POST"]);
    const got = byName(await collect(), "bun.http.server").map(s => s.name);
    expect(got.sort()).toEqual(["GET /users/:id", "POST"]);
  });
});

describe("static routes", () => {
  test("a static Response route gets a SERVER span with its route and the status actually written", async () => {
    asExternalClient();
    using server = Bun.serve({
      port: 0,
      routes: {
        "/static": new Response("hello", { status: 202 }),
        "/etag": new Response("cached"),
        "/dyn": () => new Response("d"),
      },
      fetch: () => new Response("f"),
    });
    await (await fetch(new URL("/static?sig=SECRET&x=1", server.url))).text();
    await (await fetch(new URL("/static", server.url), { method: "HEAD" })).text();
    const first = await fetch(new URL("/etag", server.url));
    await first.text();
    const etag = first.headers.get("etag")!;
    expect((await fetch(new URL("/etag", server.url), { headers: { "if-none-match": etag } })).status).toBe(304);
    const got = byName(await collect(), "bun.http.server");
    expect(
      got.map(s => [
        s.name,
        s.attributes["http.response.status_code"],
        s.attributes["http.route"],
        s.attributes["url.query"],
      ]),
    ).toEqual([
      ["GET /static", 202, "/static", "sig=REDACTED&x=1"],
      ["HEAD /static", 202, "/static", undefined],
      ["GET /etag", 200, "/etag", undefined],
      ["GET /etag", 304, "/etag", undefined],
    ]);
  });

  test("requests parked while an HTML bundle builds get a SERVER span too", async () => {
    using dir = tempDir("otel-html", { "index.html": "<!doctype html><title>x</title><p>hi" });
    const { default: html } = await import(require("node:path").join(String(dir), "index.html"));
    asExternalClient();
    using server = Bun.serve({ port: 0, development: false, routes: { "/": html }, fetch: () => new Response("f") });
    // the first requests arrive while the bundle is still building
    await Promise.all([fetch(server.url).then(r => r.text()), fetch(server.url).then(r => r.text())]);
    await (await fetch(server.url)).text();
    const got = byName(await collect(), "bun.http.server");
    expect(got.map(s => [s.name, s.attributes["http.response.status_code"]])).toEqual([
      ["GET /", 200],
      ["GET /", 200],
      ["GET /", 200],
    ]);
  });
});

describe("request facts", () => {
  test("an HTTP/1.0 request line is reported as network.protocol.version 1.0", async () => {
    using server = Bun.serve({ port: 0, fetch: () => new Response("x") });
    const sock = await Bun.connect({
      hostname: "127.0.0.1",
      port: server.port,
      socket: {
        data(s) {
          s.end();
        },
        open(s) {
          s.write("GET /old HTTP/1.0\r\nHost: h\r\n\r\n");
        },
      },
    });
    const [srv] = byName(await collect(1), "bun.http.server");
    sock.end();
    expect(srv.attributes["network.protocol.version"]).toBe("1.0");
  });

  test("request bytes that are not UTF-8 are exported as valid UTF-8 (U+FFFD)", async () => {
    using server = Bun.serve({ port: 0, fetch: () => new Response("x") });
    const sock = await Bun.connect({
      hostname: "127.0.0.1",
      port: server.port,
      socket: {
        data(s) {
          s.end();
        },
        open(s) {
          s.write(
            Buffer.concat([
              Buffer.from("GET /a"),
              Buffer.from([0xfe]),
              Buffer.from("b?q="),
              Buffer.from([0xfd]),
              Buffer.from(" HTTP/1.1\r\nHost: h\r\nUser-Agent: curl/"),
              Buffer.from([0xff]),
              Buffer.from("8\r\n\r\n"),
            ]),
          );
        },
      },
    });
    const [srv] = byName(await collect(1), "bun.http.server");
    sock.end();
    expect([srv.attributes["user_agent.original"], srv.attributes["url.path"], srv.attributes["url.query"]]).toEqual([
      "curl/\uFFFD8",
      "/a\uFFFDb",
      "q=\uFFFD",
    ]);
  });

  test('instrumentations: { http: "nested" } records only requests that carry a traceparent', async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const spans = [];
        Bun.otel.start({ exporters: [{ export: b => spans.push(...b) }], instrumentations: { http: "nested", fetch: false } });
        using server = Bun.serve({ port: 0, fetch: () => new Response("x") });
        await fetch(server.url);
        await fetch(server.url, { headers: { traceparent: "00-11111111111111111111111111111111-2222222222222222-01" } });
        await Bun.otel.forceFlush();
        console.log(JSON.stringify(spans.map(s => s.parentSpanContext?.spanId ?? s.parentSpanId)));
        `,
      ],
      env: bunEnv,
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe(JSON.stringify(["2222222222222222"]));
    expect(exitCode).toBe(0);
  });

  test("repeated tracestate / baggage request headers are combined into one list", async () => {
    let seenBaggage: string | undefined, seenTs: string | undefined;
    using server = Bun.serve({
      port: 0,
      fetch() {
        seenBaggage = apiPropagation
          .getActiveBaggage()
          ?.getAllEntries()
          .map(([k, v]) => `${k}=${v.value}`)
          .join(",");
        seenTs = (Bun.otel.activeSpan()!.spanContext().traceState as any)?.serialize();
        return new Response("x");
      },
    });
    const sock = await Bun.connect({
      hostname: "127.0.0.1",
      port: server.port,
      socket: {
        data(s) {
          s.end();
        },
        open(s) {
          s.write(
            "GET / HTTP/1.1\r\nHost: h\r\ntraceparent: 00-11111111111111111111111111111111-2222222222222222-01\r\ntracestate: a=1\r\ntracestate: b=2\r\nbaggage: x=1\r\nbaggage: y=2\r\n\r\n",
          );
        },
      },
    });
    await collect(1);
    sock.end();
    expect([seenTs, seenBaggage]).toEqual(["a=1, b=2", "x=1,y=2"]);
  });

  test("a repeated request header captured via OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_SERVER_REQUEST is joined", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const spans = [];
        Bun.otel.start({ exporters: [{ export: b => spans.push(...b) }], instrumentations: { http: true } });
        const server = Bun.serve({ port: 0, fetch: () => new Response("x") });
        const s = await Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { data(s) { s.end(); }, open(s) { s.write("GET / HTTP/1.1\\r\\nHost: h\\r\\nX-Forwarded-For: a\\r\\nX-Forwarded-For: b\\r\\n\\r\\n"); } } });
        for (let i = 0; i < 500 && !spans.some(s => s.scope.name === "bun.http.server"); i++) { await Bun.sleep(10); await Bun.otel.forceFlush(); }
        console.log(JSON.stringify(spans.find(s => s.scope.name === "bun.http.server").attributes["http.request.header.x-forwarded-for"]));
        server.stop(true);
        `,
      ],
      env: { ...bunEnv, OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_SERVER_REQUEST: "x-forwarded-for" },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe(JSON.stringify(["a, b"]));
    expect(exitCode).toBe(0);
  });

  test("credential-bearing query values are redacted in url.full / url.query (fetch, node:http, server)", async () => {
    using server = Bun.serve({ port: 0, fetch: () => new Response("x") });
    const q = "?X-Amz-Date=1&X-Goog-Signature=g00g&sig=s3cr3t&Signature=abc&AWSAccessKeyId=AKIA&ok=1";
    await (await fetch(`${server.url}f${q}`)).text();
    await new Promise<void>(r => http.get(`http://127.0.0.1:${server.port}/n${q}`, res => res.resume().on("end", r)));
    const got = await collect();
    const redacted =
      "X-Amz-Date=1&X-Goog-Signature=REDACTED&sig=REDACTED&Signature=REDACTED&AWSAccessKeyId=REDACTED&ok=1";
    expect(byName(got, "bun.http.client").map(s => new URL(s.attributes["url.full"]).search.slice(1))).toEqual([
      redacted,
      redacted,
    ]);
    expect(byName(got, "bun.http.server").map(s => s.attributes["url.query"])).toEqual([redacted, redacted]);
  });
});

describe("fetch client", () => {
  test("inside a handler, fetch(url, { headers: req.headers }) is a child of the SERVER span even though the headers carry the caller's traceparent", async () => {
    let forwarded: string | null = null;
    using upstream = Bun.serve({
      port: 0,
      fetch(req) {
        forwarded = req.headers.get("traceparent");
        return new Response("u");
      },
    });
    using proxy = Bun.serve({
      port: 0,
      async fetch(req) {
        return new Response(await (await fetch(upstream.url, { headers: req.headers })).text());
      },
    });
    asExternalClient();
    const tp = "00-11111111111111111111111111111111-2222222222222222-01";
    Bun.otel.start({
      exporters: [{ export: (b: any[]) => spans.push(...b) }],
      instrumentations: { http: true, fetch: true },
    });
    // (this fetch has no active span, so the caller header is its parent — see the test above)
    await (await fetch(proxy.url, { headers: { traceparent: tp } })).text();
    const got = await collect();
    const proxySrv = byName(got, "bun.http.server").find(s => s.attributes["server.port"] === proxy.port)!;
    const inner = byName(got, "bun.http.client").find(c => c.attributes["url.full"].includes(String(upstream.port)))!;
    expect(inner.parentSpanId).toBe(proxySrv.spanId);
    expect(forwarded).toBe(`00-${"1".repeat(32)}-${inner.spanId}-01`);
  });

  test('with fetch: "nested" a caller-set traceparent alone does not start a CLIENT span (fetch and node:http alike)', async () => {
    Bun.otel.start({
      exporters: [{ export: (b: any[]) => spans.push(...b) }],
      instrumentations: { http: false, fetch: "nested" },
    });
    using server = Bun.serve({ port: 0, fetch: () => new Response("x") });
    const tp = "00-11111111111111111111111111111111-2222222222222222-01";
    await (await fetch(server.url, { headers: { traceparent: tp } })).text();
    await new Promise<void>(r =>
      http.get(`http://127.0.0.1:${server.port}/`, { headers: { traceparent: tp } }, res => res.resume().on("end", r)),
    );
    expect(byName(await collect(), "bun.http.client")).toEqual([]);
  });

  test("an AbortSignal abort ends the fetch CLIENT span without an error status", async () => {
    const { promise: hit, resolve } = Promise.withResolvers<void>();
    using server = Bun.serve({
      port: 0,
      async fetch() {
        resolve();
        await Bun.sleep(60_000);
        return new Response("late");
      },
    });
    const ac = new AbortController();
    const req = fetch(server.url, { signal: ac.signal }).then(r => r.text());
    await hit;
    ac.abort();
    await expect(req).rejects.toThrow();
    const [client] = byName(await collect(), "bun.http.client");
    expect([
      client.status.code,
      client.attributes["error.type"],
      client.attributes["http.response.status_code"],
    ]).toEqual([0, undefined, undefined]);
  });

  test("a tracestate extracted from a carrier with control characters is not written into outgoing requests", async () => {
    let seen: (string | null)[] = [];
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        seen.push(req.headers.get("tracestate"), req.headers.get("x-injected"));
        return new Response("x");
      },
    });
    const ctx = apiPropagation.extract(apiContext.active(), {
      traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
      tracestate: "a=1\r\nX-Injected: 1",
    });
    await apiContext.with(ctx, () => fetch(server.url).then(r => r.text()));
    expect(seen).toEqual([null, null]);
    await collect();
  });
});

describe("upgrade", () => {
  test("a rejected upgrade (unsupported Sec-WebSocket-Version → 426) records the status on the request span", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("no", { status: 400 });
      },
      websocket: { message() {} },
    });
    const res = await fetch(server.url, {
      headers: {
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version": "12",
      },
    });
    expect(res.status).toBe(426);
    const [srv] = byName(await collect(), "bun.http.server");
    expect(srv.attributes["http.response.status_code"]).toBe(426);
  });
});

describe("Bun.otel.set", () => {
  test("Bun.otel.set annotates the active request span without materializing a Span", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        Bun.otel.set("app.user", "u1");
        Bun.otel.set({ "app.plan": "pro", "app.n": 3 });
        return new Response("ok");
      },
    });
    await (await fetch(server.url)).text();
    const [srv] = byName(await collect(), "bun.http.server");
    expect(srv.attributes).toMatchObject({ "app.user": "u1", "app.plan": "pro", "app.n": 3 });
  });
});

describe("client.address", () => {
  test("comes from X-Forwarded-For even when there is no socket peer (unix listener); IPv6 Host is bare", async () => {
    using dir = tempDir("otel-unix", {});
    const unix = require("node:path").join(String(dir), "s.sock");
    using server = Bun.serve({ unix, fetch: () => new Response("x") });
    await (
      await fetch("http://[::1]:8080/u", { unix, headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } })
    ).text();
    const [srv] = byName(await collect(), "bun.http.server");
    expect(srv.attributes["client.address"]).toBe("203.0.113.7");
    expect(srv.attributes["network.peer.address"]).toBeUndefined();
    expect(srv.attributes["server.address"]).toBe("::1");
    expect(srv.attributes["server.port"]).toBe(8080);
  });
});

describe("limits", () => {
  test("attributeValueLengthLimit applies to captured request header values (string[] attribute)", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const spans = [];
        Bun.otel.start({ exporters: [{ export: b => spans.push(...b) }], instrumentations: { http: true }, limits: { attributeValueLengthLimit: 8 } });
        const server = Bun.serve({ port: 0, fetch: () => new Response("x") });
        await (await fetch(server.url, { headers: { "x-request-id": "0123456789abcdef" } })).text();
        await Bun.otel.forceFlush();
        console.log(JSON.stringify(spans.find(s => s.scope.name === "bun.http.server").attributes["http.request.header.x-request-id"]));
        server.stop(true);
        `,
      ],
      env: { ...bunEnv, OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_SERVER_REQUEST: "x-request-id" },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe(JSON.stringify(["01234567"]));
    expect(exitCode).toBe(0);
  });

  test("attributeValueLengthLimit never splits a UTF-8 sequence and never over-runs on non-UTF-8 input", async () => {
    Bun.otel.start({ exporters: [{ export: (b: any[]) => spans.push(...b) }], limits: { attributeValueLengthLimit: 4 } });
    const s = Bun.otel.tracer("t").startSpan("lim");
    // 4-byte, 2-byte and 3-byte code points straddling the 4-byte limit, and a JS-owned span too
    s.setAttributes({ a: "a\u{1F600}b", b: "aaaé", c: "aa値", d: "abcd", e: "abcde" });
    s.end();
    const fs = require("node:fs");
    Bun.otel.span("native", () => {
      // a request-independent native span: fs under an active parent; the path is not UTF-8
      try {
        fs.statSync(Buffer.from([0x2f, 0x80, 0x80, 0x80, 0x80, 0x80, 0x41]));
      } catch {}
    });
    const got = await collect();
    const lim = got.find(x => x.name === "lim");
    expect([lim.attributes.a, lim.attributes.b, lim.attributes.c, lim.attributes.d, lim.attributes.e]).toEqual([
      "a",
      "aaa",
      "aa",
      "abcd",
      "abcd",
    ]);
    const stat = got.find(x => x.name === "fs.statSync");
    // cut at 4 bytes, then each stray continuation byte becomes U+FFFD: never empty, never longer than the input cut
    expect(stat.attributes["file.path"]).toBe("/\uFFFD\uFFFD\uFFFD");
  });

  test("attributeValueLengthLimit applies to leaf spans too (fetch url.full)", async () => {
    using server = Bun.serve({ port: 0, fetch: () => new Response("x") });
    Bun.otel.start({
      exporters: [{ export: (b: any[]) => spans.push(...b) }],
      instrumentations: { fetch: true },
      limits: { attributeValueLengthLimit: 20 },
    });
    await (await fetch(`http://127.0.0.1:${server.port}/${"p".repeat(64)}`)).text();
    const [client] = byName(await collect(), "bun.http.client");
    expect(client.attributes["url.full"].length).toBe(20);
  });

  test("a reconfigured attributeValueLengthLimit applies to requests of an already-seen shape", async () => {
    using server = Bun.serve({ port: 0, fetch: () => new Response("x") });
    const ua = "x".repeat(40);
    await (await fetch(`http://localhost:${server.port}/`, { headers: { "user-agent": ua } })).text();
    const [before] = byName(await collect(), "bun.http.server");
    Bun.otel.start({
      exporters: [{ export: (b: any[]) => spans.push(...b) }],
      instrumentations: { http: true, fetch: true },
      limits: { attributeValueLengthLimit: 8 },
    });
    await (await fetch(`http://localhost:${server.port}/`, { headers: { "user-agent": ua } })).text();
    const [after] = byName(await collect(), "bun.http.server");
    expect(before.attributes["user_agent.original"]).toBe(ua);
    expect(after.attributes["user_agent.original"]).toBe("x".repeat(8));
  });
});

describe("attribute count limit", () => {
  test("request spans honour attributeCountLimit including attributes set from JS", async () => {
    Bun.otel.start({
      exporters: [{ export: (b: any[]) => spans.push(...b) }],
      instrumentations: { http: true, fetch: true },
      limits: { attributeCountLimit: 16 },
    });
    using server = Bun.serve({
      port: 0,
      fetch() {
        const s = Bun.otel.activeSpan()!;
        for (let i = 0; i < 20; i++) s.setAttribute("k" + i, i);
        return new Response("x");
      },
    });
    await (await fetch(`http://localhost:${server.port}/p?q=1`)).text();
    const [srv] = byName(await collect(), "bun.http.server");
    expect(Object.keys(srv.attributes).length).toBe(16);
    // JS-set attributes are kept first; the rest is reported as dropped.
    expect(srv.attributes.k0).toBe(0);
    expect(srv.attributes.k15).toBe(15);
    // everything that did not fit is counted: 20 JS-set + the request's own attributes - 16 kept
    const [full] = await (async () => {
      Bun.otel.start({ exporters: [{ export: (b: any[]) => spans.push(...b) }], instrumentations: { http: true } });
      await (await fetch(`http://localhost:${server.port}/p?q=1`)).text();
      return byName(await collect(), "bun.http.server");
    })();
    expect(srv.droppedAttributesCount).toBe(Object.keys(full.attributes).length - 16);
  });

  test("setAttributes with more keys than C++ gathers per list reaches the span with every key", async () => {
    const N = 4200; // past TelemetryABI.h kTelemetryMaxGather
    const plain: Record<string, number> = {};
    for (let i = 0; i < N; i++) plain["k" + i] = i;
    // a getter makes the object take the flattened (Object.keys) path
    const exotic: Record<string, number> = {
      get g0() {
        return 0;
      },
    };
    for (let i = 1; i < N; i++) exotic["g" + i] = i;
    const serve = (attrs: object | null, prefix: string) =>
      Bun.serve({
        port: 0,
        fetch() {
          const s = Bun.otel.activeSpan()!;
          if (attrs) {
            s.setAttribute(prefix + (N - 1), -1);
            s.setAttributes(attrs);
          }
          return new Response("x");
        },
      });
    const request = async (server: { port: number }) => {
      await (await fetch(`http://localhost:${server.port}/`)).text();
      return byName(await collect(), "bun.http.server")[0];
    };
    let ownTotal: number;
    {
      using server = serve(null, "");
      ownTotal = Object.keys((await request(server)).attributes).length;
    }
    const limit = 100;
    for (const [attrs, prefix] of [
      [plain, "k"],
      [exotic, "g"],
    ] as const) {
      Bun.otel.start({
        exporters: [{ export: (b: any[]) => spans.push(...b) }],
        instrumentations: { http: true },
        limits: { attributeCountLimit: limit },
      });
      using server = serve(attrs, prefix);
      const srv = await request(server);
      const keys = Object.keys(srv.attributes);
      const kept = keys.filter(k => k.startsWith(prefix)).length;
      expect(keys.length).toBe(limit);
      // set first, so it is kept; the object's last key (past the 4096th) still overwrites it
      expect(srv.attributes[prefix + (N - 1)]).toBe(N - 1);
      // every key that did not fit is counted, including the ones past the 4096th (an overwrite is not a drop)
      expect(srv.droppedAttributesCount).toBe(N - kept + (ownTotal - (keys.length - kept)));
    }
  });
});

describe("disable", () => {
  test("instrumentations: { http: false } stops server spans but keeps fetch", async () => {
    Bun.otel.start({
      exporters: [{ export: (b: any[]) => spans.push(...b) }],
      instrumentations: { http: false, fetch: true },
    });
    using server = Bun.serve({ port: 0, fetch: () => new Response("x") });
    await (await fetch(`http://localhost:${server.port}/`)).text();
    const got = await collect();
    expect(byName(got, "bun.http.server")).toHaveLength(0);
    expect(byName(got, "bun.http.client")).toHaveLength(1);
  });
});
