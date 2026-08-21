// `@opentelemetry/api` interop: when Bun.otel is enabled the api package's
// global TracerProvider / ContextManager / propagator resolve to the native
// implementation without any SDK being registered.
import { context, propagation, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const spans: any[] = [];
Bun.otel.start({
  serviceName: "compat",
  exporters: [{ export: (b: any[]) => spans.push(...b) }],
  instrumentations: { http: true, fetch: true },
});

async function collect(): Promise<any[]> {
  await Bun.sleep(0);
  await Bun.otel.forceFlush();
  return spans.splice(0, spans.length).sort((a, b) => a.startTime - b.startTime);
}

describe("@opentelemetry/api", () => {
  test("trace.getTracer() returns the native tracer", async () => {
    const tracer = trace.getTracer("compat-lib", "2.0.0");
    const span = tracer.startSpan("api-span", { kind: SpanKind.PRODUCER, attributes: { k: "v" } });
    expect(typeof span.spanContext().traceId).toBe("string");
    span.setStatus({ code: SpanStatusCode.ERROR, message: "e" });
    span.end();
    const [s] = await collect();
    expect(s).toMatchObject({
      name: "api-span",
      kind: SpanKind.PRODUCER,
      attributes: { k: "v" },
      status: { code: 2, message: "e" },
      scope: { name: "compat-lib", version: "2.0.0" },
    });
  });

  test("startActiveSpan + context.active() + trace.getActiveSpan()", async () => {
    const tracer = trace.getTracer("compat");
    await tracer.startActiveSpan("outer", async outer => {
      expect(trace.getActiveSpan()).toBe(outer);
      expect(trace.getSpan(context.active())).toBe(outer);
      expect(Bun.otel.activeSpan()).toBe(outer as any);
      await Bun.sleep(1);
      expect(trace.getActiveSpan()).toBe(outer);
      const inner = tracer.startSpan("inner");
      expect((inner as any).parentSpanId).toBe(outer.spanContext().spanId);
      inner.end();
      outer.end();
    });
    expect(trace.getActiveSpan()).toBeUndefined();
    await collect();
  });

  test("context.with(trace.setSpan(...)) drives parenting; ROOT_CONTEXT clears it", async () => {
    const tracer = trace.getTracer("compat");
    const a = tracer.startSpan("a");
    context.with(trace.setSpan(context.active(), a), () => {
      expect(trace.getActiveSpan()).toBe(a);
      const b = tracer.startSpan("b");
      expect((b as any).parentSpanId).toBe(a.spanContext().spanId);
      b.end();
      context.with(ROOT_CONTEXT, () => {
        expect(trace.getActiveSpan()).toBeUndefined();
        const c = tracer.startSpan("c");
        expect((c as any).parentSpanId).toBeUndefined();
        c.end();
      });
      expect(trace.getActiveSpan()).toBe(a);
    });
    a.end();
    await collect();
  });

  test("custom context values ride along with the span", async () => {
    const key = Symbol.for("test.key"); // createContextKey === Symbol.for
    const tracer = trace.getTracer("compat");
    const span = tracer.startSpan("carrier");
    const ctx = trace.setSpan(ROOT_CONTEXT, span).setValue(key, 42);
    await context.with(ctx, async () => {
      expect(context.active().getValue(key)).toBe(42);
      expect(trace.getActiveSpan()).toBe(span);
      await 1;
      expect(context.active().getValue(key)).toBe(42);
      await new Promise<void>(r => setTimeout(r, 1));
      expect(context.active().getValue(key)).toBe(42);
    });
    expect(context.active().getValue(key)).toBeUndefined();
    span.end();
    await collect();
  });

  test("context.bind()", () => {
    const tracer = trace.getTracer("compat");
    const span = tracer.startSpan("bound");
    const fn = context.bind(trace.setSpan(ROOT_CONTEXT, span), function (this: any, x: number) {
      expect(trace.getActiveSpan()).toBe(span);
      return this.base + x;
    });
    expect(fn.call({ base: 1 }, 2)).toBe(3);
    expect(trace.getActiveSpan()).toBeUndefined();
    span.end();
  });

  test("propagation.inject/extract use W3C trace context and interoperate with native spans", async () => {
    const tracer = trace.getTracer("compat");
    const span = tracer.startSpan("out");
    const carrier: Record<string, string> = {};
    propagation.inject(trace.setSpan(ROOT_CONTEXT, span), carrier);
    expect(carrier.traceparent).toBe(`00-${span.spanContext().traceId}-${span.spanContext().spanId}-01`);
    span.end();

    const incoming = {
      traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
      baggage: "user=1,tier=gold",
    };
    const ctx = propagation.extract(ROOT_CONTEXT, incoming);
    const remote = trace.getSpanContext(ctx)!;
    expect(remote).toMatchObject({
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      traceFlags: 1,
      isRemote: true,
    });
    const bag = propagation.getBaggage(ctx)!;
    expect(bag.getEntry("user")?.value).toBe("1");
    expect(Object.fromEntries(bag.getAllEntries().map(([k, v]) => [k, v.value]))).toEqual({ user: "1", tier: "gold" });
    const child = tracer.startSpan("child", {}, ctx);
    expect(child.spanContext().traceId).toBe("0af7651916cd43dd8448eb211c80319c");
    expect((child as any).parentSpanId).toBe("b7ad6b7169203331");
    child.end();
    // re-inject includes baggage; forwarding the extracted context keeps tracestate
    const out: Record<string, string> = {};
    propagation.inject(trace.setSpan(ctx, child), out);
    expect(out.baggage).toBe("user=1,tier=gold");
    const fwd: Record<string, string> = {};
    propagation.inject(propagation.extract(ROOT_CONTEXT, { ...incoming, tracestate: "vendor=abc" }), fwd);
    expect(fwd.tracestate).toBe("vendor=abc");
    await collect();
  });

  test("api spans inside Bun.serve parent under the request span; trace.getActiveSpan() is the server span", async () => {
    const tracer = trace.getTracer("compat");
    using server = Bun.serve({
      port: 0,
      async fetch() {
        const req = trace.getActiveSpan()!;
        req.setAttribute("via.api", 1);
        await tracer.startActiveSpan("db", async s => {
          await 1;
          s.end();
        });
        return new Response("ok");
      },
    });
    await (await fetch(`http://127.0.0.1:${server.port}/`)).text();
    const got = await collect();
    const srv = got.find(s => s.scope.name === "bun.http.server");
    const db = got.find(s => s.name === "db");
    expect(srv.attributes["via.api"]).toBe(1);
    expect(db.parentSpanId).toBe(srv.spanId);
  });

  test("foreign NonRecordingSpan from trace.wrapSpanContext is accepted as a parent", async () => {
    const tracer = trace.getTracer("compat");
    const wrapped = trace.wrapSpanContext({
      traceId: "11111111111111111111111111111111",
      spanId: "2222222222222222",
      traceFlags: 1,
    });
    const child = tracer.startSpan("c", {}, trace.setSpan(ROOT_CONTEXT, wrapped));
    expect(child.spanContext().traceId).toBe("11111111111111111111111111111111");
    expect((child as any).parentSpanId).toBe("2222222222222222");
    child.end();
    await collect();
  });

  test("the api global is only installed when telemetry is enabled", async () => {
    const script = `
      const { trace } = require("@opentelemetry/api");
      const before = trace.getTracer("x").startSpan("y").isRecording();
      Bun.otel.start({ exporters: [] });
      const after = trace.getTracer("x").startSpan("y").isRecording();
      console.log(before, after);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("false true");
    expect(exitCode).toBe(0);
  });
});
