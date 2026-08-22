import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";

// One process-wide pipeline: every test in this file shares the collector.
const spans: any[] = [];
function restore() {
  Bun.otel.start({
    serviceName: "otel-api-test",
    resourceAttributes: { "deployment.environment": "test", n: 1 },
    exporters: [{ export: (batch: any[]) => spans.push(...batch) }],
    // Keep the built-in integrations quiet so only user spans show up here.
    instrumentations: [],
  });
}
restore();
// Tests below may reconfigure; each starts from the default pipeline.
beforeEach(restore);
// The pipeline is process-global; leave nothing behind for later files.
afterAll(() => Bun.otel.shutdown());

const tracer = Bun.otel.tracer("test-tracer", "1.2.3");

async function collect(): Promise<any[]> {
  await Bun.otel.forceFlush();
  const out = spans.splice(0, spans.length);
  return out;
}

describe("Bun.otel", () => {
  test("is enabled after start()", () => {
    expect(Bun.otel.enabled).toBe(true);
  });

  test("startSpan records name, ids, times, attributes, kind", async () => {
    const before = Date.now();
    const span = tracer.startSpan("basic", {
      kind: 2,
      attributes: { s: "str", i: 42, f: 1.5, b: true, arr: ["a", "b"], big: 2n ** 40n },
    });
    expect(span.isRecording()).toBe(true);
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(span.parentSpanId).toBeUndefined();
    expect(span.name).toBe("basic");
    span.setAttribute("later", "yes").setAttribute("i", 43); // overwrite
    span.end();
    expect(span.ended).toBe(true);
    expect(span.isRecording()).toBe(false);
    // Mutations after end are ignored.
    span.setAttribute("ignored", true);
    const [s] = await collect();
    expect(s.name).toBe("basic");
    expect(s.kind).toBe(2);
    expect(s.traceId).toBe(span.traceId);
    expect(s.spanId).toBe(span.spanId);
    expect(s.attributes).toEqual({
      s: "str",
      i: 43,
      f: 1.5,
      b: true,
      arr: ["a", "b"],
      big: 1099511627776,
      later: "yes",
    });
    expect(s.startTime).toBeGreaterThanOrEqual(before - 1);
    expect(s.endTime).toBeGreaterThanOrEqual(s.startTime);
    expect(s.scope).toEqual({ name: "test-tracer", version: "1.2.3" });
    expect(s.resource.attributes["service.name"]).toBe("otel-api-test");
    expect(s.resource.attributes["deployment.environment"]).toBe("test");
    expect(s.resource.attributes["telemetry.sdk.name"]).toBe("bun");
  });

  test("events, links, status, exceptions, updateName", async () => {
    const other = tracer.startSpan("other");
    const span = tracer.startSpan("rich", { links: [{ context: other.spanContext(), attributes: { l: 1 } }] });
    span.addEvent("ev1", { a: 1 });
    span.addEvent("ev2", Date.now());
    span.addLink({ context: { ...other.spanContext(), traceState: "vendor=abc" } });
    span.recordException(new TypeError("boom"));
    span.setStatus({ code: 2, message: "bad" });
    span.setStatus({ code: 1 }); // Ok overrides Error; message dropped
    span.updateName("renamed");
    span.end();
    other.end();
    const got = await collect();
    const s = got.find(x => x.name === "renamed");
    expect(s).toBeDefined();
    expect(s.events.map((e: any) => e.name)).toEqual(["ev1", "ev2", "exception"]);
    expect(s.events[0].attributes).toEqual({ a: 1 });
    expect(s.events[2].attributes["exception.type"]).toBe("TypeError");
    expect(s.events[2].attributes["exception.message"]).toBe("boom");
    expect(s.events[2].attributes["exception.stacktrace"]).toContain("boom");
    expect(s.links).toHaveLength(2);
    expect(s.links[0].traceId).toBe(other.traceId);
    expect(s.links[0].spanId).toBe(other.spanId);
    expect(s.links[0].attributes).toEqual({ l: 1 });
    expect(s.links[0].traceState).toBeUndefined();
    expect(s.links[1].traceState).toBe("vendor=abc");
    expect(s.status).toEqual({ code: 1 });
  });

  test("spanContext() is cached and api-shaped", () => {
    const span = tracer.startSpan("ctx");
    const c1 = span.spanContext();
    expect(c1).toEqual({ traceId: span.traceId, spanId: span.spanId, traceFlags: 1 });
    expect(span.spanContext()).toBe(c1);
    span.end();
  });

  test("explicit parent / root option", async () => {
    const parent = tracer.startSpan("p");
    const child = tracer.startSpan("c", { parent });
    const root = tracer.startSpan("r", { root: true });
    expect(child.traceId).toBe(parent.traceId);
    expect(child.parentSpanId).toBe(parent.spanId);
    expect(root.traceId).not.toBe(parent.traceId);
    child.end();
    root.end();
    parent.end();
    await collect();
  });
});

