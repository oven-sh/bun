import { describe, test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

// @ts-expect-error TODO(@jarred): packages/bun-types
const otel = Bun.otel;

describe("Bun.otel runtime", () => {
  test("traceparent parse/format round-trip", () => {
    const tp = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    const ctx = otel.parseTraceparent(tp);
    expect(ctx).not.toBeUndefined();
    expect(ctx.traceFlags).toBe(1);
    expect(ctx.isRemote).toBe(true);
    expect(Buffer.from(ctx.traceId).toString("hex")).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(Buffer.from(ctx.spanId).toString("hex")).toBe("00f067aa0ba902b7");
    expect(ctx.toTraceparent()).toBe(tp);

    expect(otel.parseTraceparent("00-" + "0".repeat(32) + "-00f067aa0ba902b7-01")).toBeUndefined(); // all-zero trace id
    expect(otel.parseTraceparent("ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")).toBeUndefined(); // version ff
    expect(otel.parseTraceparent("nope")).toBeUndefined();
  });

  test("reconfigure does not invalidate existing tracers/spans", () => {
    otel.configure({ endpoint: "", sampler: "always_on" });
    const tracer = otel.getTracer("scope-a");
    const liveSpan = tracer.startSpan("live");
    otel.configure({ endpoint: "", sampler: "always_off" });
    // previously: ASAN use-after-poison
    expect(() => tracer.startSpan("stale").end()).not.toThrow();
    expect(() => liveSpan.end()).not.toThrow();
    // sampler change is observed by the pre-existing tracer
    expect(tracer.startSpan("after").isRecording).toBe(false);
  });

  test("startSpan inherits parent traceId and sets parentSpanId", () => {
    otel.configure({ endpoint: "", sampler: "always_on" });
    const tracer = otel.getTracer("test");
    const parent = tracer.startSpan("parent");
    const pctx = parent.spanContext;
    const child = tracer.startSpan("child", { parent: pctx, kind: 3 });
    const cctx = child.spanContext;

    expect(Buffer.from(cctx.traceId).equals(Buffer.from(pctx.traceId))).toBe(true);
    expect(Buffer.from(cctx.spanId).equals(Buffer.from(pctx.spanId))).toBe(false);
    expect(cctx.toTraceparent().slice(0, 35)).toBe(pctx.toTraceparent().slice(0, 35));
    expect(parent.isRecording).toBe(true);

    parent.end();
    child.end();
    expect(parent.isRecording).toBe(false);
  });

  test("attribute packing caps: long key, long value, >255 attrs", () => {
    otel.configure({ endpoint: "", sampler: "always_on" });
    const tracer = otel.getTracer("caps");
    // 5000-char key — was: process panic at attributes.zig encodeKeyPtr
    expect(() => tracer.startSpan("a").setAttribute(Buffer.alloc(5000, "k").toString(), "v")).not.toThrow();
    // 70KB string value — truncates at VAL_LEN_MAX (65535), must not crash
    expect(() => tracer.startSpan("b").setAttribute("k", Buffer.alloc(70000, "x").toString())).not.toThrow();
    // 300 attrs — first 255 sent, droppedAttributesCount=45 on the wire
    const s = tracer.startSpan("c");
    for (let i = 0; i < 300; i++) s.setAttribute(`k${i}`, i);
    expect(() => s.end()).not.toThrow();
    // POJO codec path with 5000-char key — was: same panic via Attribute.init
    expect(() =>
      otel.encodeTraces({
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: "5b8aa5a2d2c872e8321cf37308d69df2",
                    spanId: "051581bf3cb55c13",
                    name: "x",
                    attributes: [{ key: Buffer.alloc(5000, "k").toString(), value: { stringValue: "v" } }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).not.toThrow();
  });

  test("sampler ratio=0 produces non-recording spans", () => {
    otel.configure({ endpoint: "", sampler: 0 });
    const tracer = otel.getTracer("test");
    const span = tracer.startSpan("noop");
    expect(span.isRecording).toBe(false);
    expect(span.spanContext.traceFlags & 1).toBe(0);
    span.setAttribute("k", 1); // no-op, must not throw
    span.end();
  });

  // End-to-end: span -> processor -> AsyncHTTP exporter -> Bun.serve collector.
  // Runs out-of-process so configure() state from earlier tests doesn't leak.
  test("end-to-end export reaches collector via OTLP/HTTP", async () => {
    const script = /* js */ `
      const { promise, resolve } = Promise.withResolvers();
      let received;

      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          if (new URL(req.url).pathname !== "/v1/traces") return new Response("not found", { status: 404 });
          if (req.headers.get("content-type") !== "application/x-protobuf") {
            return new Response("bad content-type", { status: 400 });
          }
          const body = new Uint8Array(await req.arrayBuffer());
          received = Bun.otel.decodeTraces(body);
          resolve();
          return new Response(new Uint8Array(0), { headers: { "content-type": "application/x-protobuf" } });
        },
      });

      Bun.otel.configure({
        endpoint: "http://127.0.0.1:" + server.port,
        scheduledDelayMillis: 60_000, // forceFlush drives the send
      });
      const tracer = Bun.otel.getTracer("e2e-test");
      const root = tracer.startSpan("GET /users", { kind: 2 });
      root.setAttribute("http.status_code", 200);
      root.setAttribute("http.method", "GET");
      root.addEvent("dispatch", { route: "/users" });
      root.setStatus(1);
      root.end();

      const child = tracer.startSpan("db.query", { parent: root.spanContext, kind: 3 });
      child.setAttributes({ "db.system": "postgresql", rows: 7n });
      child.end();

      await Bun.otel.forceFlush();
      await promise;
      server.stop(true);

      const spans = received.resourceSpans[0].scopeSpans[0].spans;
      const byName = Object.fromEntries(spans.map(s => [s.name, s]));
      const checks = {
        scope: received.resourceSpans[0].scopeSpans[0].scope.name,
        spanCount: spans.length,
        rootName: byName["GET /users"].name,
        rootKind: byName["GET /users"].kind,
        rootStatus: byName["GET /users"].status.code,
        rootHasEvent: byName["GET /users"].events[0].name,
        rootStatusAttr: byName["GET /users"].attributes.find(a => a.key === "http.status_code").value.intValue,
        childParent: byName["db.query"].parentSpanId === Buffer.from(root.spanContext.spanId).toString("hex"),
        sameTrace: byName["db.query"].traceId === byName["GET /users"].traceId,
        traceIdLen: byName["GET /users"].traceId.length,
        timeMono: BigInt(byName["GET /users"].endTimeUnixNano) >= BigInt(byName["GET /users"].startTimeUnixNano),
        resourceHasSdk: received.resourceSpans[0].resource.attributes.some(a => a.key === "telemetry.sdk.name"),
      };
      console.log(JSON.stringify(checks));
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr.trim()).toBe("");
    const checks = JSON.parse(stdout.trim());
    expect(checks).toEqual({
      scope: "e2e-test",
      spanCount: 2,
      rootName: "GET /users",
      rootKind: 2,
      rootStatus: 1,
      rootHasEvent: "dispatch",
      rootStatusAttr: "200",
      childParent: true,
      sameTrace: true,
      traceIdLen: 32,
      timeMono: true,
      resourceHasSdk: true,
    });
    expect(exitCode).toBe(0);
  });

  test("non-recording getTracer when no provider configured", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const s = Bun.otel.getTracer("x").startSpan("y"); console.log(s.isRecording, s.spanContext.toTraceparent().length); s.end();`,
      ],
      env: { ...bunEnv, OTEL_EXPORTER_OTLP_ENDPOINT: undefined },
      stdout: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("false 55");
    expect(exitCode).toBe(0);
  });
});
