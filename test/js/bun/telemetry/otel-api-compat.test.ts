// `@opentelemetry/api` interop: when Bun.otel is enabled the api package's
// global TracerProvider / ContextManager / propagator resolve to the native
// implementation without any SDK being registered.
import {
  context,
  createContextKey,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter } from "node:events";
import http from "node:http";

const spans: any[] = [];
Bun.otel.start({
  serviceName: "compat",
  exporters: [{ export: (b: any[]) => spans.push(...b) }],
  instrumentations: { http: true, fetch: true },
});
// The pipeline is process-global; leave nothing behind for later files.
afterAll(() => Bun.otel.shutdown());

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
    const key = createContextKey("test.key");
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

  test("context.bind() on an EventEmitter is idempotent", () => {
    const tracer = trace.getTracer("compat");
    const span = tracer.startSpan("ee");
    const ee = new EventEmitter();
    const ctx = trace.setSpan(ROOT_CONTEXT, span);
    context.bind(ctx, ee);
    context.bind(ctx, ee);
    const emit = ee.emit;
    context.bind(ctx, ee);
    expect(ee.emit).toBe(emit);
    let seen;
    ee.on("x", () => (seen = trace.getActiveSpan()));
    ee.emit("x");
    expect(seen).toBe(span);
    span.end();
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
    // keys are percent-decoded on extract as values are (round trip through inject)
    const rt: Record<string, string> = {};
    propagation.inject(
      propagation.setBaggage(ROOT_CONTEXT, propagation.createBaggage({ "a+b": { value: "c d" } })),
      rt,
    );
    expect(propagation.getBaggage(propagation.extract(ROOT_CONTEXT, rt))!.getEntry("a+b")?.value).toBe("c d");
    await collect();
  });

  test("baggage from propagation.extract()/setBaggage in the active Context is sent by fetch and node:http", async () => {
    const seen: (string | null)[] = [];
    using upstream = Bun.serve({
      port: 0,
      fetch(req) {
        seen.push(req.headers.get("baggage"));
        return new Response("u");
      },
    });
    const ctx = propagation.extract(ROOT_CONTEXT, {
      traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
      baggage: "tenant=acme",
    });
    await context.with(ctx, () => fetch(`http://127.0.0.1:${upstream.port}/a`).then(r => r.text()));
    await context.with(
      propagation.setBaggage(ROOT_CONTEXT, propagation.createBaggage({ k: { value: "v" } })),
      () =>
        new Promise<void>((resolve, reject) => {
          http
            .get(`http://127.0.0.1:${upstream.port}/b`, (res: any) => {
              res.resume();
              res.on("end", resolve);
            })
            .on("error", reject);
        }),
    );
    // inside a request handler (native active span) too
    using front = Bun.serve({
      port: 0,
      async fetch() {
        await context.with(
          propagation.setBaggage(context.active(), propagation.createBaggage({ h: { value: "1" } })),
          () => fetch(`http://127.0.0.1:${upstream.port}/c`).then(r => r.text()),
        );
        return new Response("f");
      },
    });
    await (await fetch(`http://127.0.0.1:${front.port}/`)).text();
    expect(seen).toEqual(["tenant=acme", "k=v", "h=1"]);
    await collect();
  });

  test("startActiveSpan restores the context when the callback throws after mutating an AsyncLocalStorage store", () => {
    const als = new AsyncLocalStorage();
    const tracer = trace.getTracer("compat");
    expect(() =>
      tracer.startActiveSpan("throws", () => {
        als.enterWith("x");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(trace.getActiveSpan()).toBeUndefined();
    expect(als.getStore()).toBe("x");
  });

  test("ambient baggage survives activating a span (startActiveSpan / with / using), and an explicit Context replaces it", async () => {
    const tracer = trace.getTracer("compat");
    const withBag = propagation.setBaggage(ROOT_CONTEXT, propagation.createBaggage({ user: { value: "1" } }));
    const seen: Record<string, string | undefined> = {};
    const bag = () => propagation.getActiveBaggage()?.getEntry("user")?.value;
    context.with(withBag, () => {
      seen.outer = bag();
      tracer.startActiveSpan("cb", span => {
        seen.callback = bag();
        span.end();
      });
      {
        using _s = Bun.otel.tracer("t").startActiveSpan("using");
        seen.using = bag();
      }
      Bun.otel.with(Bun.otel.tracer("t").startSpan("with"), () => {
        seen.with = bag();
        const carrier: Record<string, string> = {};
        propagation.inject(context.active(), carrier);
        seen.injected = carrier.baggage;
      });
      // An explicit Context is complete: no baggage in it, none active inside.
      context.with(trace.setSpan(ROOT_CONTEXT, tracer.startSpan("explicit")), () => {
        seen.explicit = bag();
      });
    });
    expect(seen).toEqual({
      outer: "1",
      callback: "1",
      using: "1",
      with: "1",
      injected: "user=1",
      explicit: undefined,
    });
    await collect();
  });

  test("extract() onto a foreign api Context without baggage, then getBaggage / root spans keep the context's baggage", async () => {
    // api's own ROOT_CONTEXT (BaseContext), not Bun's
    const { ROOT_CONTEXT: apiRoot } = require("@opentelemetry/api");
    const ctx = propagation.extract(apiRoot, {
      traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
    });
    expect(propagation.getBaggage(ctx)).toBeUndefined();
    expect(trace.getSpanContext(ctx)?.traceId).toBe("0af7651916cd43dd8448eb211c80319c");
    const withBag = propagation.setBaggage(ctx, propagation.createBaggage({ a: { value: "1" } }));
    const tracer = trace.getTracer("compat");
    let inside: string | undefined, parent: string | undefined;
    tracer.startActiveSpan("r", { root: true }, withBag, span => {
      inside = propagation.getActiveBaggage()?.getEntry("a")?.value;
      parent = (span as any).parentSpanId;
      span.end();
    });
    expect(inside).toBe("1");
    expect(parent).toBeFalsy();
    await collect();
  });

  test("propagation.inject(ctx) with a Context that has no baggage does not leak the ambient baggage", async () => {
    const tracer = trace.getTracer("compat");
    const other = tracer.startSpan("other");
    const bare = trace.setSpan(ROOT_CONTEXT, other); // span, no baggage
    let injected: Record<string, string> = {};
    context.with(propagation.setBaggage(ROOT_CONTEXT, propagation.createBaggage({ amb: { value: "1" } })), () => {
      propagation.inject(bare, injected);
    });
    other.end();
    expect(injected.traceparent).toContain(other.spanContext().spanId);
    expect(injected.baggage).toBeUndefined();
    await collect();
  });

  test("the api global's version matches the installed @opentelemetry/api, so its registerGlobal() calls succeed", async () => {
    const { diag, metrics, DiagLogLevel } = require("@opentelemetry/api");
    const version = require("@opentelemetry/api/package.json").version;
    expect((globalThis as any)[Symbol.for("opentelemetry.js.api.1")].version).toBe(version);
    expect(diag.setLogger({ error() {}, warn() {}, info() {}, debug() {}, verbose() {} }, DiagLogLevel.ERROR)).toBe(
      true,
    );
    expect(metrics.setGlobalMeterProvider({ getMeter: () => ({}) as any })).toBe(true);
    metrics.disable();
    diag.disable();
    // …and it is the *resolved* package's version, not a baked-in constant
    using dir = tempDir("otel-api-version", {
      "node_modules/@opentelemetry/api/package.json": JSON.stringify({
        name: "@opentelemetry/api",
        version: "9.8.7",
        main: "index.js",
      }),
      "node_modules/@opentelemetry/api/index.js": "module.exports = {};",
      "index.js": `Bun.otel.start({ exporters: [{ export() {} }] }); console.log(globalThis[Symbol.for("opentelemetry.js.api.1")].version);`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    expect((await proc.stdout.text()).trim()).toBe("9.8.7");
    expect(await proc.exited).toBe(0);
  });

  test("baggage set or deleted on the Context wins over what the request carried in, for fetch and node:http alike", async () => {
    const seen: Record<string, (string | null)[]> = { set: [], deleted: [], untouched: [] };
    using upstream = Bun.serve({
      port: 0,
      fetch(req) {
        seen[new URL(req.url).pathname.slice(1)].push(req.headers.get("baggage"));
        return new Response("u");
      },
    });
    const get = (path: string) =>
      new Promise<void>(r => http.get(`http://127.0.0.1:${upstream.port}/${path}`, res => res.resume().on("end", r)));
    using server = Bun.serve({
      port: 0,
      async fetch() {
        await fetch(`${upstream.url}untouched`);
        await get("untouched");
        await context.with(
          propagation.setBaggage(context.active(), propagation.createBaggage({ k: { value: "v" } })),
          async () => {
            await fetch(`${upstream.url}set`);
            await get("set");
          },
        );
        await context.with(propagation.deleteBaggage(context.active()), async () => {
          expect(propagation.getActiveBaggage()).toBeUndefined();
          await fetch(`${upstream.url}deleted`);
          await get("deleted");
        });
        return new Response("ok");
      },
    });
    await (await fetch(server.url, { headers: { baggage: "secret=1" } })).text();
    expect(seen).toEqual({ untouched: ["secret=1", "secret=1"], set: ["k=v", "k=v"], deleted: [null, null] });
    await collect();
  });

  test("propagation.inject() inside a request handler forwards the baggage the request carried in", async () => {
    using server = Bun.serve({
      port: 0,
      fetch() {
        const carrier: Record<string, string> = {};
        propagation.inject(context.active(), carrier);
        const fromApi = propagation.getActiveBaggage()?.getEntry("tenant")?.value;
        // JS-set baggage takes precedence over the incoming header
        const overridden: Record<string, string> = {};
        context.with(propagation.setBaggage(context.active(), propagation.createBaggage({ k: { value: "v" } })), () =>
          propagation.inject(context.active(), overridden),
        );
        return Response.json({ carrier, fromApi, overridden: overridden.baggage });
      },
    });
    const res = await fetch(server.url, { headers: { baggage: "tenant=acme,tier=gold" } });
    const body = await res.json();
    expect(body.carrier.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(body.carrier.baggage).toBe("tenant=acme,tier=gold");
    expect(body.fromApi).toBe("acme");
    expect(body.overridden).toBe("k=v");
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

  test("a tracer obtained before Bun.otel.start() records once tracing starts (require and import)", async () => {
    // Libraries take `trace.getTracer()` at module scope; the app calls start() later.
    for (const load of [`const { trace } = require("@opentelemetry/api");`, `import { trace } from "@opentelemetry/api";`]) {
      using dir = tempDir("otel-early-tracer", {
        "index.mjs": `
          ${load}
          const { diag } = require("@opentelemetry/api");
          const diagErrors = [];
          diag.setLogger({ error: m => diagErrors.push(m), warn() {}, info() {}, debug() {}, verbose() {} });
          const tracer = trace.getTracer("early");
          const before = tracer.startSpan("a").isRecording();
          const spans = [];
          Bun.otel.start({ exporters: [{ export: b => spans.push(...b) }] });
          if (diagErrors.length) console.error(diagErrors.join(" | "));
          const s = tracer.startSpan("b");
          const during = s.isRecording();
          s.end();
          await Bun.otel.forceFlush();
          console.log(JSON.stringify([before, during, spans.map(s => s.name), trace.getTracer("late").startSpan("c").isRecording()]));
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.mjs"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe(JSON.stringify([false, true, ["b"], true]));
      expect(exitCode).toBe(0);
    }
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