describe("context propagation", () => {
  test("startActiveSpan(fn) activates for the callback and restores after", () => {
    expect(Bun.otel.activeSpan()).toBeUndefined();
    const ret = tracer.startActiveSpan("cb", span => {
      expect(Bun.otel.activeSpan()).toBe(span);
      const inner = tracer.startSpan("inner");
      expect(inner.parentSpanId).toBe(span.spanId);
      inner.end();
      span.end();
      return 7;
    });
    expect(ret).toBe(7);
    expect(Bun.otel.activeSpan()).toBeUndefined();
  });

  test("startActiveSpan(fn) rethrows and restores the active span when the callback throws or rejects", async () => {
    const err = new Error("boom");
    expect(() =>
      tracer.startActiveSpan("throws", span => {
        span.end();
        throw err;
      }),
    ).toThrow(err);
    expect(Bun.otel.activeSpan()).toBeUndefined();
    const p = tracer.startActiveSpan("rejects", async span => {
      span.end();
      throw err;
    });
    expect(Bun.otel.activeSpan()).toBeUndefined();
    await expect(p).rejects.toBe(err);
    expect(Bun.otel.activeSpan()).toBeUndefined();
    await collect();
  });

  test("`using` form activates until scope exit and ends the span", async () => {
    let id: string;
    {
      using span = tracer.startActiveSpan("scoped");
      id = span.spanId;
      expect(Bun.otel.activeSpan()).toBe(span);
      expect(span.ended).toBe(false);
    }
    expect(Bun.otel.activeSpan()).toBeUndefined();
    const got = await collect();
    expect(got.some(s => s.spanId === id)).toBe(true);
  });

  test("survives await, timers, queueMicrotask, process.nextTick, promise chains", async () => {
    using span = tracer.startActiveSpan("async");
    await 1;
    expect(Bun.otel.activeSpan()).toBe(span);
    await Bun.sleep(1);
    expect(Bun.otel.activeSpan()).toBe(span);
    await new Promise<void>(r => setTimeout(r, 1));
    expect(Bun.otel.activeSpan()).toBe(span);
    await new Promise<void>(r => setImmediate(r));
    expect(Bun.otel.activeSpan()).toBe(span);
    await new Promise<void>(r => queueMicrotask(r));
    expect(Bun.otel.activeSpan()).toBe(span);
    await new Promise<void>(r => process.nextTick(r));
    expect(Bun.otel.activeSpan()).toBe(span);
    const seen = await Promise.resolve()
      .then(() => Bun.otel.activeSpan())
      .then(s => s);
    expect(seen).toBe(span);
    // Callback registered while active, fired later.
    const p = new Promise(resolve => setTimeout(() => resolve(Bun.otel.activeSpan()), 2));
    expect(await p).toBe(span);
  });

  test("concurrent async functions keep separate contexts", async () => {
    async function work(name: string, delay: number) {
      using span = tracer.startActiveSpan(name);
      await Bun.sleep(delay);
      expect(Bun.otel.activeSpan()).toBe(span);
      await Bun.sleep(1);
      expect(Bun.otel.activeSpan()).toBe(span);
      return span.spanId;
    }
    const ids = await Promise.all([work("a", 3), work("b", 1), work("c", 2)]);
    expect(new Set(ids).size).toBe(3);
    expect(Bun.otel.activeSpan()).toBeUndefined();
  });

  test("context captured at await, not resume: enter after first await is scoped to that continuation", async () => {
    let inner: any;
    async function f() {
      await 1;
      inner = tracer.startActiveSpan("late");
      // Activated via `using`-less form: enter() happened; stays until we exit.
      await 1;
      expect(Bun.otel.activeSpan()).toBe(inner);
      inner[Symbol.dispose]();
    }
    const p = f();
    expect(Bun.otel.activeSpan()).toBeUndefined();
    await p;
    expect(Bun.otel.activeSpan()).toBeUndefined();
  });

  test("coexists with AsyncLocalStorage in both nesting orders", async () => {
    const als = new AsyncLocalStorage<string>();
    // span outside, ALS inside
    await tracer.startActiveSpan("outer", async span => {
      await als.run("v1", async () => {
        expect(als.getStore()).toBe("v1");
        expect(Bun.otel.activeSpan()).toBe(span);
        await Bun.sleep(1);
        expect(als.getStore()).toBe("v1");
        expect(Bun.otel.activeSpan()).toBe(span);
        // span inside ALS inside span
        await tracer.startActiveSpan("inner", async inner => {
          expect(als.getStore()).toBe("v1");
          expect(Bun.otel.activeSpan()).toBe(inner);
          await 1;
          expect(als.getStore()).toBe("v1");
          expect(Bun.otel.activeSpan()).toBe(inner);
          inner.end();
        });
        expect(Bun.otel.activeSpan()).toBe(span);
        expect(als.getStore()).toBe("v1");
      });
      expect(als.getStore()).toBeUndefined();
      expect(Bun.otel.activeSpan()).toBe(span);
      span.end();
    });
    expect(Bun.otel.activeSpan()).toBeUndefined();

    // ALS outside, span inside, then a second ALS
    const als2 = new AsyncLocalStorage<number>();
    await als.run("v2", async () => {
      using span = tracer.startActiveSpan("in-als");
      expect(als.getStore()).toBe("v2");
      await als2.run(9, async () => {
        await 1;
        expect(als.getStore()).toBe("v2");
        expect(als2.getStore()).toBe(9);
        expect(Bun.otel.activeSpan()).toBe(span);
      });
      expect(als2.getStore()).toBeUndefined();
      expect(Bun.otel.activeSpan()).toBe(span);
      als.enterWith("v3");
      expect(als.getStore()).toBe("v3");
      expect(Bun.otel.activeSpan()).toBe(span);
    });
    expect(Bun.otel.activeSpan()).toBeUndefined();
    await collect();
  });

  test("Bun.otel.with(span, fn)", () => {
    const span = tracer.startSpan("with");
    const r = Bun.otel.with(
      span,
      (a: number, b: number) => {
        expect(Bun.otel.activeSpan()).toBe(span);
        return a + b;
      },
      undefined,
      2,
      3,
    );
    expect(r).toBe(5);
    expect(Bun.otel.activeSpan()).toBeUndefined();
    span.end();
  });

  test("AsyncLocalStorage.enterWith inside a span scope survives the scope (Node semantics)", () => {
    const als = new AsyncLocalStorage();
    const other = new AsyncLocalStorage();
    const seen = other.run("kept", () => {
      tracer.startActiveSpan("scope", span => {
        als.enterWith("entered-inside");
        span.end();
      });
      {
        using _s = tracer.startActiveSpan("using-scope");
        expect(als.getStore()).toBe("entered-inside");
      }
      return [Bun.otel.activeSpan(), als.getStore(), other.getStore()];
    });
    expect(seen).toEqual([undefined, "entered-inside", "kept"]);
  });

  test("removing the last AsyncLocalStorage store inside a span scope is kept after the scope", () => {
    const als = new AsyncLocalStorage();
    const seen = als.run("v", () => {
      tracer.startActiveSpan("scope", span => {
        als.disable(); // drops the only store; the slot collapses to the bare span
        span.end();
      });
      return [Bun.otel.activeSpan(), als.getStore()];
    });
    expect(seen).toEqual([undefined, undefined]);
  });

  test("tracer cache key: a name containing '@' does not collide with (name, version)", () => {
    expect(Bun.otel.tracer("a@1").version).toBeUndefined();
    expect(Bun.otel.tracer("a", "1").version).toBe("1");
    expect(Bun.otel.tracer("a@1")).not.toBe(Bun.otel.tracer("a", "1"));
  });

  test("Bun.otel.with(undefined, fn) clears the active span but keeps AsyncLocalStorage stores", () => {
    const { AsyncLocalStorage } = require("node:async_hooks");
    const als = new AsyncLocalStorage();
    const span = tracer.startSpan("outer");
    const seen = als.run("store", () =>
      Bun.otel.with(span, () => Bun.otel.with(undefined, () => [Bun.otel.activeSpan(), als.getStore()] as const)),
    );
    expect(seen).toEqual([undefined, "store"]);
    span.end();
  });
});

