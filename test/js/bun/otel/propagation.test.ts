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

  test("start (callback):context survives await and restores after", async () => {
    otel.configure({ endpoint: "", sampler: "always_on" });
    const tracer = otel.tracer("test");
    let inside: string | undefined;
    let afterAwait: string | undefined;
    const result = await tracer.start("a", async span => {
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

  test("start (callback):overlapping Promise.all each sees own span", async () => {
    otel.configure({ endpoint: "", sampler: "always_on" });
    const tracer = otel.tracer("test");
    const seen: Record<string, string> = {};
    await Promise.all([
      tracer.start("a", async span => {
        await Promise.resolve();
        seen.a = hex(otel.getActiveSpanContext().spanId);
        expect(seen.a).toBe(hex(span.spanContext.spanId));
      }),
      tracer.start("b", async span => {
        await Promise.resolve();
        seen.b = hex(otel.getActiveSpanContext().spanId);
        expect(seen.b).toBe(hex(span.spanContext.spanId));
      }),
    ]);
    expect(seen.a).not.toBe(seen.b);
    expect(otel.getActiveSpanContext()).toBeUndefined();
  });

  test("start (callback):nested child inherits parent traceId", async () => {
    otel.configure({ endpoint: "", sampler: "always_on" });
    const tracer = otel.tracer("test");
    let outerTrace: string | undefined;
    let innerTrace: string | undefined;
    await tracer.start("outer", async outer => {
      outerTrace = hex(outer.spanContext.traceId);
      await tracer.start("inner", async inner => {
        innerTrace = hex(inner.spanContext.traceId);
      });
    });
    expect(innerTrace).toBe(outerTrace);
  });

  test("start (callback):sync throw ends span and rethrows", () => {
    otel.configure({ endpoint: "", sampler: "always_on" });
    const tracer = otel.tracer("test");
    expect(() =>
      tracer.start("boom", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(otel.getActiveSpanContext()).toBeUndefined();
  });

  test("start (callback):async rejection propagates to awaiter", async () => {
    otel.configure({ endpoint: "", sampler: "always_on" });
    const tracer = otel.tracer("test");

    let caught: string | undefined;
    try {
      await tracer.start("op", async () => {
        throw new Error("boom");
      });
    } catch (e) {
      caught = (e as Error).message;
    }
    expect(caught).toBe("boom");

    // Resolve value passes through the derived promise.
    expect(await tracer.start("op3", async () => 42)).toBe(42);
  });

  test("start (callback):unawaited rejection fires unhandledRejection", async () => {
    // Subprocess: bun:test's own unhandledRejection handler interferes in-process.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `Bun.otel.configure({endpoint:"",sampler:"always_on"});
         let u = "none";
         process.on("unhandledRejection", e => u = e?.message);
         Bun.otel.tracer("t").start("op", async () => { throw new Error("boom"); });
         await new Promise(r => setTimeout(r, 10));
         console.log(u);`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("boom");
    expect(exitCode).toBe(0);
  });

  test("ALS interop: span and AsyncLocalStorage coexist", async () => {
    otel.configure({ endpoint: "", sampler: "always_on" });
    const tracer = otel.tracer("test");
    const als = new AsyncLocalStorage<string>();
    let spanInAls: string | undefined;
    let storeInSpan: string | undefined;
    await tracer.start("a", async () => {
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

  test("ALS interop: tracer.start inside als.run does not corrupt ALS index", async () => {
    // SlotGuard.enter prepends [null, span] to a sentinel-free ALS array. run()'s
    // finally previously reused the pre-callback index `i`, splicing the wrong
    // pair. Callback form is the safe ordering (sync-restore before run()'s
    // finally fires); using-form-inside-als.run is a known overlap footgun.
    otel.configure({ endpoint: "", sampler: "always_on" });
    const tracer = otel.tracer("test");
    const alsA = new AsyncLocalStorage<string>();
    const alsB = new AsyncLocalStorage<string>();
    let inner: [string?, string?, boolean?] = [];
    await alsA.run("outer", () =>
      alsB.run("inner", () =>
        tracer.start("op", async span => {
          inner = [alsA.getStore(), alsB.getStore(), !!otel.getActiveSpanContext()];
          await 0;
        }),
      ),
    );
    expect(inner).toEqual(["outer", "inner", true]);
    expect(alsA.getStore()).toBeUndefined();
    expect(alsB.getStore()).toBeUndefined();
    expect(otel.getActiveSpanContext()).toBeUndefined();
  });

  test("start (using form) with no explicit parent inherits active span", async () => {
    otel.configure({ endpoint: "", sampler: "always_on" });
    const tracer = otel.tracer("test");
    let childTrace: string | undefined;
    let parentTrace: string | undefined;
    await tracer.start("parent", async parent => {
      parentTrace = hex(parent.spanContext.traceId);
      using child = tracer.start("child"); // no parent option
      childTrace = hex(child.spanContext.traceId);
    });
    expect(childTrace).toBe(parentTrace);
  });

  test("fetch: user-set traceparent header is preserved, not duplicated", async () => {
    otel.configure({ endpoint: "", sampler: "always_on" });
    let count = 0;
    let value: string | null = null;
    using upstream = Bun.serve({
      port: 0,
      fetch(req) {
        // headers.get() concatenates duplicates with ", "; check raw count
        for (const [k] of req.headers) if (k === "traceparent") count++;
        value = req.headers.get("traceparent");
        return new Response("ok");
      },
    });
    const userTP = "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01";
    await otel.tracer("t").start("op", async () => {
      await fetch(upstream.url, { headers: { traceparent: userTP } });
    });
    expect(count).toBe(1);
    expect(value).toBe(userTP);
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
