import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";

// @ts-expect-error TODO(@jarred): packages/bun-types
const otel = Bun.otel;

function hex(buf: Uint8Array) {
  return Buffer.from(buf).toString("hex");
}

describe("Bun.otel context propagation", () => {
  test("getActiveSpanContext is undefined with no active span", () => {
    expect(otel.getActiveSpanContext()).toBeUndefined();
  });

  test("startActiveSpan: context survives await and restores after", async () => {
    otel.configure({ endpoint: "", sampler: "always_on" });
    const tracer = otel.getTracer("test");
    let inside: string | undefined;
    let afterAwait: string | undefined;
    const result = await tracer.startActiveSpan("a", async span => {
      inside = hex(otel.getActiveSpanContext().spanId);
      await Promise.resolve();
      afterAwait = hex(otel.getActiveSpanContext().spanId);
      expect(hex(span.spanContext.spanId)).toBe(inside);
      return 42;
    });
    expect(result).toBe(42);
    expect(inside).toBeDefined();
    expect(afterAwait).toBe(inside);
    expect(otel.getActiveSpanContext()).toBeUndefined();
  });

  test("startActiveSpan: overlapping Promise.all each sees own span", async () => {
    otel.configure({ endpoint: "", sampler: "always_on" });
    const tracer = otel.getTracer("test");
    const seen: Record<string, string> = {};
    await Promise.all([
      tracer.startActiveSpan("a", async span => {
        await Promise.resolve();
        seen.a = hex(otel.getActiveSpanContext().spanId);
        expect(seen.a).toBe(hex(span.spanContext.spanId));
      }),
      tracer.startActiveSpan("b", async span => {
        await Promise.resolve();
        seen.b = hex(otel.getActiveSpanContext().spanId);
        expect(seen.b).toBe(hex(span.spanContext.spanId));
      }),
    ]);
    expect(seen.a).not.toBe(seen.b);
    expect(otel.getActiveSpanContext()).toBeUndefined();
  });

  test("startActiveSpan: nested child inherits parent traceId", async () => {
    otel.configure({ endpoint: "", sampler: "always_on" });
    const tracer = otel.getTracer("test");
    let outerTrace: string | undefined;
    let innerTrace: string | undefined;
    await tracer.startActiveSpan("outer", async outer => {
      outerTrace = hex(outer.spanContext.traceId);
      await tracer.startActiveSpan("inner", async inner => {
        innerTrace = hex(inner.spanContext.traceId);
      });
    });
    expect(innerTrace).toBe(outerTrace);
  });

  test("startActiveSpan: sync throw ends span and rethrows", () => {
    otel.configure({ endpoint: "", sampler: "always_on" });
    const tracer = otel.getTracer("test");
    expect(() =>
      tracer.startActiveSpan("boom", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(otel.getActiveSpanContext()).toBeUndefined();
  });

  test("ALS interop: span and AsyncLocalStorage coexist", async () => {
    otel.configure({ endpoint: "", sampler: "always_on" });
    const tracer = otel.getTracer("test");
    const als = new AsyncLocalStorage<string>();
    let spanInAls: string | undefined;
    let storeInSpan: string | undefined;
    await tracer.startActiveSpan("a", async () => {
      const beforeAls = hex(otel.getActiveSpanContext().spanId);
      als.run("hello", () => {
        storeInSpan = als.getStore();
        spanInAls = hex(otel.getActiveSpanContext().spanId);
      });
      expect(spanInAls).toBe(beforeAls);
      // After als.run exits, span context is still active and ALS is gone.
      expect(hex(otel.getActiveSpanContext().spanId)).toBe(beforeAls);
      expect(als.getStore()).toBeUndefined();
    });
    expect(storeInSpan).toBe("hello");
  });

  test("startSpan with no explicit parent inherits active span", async () => {
    otel.configure({ endpoint: "", sampler: "always_on" });
    const tracer = otel.getTracer("test");
    let childTrace: string | undefined;
    let parentTrace: string | undefined;
    await tracer.startActiveSpan("parent", async parent => {
      parentTrace = hex(parent.spanContext.traceId);
      const child = tracer.startSpan("child"); // no parent option
      childTrace = hex(child.spanContext.traceId);
      child.end();
    });
    expect(childTrace).toBe(parentTrace);
  });

  test("e2e: Bun.serve + fetch auto-instrumentation, traceparent propagation", async () => {
    const script = `
      let received;
      let upstreamTraceparent;
      const { promise, resolve } = Promise.withResolvers();

      // OTLP collector — same process, but we look at the POST body only.
      using collector = Bun.serve({
        port: 0,
        async fetch(req) {
          if (new URL(req.url).pathname !== "/v1/traces") return new Response("no", { status: 404 });
          const body = new Uint8Array(await req.arrayBuffer());
          received = Bun.otel.decodeTraces(body);
          resolve();
          return new Response(new Uint8Array(0), { headers: { "content-type": "application/x-protobuf" } });
        },
      });

      // Upstream backend that the instrumented handler will fetch.
      using upstream = Bun.serve({
        port: 0,
        fetch(req) {
          upstreamTraceparent = req.headers.get("traceparent");
          return new Response("pong");
        },
      });

      Bun.otel.configure({
        endpoint: "http://127.0.0.1:" + collector.port,
        scheduledDelayMillis: 60_000,
      });

      // The actual server under test.
      using app = Bun.serve({
        port: 0,
        async fetch(req) {
          const r = await fetch("http://127.0.0.1:" + upstream.port + "/ping");
          return new Response(await r.text());
        },
      });

      const res = await fetch(app.url, { headers: { traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" } });
      await res.text();
      await Bun.otel.forceFlush();
      await promise;

      const allSpans = received.resourceSpans[0].scopeSpans.flatMap(ss => ss.spans.map(s => ({...s, scope: ss.scope?.name})));
      const serverSpan = allSpans.find(s => s.kind === 2 && s.attributes?.some(a => a.key === "url.path" && a.value.stringValue === "/"));
      const clientSpan = allSpans.find(s => s.kind === 3 && s.scope === "bun.fetch");

      console.log(JSON.stringify({
        gotServer: !!serverSpan,
        gotClient: !!clientSpan,
        serverParent: serverSpan?.parentSpanId,
        sameTrace: clientSpan?.traceId === serverSpan?.traceId,
        clientParentIsServer: clientSpan?.parentSpanId === serverSpan?.spanId,
        upstreamGotTraceparent: !!upstreamTraceparent && upstreamTraceparent.length === 55,
        upstreamTraceMatches: upstreamTraceparent?.slice(3, 35) === serverSpan?.traceId,
        serverScope: serverSpan?.scope,
        serverHasMethod: serverSpan?.attributes?.some(a => a.key === "http.request.method" && a.value.stringValue === "GET"),
        serverInheritedTrace: serverSpan?.traceId === "4bf92f3577b34da6a3ce929d0e0e4736",
      }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, OTEL_EXPORTER_OTLP_ENDPOINT: undefined },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr.trim()).toBe("");
    const checks = JSON.parse(stdout.trim());
    expect(checks).toEqual({
      gotServer: true,
      gotClient: true,
      serverParent: "00f067aa0ba902b7",
      sameTrace: true,
      clientParentIsServer: true,
      upstreamGotTraceparent: true,
      upstreamTraceMatches: true,
      serverScope: "bun.serve",
      serverHasMethod: true,
      serverInheritedTrace: true,
    });
    expect(exitCode).toBe(0);
  });
});