describe("encoding", () => {
  test("protobuf output decodes with the official schema and matches the JSON transcoding", async () => {
    const root = require("@opentelemetry/otlp-transformer/build/src/generated/root");
    const Req = root.opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest;
    let bytes: Uint8Array | undefined, json: string | undefined;
    Bun.otel.start({
      serviceName: "enc",
      exporters: [{ exportProtobuf: (b: Uint8Array) => (bytes = b) }, { exportJSON: (j: string) => (json = j) }],
      instrumentations: [],
    });
    const t = Bun.otel.tracer("enc");
    const a = t.startSpan("a", { kind: 1, attributes: { k: "v", n: -5, d: 0.25, yes: false, list: [1, 2] } });
    const b = t.startSpan("b", { parent: a, links: [{ context: a.spanContext(), attributes: { w: 1 } }] });
    b.addEvent("e", { x: "y" });
    b.setStatus({ code: 2, message: "err" });
    b.end();
    a.end();
    await Bun.otel.forceFlush();
    expect(bytes).toBeInstanceOf(Uint8Array);
    const decoded = Req.decode(bytes);
    expect(Req.verify(Req.toObject(decoded))).toBeNull();
    const viaProto = Req.toObject(decoded, { longs: String, bytes: String, defaults: false });
    // OTLP/JSON uses hex for ids and decimal strings for 64-bit ints; protobufjs
    // toObject gives base64 ids. Normalise both to compare structure.
    const fromJson = JSON.parse(json!);
    const hexToB64 = (h: string) => Buffer.from(h, "hex").toString("base64");
    const norm = (o: any): any => {
      if (Array.isArray(o)) return o.map(norm);
      if (o && typeof o === "object") {
        const out: any = {};
        for (const [k, v] of Object.entries(o)) {
          // `Span.flags`/`Link.flags` postdate the schema bundled with otlp-transformer 0.57.
          if (k === "flags") continue;
          if ((k === "traceId" || k === "spanId" || k === "parentSpanId") && typeof v === "string")
            out[k] = /^[0-9a-f]+$/.test(v) ? hexToB64(v) : v;
          else out[k] = norm(v);
        }
        return out;
      }
      return o;
    };
    expect(norm(fromJson)).toEqual(norm(viaProto));
    const spansOut = viaProto.resourceSpans[0].scopeSpans.find((ss: any) => ss.scope.name === "enc").spans;
    expect(spansOut.map((s: any) => s.name).sort()).toEqual(["a", "b"]);
    const sb = spansOut.find((s: any) => s.name === "b");
    expect(sb.status).toEqual({ message: "err", code: 2 });
    expect(sb.events[0].name).toBe("e");
    expect(sb.links[0].attributes[0]).toEqual({ key: "w", value: { intValue: "1" } });
    // restore the collector for later tests
  });

  test("Bun.otel.decode round-trips protobuf export", async () => {
    let bytes: Uint8Array | undefined;
    Bun.otel.start({
      exporters: [{ exportProtobuf: (b: Uint8Array) => (bytes = b) }],
      instrumentations: [],
    });
    const s = Bun.otel.tracer("d").startSpan("dec", { attributes: { a: 1 } });
    s.end();
    await Bun.otel.forceFlush();
    const [d] = Bun.otel.decode(bytes!);
    expect(d.name).toBe("dec");
    expect(d.attributes).toEqual({ a: 1 });
    expect(d.spanId).toBe(s.spanId);
  });

  test("Bun.otel.decode caps attribute nesting instead of recursing without bound", () => {
    // Hand-rolled protobuf: one span whose attribute "k" is an array nested `levels` deep.
    const varint = (n: number) => {
      const out: number[] = [];
      while (n > 0x7f) {
        out.push((n & 0x7f) | 0x80);
        n >>>= 7;
      }
      out.push(n);
      return out;
    };
    const len = (field: number, body: number[]) => [(field << 3) | 2, ...varint(body.length), ...body];
    const str = (field: number, v: string) => len(field, [...Buffer.from(v)]);
    let any: number[] = len(1, [...Buffer.from("leaf")]); // AnyValue.string_value
    const levels = 200;
    for (let i = 0; i < levels; i++) any = len(5, len(1, any)); // AnyValue.array_value{ values: [any] }
    const kv = [...str(1, "k"), ...len(2, any)]; // KeyValue
    const span = [...len(1, Array(16).fill(1)), ...len(2, Array(8).fill(2)), ...str(5, "deep"), ...len(9, kv)];
    const req = len(1, len(2, len(2, span))); // resource_spans{ scope_spans{ spans } }
    const [d] = Bun.otel.decode(new Uint8Array(req));
    expect(d.name).toBe("deep");
    let depth = 0;
    for (let v: any = d.attributes.k; Array.isArray(v); v = v[0]) depth++;
    expect(depth).toBe(32);
  });
});

