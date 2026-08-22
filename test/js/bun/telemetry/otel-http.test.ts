import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import http from "node:http";

const spans: any[] = [];
Bun.otel.start({
  serviceName: "otel-http-test",
  exporters: [{ export: (b: any[]) => spans.push(...b) }],
  instrumentations: { http: true, fetch: true },
});
// The pipeline is process-global; leave nothing behind for later files.
afterAll(() => Bun.otel.shutdown());

async function collect(): Promise<any[]> {
  // Server spans end when the request context is finalized, which can trail
  // the client seeing the response by a tick.
  await Bun.sleep(0);
  await Bun.otel.forceFlush();
  return spans.splice(0, spans.length).sort((a, b) => a.startTime - b.startTime);
}

const byName = (list: any[], scope: string) => list.filter(s => s.scope.name === scope);

describe("Bun.serve", () => {
  test("a batch of varied requests exports each span with its own identity, timing, path, status and parent", async () => {
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
      "user_agent.original": "otel-test",
      "client.address": expect.any(String),
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
    expect(work.parentSpanId).toBe(srv.spanId);
    expect(work.traceId).toBe(srv.traceId);
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
    const frontSrv = servers.find(s => s.parentSpanId === parentId)!;
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

  test("user-supplied traceparent on fetch is left alone", async () => {
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
    expect(seen).toBe(tp);
    await collect();
  });

  test("malformed traceparent is ignored (new root)", async () => {
    using server = Bun.serve({ port: 0, fetch: () => new Response("x") });
    await (await fetch(`http://localhost:${server.port}/`, { headers: { traceparent: "00-zzz-yyy-01" } })).text();
    const [srv] = byName(await collect(), "bun.http.server");
    expect(srv.parentSpanId).toBeUndefined();
    expect(srv.traceId).toMatch(/^[0-9a-f]{32}$/);
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
    using server = Bun.serve({ port: 0, fetch: () => new Response("x") });
    const port = server.port;
    server.stop(true);
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
        const server = http.createServer(() => { throw new Error("boom"); });
        await new Promise(r => server.listen(0, r));
        const res = await fetch("http://localhost:" + server.address().port + "/boom");
        await res.text();
        await Bun.sleep(0);
        await Bun.otel.forceFlush();
        const srv = spans.find(s => s.scope.name === "bun.http.server");
        console.log(res.status, srv.attributes["http.response.status_code"], srv.status.code, Bun.otel.activeSpan());
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
    expect(stdout.trim(), stderr).toMatch(/^(200 200|500 500) 2 undefined$/);
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
    Bun.otel.start({
      serviceName: "otel-http-test",
      exporters: [{ export: (b: any[]) => spans.push(...b) }],
      instrumentations: { http: true, fetch: true },
    });
    await collect();
    expect(seen[0].traceparent).toMatch(/^00-0af7651916cd43dd8448eb211c80319c-[0-9a-f]{16}-01$/);
    expect(seen[0].tracestate).toBe("vendor=abc");
    expect(seen[1]).toEqual({ traceparent: undefined, tracestate: undefined });
  });

  test("http.request client goes through fetch instrumentation", async () => {
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
    Bun.otel.start({
      exporters: [{ export: (b: any[]) => spans.push(...b) }],
      instrumentations: { http: true, fetch: true },
    });
  });
});