describe("configuration", () => {
  test("stats()", async () => {
    const before = Bun.otel.stats();
    tracer.startSpan("counted").end();
    await collect();
    const after = Bun.otel.stats();
    expect(after.spansExported).toBeGreaterThan(before.spansExported);
    expect(after).toEqual(
      expect.objectContaining({
        spansDropped: expect.any(Number),
        exportsSucceeded: expect.any(Number),
        exportsFailed: expect.any(Number),
        spansPending: 0,
        exportsInflight: 0,
      }),
    );
  });

  test("attribute count limit and dropped counts", async () => {
    Bun.otel.start({
      exporters: [{ export: (b: any[]) => spans.push(...b) }],
      instrumentations: [],
      limits: { attributeCountLimit: 2, eventCountLimit: 1, linkCountLimit: 0 },
    });
    const s = Bun.otel.tracer("lim").startSpan("lim");
    s.setAttributes({ a: 1, b: 2, c: 3, d: 4 });
    s.setAttribute("a", 10); // overwrite still allowed
    s.addEvent("e1").addEvent("e2");
    s.addLink({ context: s.spanContext() });
    s.end();
    const [got] = await collect();
    expect(got.attributes).toEqual({ a: 10, b: 2 });
    expect(got.droppedAttributesCount).toBe(2);
    expect(got.events).toHaveLength(1);
    expect(got.droppedEventsCount).toBe(1);
    expect(got.links).toHaveLength(0);
    expect(got.droppedLinksCount).toBe(1);
  });

  test("always_off sampler yields non-recording spans that still propagate ids", async () => {
    Bun.otel.start({
      exporters: [{ export: (b: any[]) => spans.push(...b) }],
      instrumentations: [],
      sampler: "always_off",
    });
    const t = Bun.otel.tracer("s");
    const s = t.startSpan("unsampled");
    expect(s.isRecording()).toBe(false);
    expect(s.spanContext().traceFlags).toBe(0);
    const c = t.startSpan("child", { parent: s });
    expect(c.traceId).toBe(s.traceId);
    c.end();
    s.end();
    expect(await collect()).toEqual([]);
  });

  test("parentbased sampler honours a remote unsampled parent", async () => {
    const t = Bun.otel.tracer("s2");
    const remote = {
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      traceFlags: 0,
      isRemote: true,
    };
    const s = t.startSpan(
      "from-remote",
      {},
      Bun.otel.propagator.extract(Bun.otel.ROOT_CONTEXT, { traceparent: `00-${remote.traceId}-${remote.spanId}-00` }),
    );
    expect(s.traceId).toBe(remote.traceId);
    expect(s.parentSpanId).toBe(remote.spanId);
    expect(s.isRecording()).toBe(false);
    s.end();
    const s2 = t.startSpan(
      "from-remote-sampled",
      {},
      Bun.otel.propagator.extract(Bun.otel.ROOT_CONTEXT, { traceparent: `00-${remote.traceId}-${remote.spanId}-01` }),
    );
    expect(s2.isRecording()).toBe(true);
    s2.end();
    const got = await collect();
    expect(got.map(g => g.name)).toEqual(["from-remote-sampled"]);
  });

  test("start() rejects bad options", () => {
    expect(() => Bun.otel.start({ exporters: [{ url: "not a url" }] })).toThrow(/invalid OTLP endpoint/);
    expect(() => Bun.otel.start({ exporters: [{ export: 1 }] } as any)).toThrow(/must be a function/);
    expect(() => Bun.otel.start({ instrumentations: { nope: true } } as any)).toThrow(/unknown instrumentation/);
    expect(() => Bun.otel.start({ sampler: "sometimes" } as any)).toThrow(/unknown sampler/);
    // pipeline still intact
  });
});
