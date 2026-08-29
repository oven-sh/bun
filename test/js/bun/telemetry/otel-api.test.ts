import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";

async function run(script: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  return { stdout, exitCode };
}

// A `using span` block that awaits runs with AsyncLocalStorage.enterWith
// semantics: the test function's caller (the runner) would see the span while
// the test is suspended. Tests that do that run their body in a scope.
const scoped = (fn: () => Promise<unknown>) => Bun.otel.contextManager.with(Bun.otel.ROOT_CONTEXT, fn);

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
  test("Bun.otel.span(name, attributes, fn): active inside, ends with fn, records a throw / rejection", async () => {
    const seen: unknown[] = [];
    const v = Bun.otel.span("sync", { a: 1 }, span => {
      seen.push(Bun.otel.activeSpan() === span);
      span.set("b", 2).set({ c: "3" });
      return 7;
    });
    expect(v).toBe(7);
    expect(Bun.otel.activeSpan()).toBeUndefined();
    const p = Bun.otel.span("async", async span => {
      await 1;
      seen.push(Bun.otel.activeSpan() === span);
      const child = Bun.otel.span("child", () => Bun.otel.activeSpan());
      seen.push((child as any).parentSpanId === (span as any).spanId);
      return "done";
    });
    expect(p).toBeInstanceOf(Promise);
    expect(await p).toBe("done");
    expect(() =>
      Bun.otel.span("throws", () => {
        throw new TypeError("boom");
      }),
    ).toThrow("boom");
    await expect(
      Bun.otel.span("rejects", async () => {
        await 1;
        throw Object.assign(new Error("nope"), { code: "E_NOPE" });
      }),
    ).rejects.toThrow("nope");
    {
      using span = Bun.otel.span("scoped", { s: true });
      seen.push(Bun.otel.activeSpan() === span);
      span.ok();
    }
    expect(seen).toEqual([true, true, true, true]);
    const got = Object.fromEntries((await collect()).map(s => [s.name, s]));
    expect(got.sync).toMatchObject({ attributes: { a: 1, b: 2, c: "3" }, status: { code: 0 } });
    expect(got.child.parentSpanId).toBe(got.async.spanId);
    expect(got.throws.status).toEqual({ code: 2, message: "boom" });
    expect(got.throws.events[0]).toMatchObject({
      name: "exception",
      attributes: { "exception.type": "TypeError", "exception.message": "boom" },
    });
    expect(got.rejects.status).toEqual({ code: 2, message: "nope" });
    expect(got.rejects.events[0].attributes["exception.type"]).toBe("E_NOPE");
    expect(got.scoped).toMatchObject({ attributes: { s: true }, status: { code: 1 } });
    for (const name of ["sync", "async", "child", "throws", "rejects", "scoped"])
      expect(got[name].endTime).toBeGreaterThan(0);
    // the default tracer's scope
    expect(got.sync.scope.name).toBe("bun");
  });

  test("span(name) with no callback: end() also stops it being the active span", async () => {
    // null attributes behave like undefined (2- and 3-argument forms)
    Bun.otel.span("nul", null as any).end();
    expect(Bun.otel.span("nul3", null as any, () => 3)).toBe(3);
    const s = Bun.otel.span("dangling");
    expect(Bun.otel.activeSpan()).toBe(s);
    s.end();
    expect(Bun.otel.activeSpan()).toBeUndefined();
    const next = Bun.otel.span("next", n => n);
    // startActiveSpan(name) (no callback) and enter() behave the same
    const a = tracer.startActiveSpan("a");
    a.end();
    const e = tracer.startSpan("e").enter();
    e.end();
    expect(Bun.otel.activeSpan()).toBeUndefined();
    // ending an entered span that is no longer the innermost active one leaves the active one alone
    const outer = Bun.otel.span("outer");
    const inner = Bun.otel.span("inner");
    outer.end();
    expect(Bun.otel.activeSpan()).toBe(inner);
    inner.end();
    // inner restored what it displaced (outer, now ended); outer's own exit() undoes its enter
    expect(Bun.otel.activeSpan()).toBe(outer);
    outer.exit();
    expect(Bun.otel.activeSpan()).toBeUndefined();
    const got = await collect();
    expect(got.find(x => x.name === "next").parentSpanId).toBeUndefined();
    expect(next.ended).toBe(true);
  });

  test("without any pipeline configured, JS-created spans are non-recording and nothing is buffered", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const before = Bun.otel.stats().spansPending;
        const rec = Bun.otel.span("a", s => s.isRecording());
        { using s = Bun.otel.span("b"); s.set("k", 1); }
        Bun.otel.tracer("t").startSpan("c").end();
        const w = Bun.otel.wrap("w", () => Bun.otel.activeSpan()?.spanContext().traceId.length)();
        console.log(JSON.stringify([Bun.otel.enabled, rec, Bun.otel.stats().spansPending - before, w]));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    // not enabled, not recording, nothing pending — but ids still exist for propagation
    expect(stdout.trim()).toBe(JSON.stringify([false, false, 0, 32]));
    expect(exitCode).toBe(0);
  });

  test("a span cell is an ordinary object to generic builtins (Array.prototype with a length, JSON, spread)", () => {
    const s: any = Bun.otel.tracer("t").startSpan("x");
    s.length = 3;
    expect([Array.prototype.indexOf.call(s, 1), Array.prototype.includes.call(s, undefined), [...Array.from(s)].length]).toEqual([-1, true, 3]);
    expect(typeof JSON.stringify(s)).toBe("string");
    s.end();
  });

  test("Bun.otel.wrap rejects a class (the wrapped function is not a constructor)", () => {
    expect(() => Bun.otel.wrap(class Foo {})).toThrow(TypeError);
    const w = Bun.otel.wrap(function plain() {
      return 1;
    });
    expect(() => new (w as any)()).toThrow(TypeError);
    expect(w()).toBe(1);
  });

  test("Bun.otel.wrap / span(name, fn) reject generator functions (the call returns before the body runs)", () => {
    expect(() => Bun.otel.wrap(function* gen() {})).toThrow(TypeError);
    expect(() => Bun.otel.wrap(async function* agen() {})).toThrow(TypeError);
    expect(() => Bun.otel.span("g", function* () {} as any)).toThrow(TypeError);
    expect(() => Bun.otel.span("g", {}, async function* () {} as any)).toThrow(TypeError);
    // an ordinary function that returns an iterator is fine: the caller decided that
    const w = Bun.otel.wrap(function iter() {
      return [1, 2][Symbol.iterator]();
    });
    expect([...w()]).toEqual([1, 2]);
  });

  test("wrap/span with a thenable: adopted into a Promise under the span, which ends when it settles", async () => {
    let ranUnder: string | undefined;
    const thenable = {
      then(resolve: (v: number) => void) {
        // a lazy query builder starts its work here — inside the span
        ranUnder = Bun.otel.activeSpan()?.name;
        setTimeout(() => resolve(42), 5);
      },
    };
    const listUsers = Bun.otel.wrap(function listUsers() {
      return thenable as any;
    });
    const p = listUsers();
    expect(p).toBeInstanceOf(Promise);
    expect(await p).toBe(42);
    const rejected = Bun.otel.span(
      "rejects",
      () => ({ then: (_: any, reject: any) => reject(new Error("nope")) }) as any,
    );
    await expect(rejected).rejects.toThrow("nope");
    const got = await collect();
    const lu = got.find(s => s.name === "listUsers");
    expect(ranUnder).toBe("listUsers");
    expect(lu.endTime - lu.startTime).toBeGreaterThan(4); // (ms) ≥ the 5 ms the thenable took
    expect(got.find(s => s.name === "rejects").status.code).toBe(2);
  });

  test("end() from another async frame (timer, Promise.all branch) does not leave the span active in the owning block", () =>
    scoped(async () => {
      let inTimer: string | undefined, afterBlock: string | undefined, afterWith: string | undefined;
      {
        using s = Bun.otel.span("a");
        setTimeout(() => {
          s.end();
          inTimer = Bun.otel.activeSpan()?.name;
        }, 0);
        await Bun.sleep(10);
      }
      afterBlock = Bun.otel.activeSpan()?.name;
      const s2 = Bun.otel.span("b");
      Bun.otel.with(s2, () => s2.end());
      s2.exit();
      afterWith = Bun.otel.activeSpan()?.name;
      expect([inTimer, afterBlock, afterWith]).toEqual([undefined, undefined, undefined]);
      await collect();
    }));

  test("a span kept past its block does not pin the AsyncLocalStorage stores it was created under once it ends", () => {
    const { AsyncLocalStorage } = require("node:async_hooks");
    const als = new AsyncLocalStorage();
    class Marker {}
    const kept: any[] = [];
    als.run(new Marker(), () => {
      const s = Bun.otel.span("ended");
      s.end();
      kept.push(s);
    });
    // control: a span that is still open keeps what it will restore on exit
    als.run(new Marker(), () => kept.push(Bun.otel.span("open")));
    // Reachability, not GC timing: count Marker objects reachable (≤3 edges)
    // from Span cells in a heap snapshot.
    const snap = Bun.generateHeapSnapshot() as any;
    const { nodes, edges, nodeClassNames } = snap;
    const cls = (i: number) => nodeClassNames[nodes[i * 4 + 2]];
    const index = new Map<number, number>();
    for (let i = 0; i < nodes.length / 4; i++) index.set(nodes[i * 4], i);
    const out = new Map<number, number[]>();
    for (let i = 0; i < edges.length; i += 4) {
      const f = index.get(edges[i]),
        t = index.get(edges[i + 1]);
      if (f !== undefined && t !== undefined) (out.get(f) ?? out.set(f, []).get(f)!).push(t);
    }
    const reachable = (name: string) => {
      let n = 0;
      for (let i = 0; i < nodes.length / 4; i++) {
        if (cls(i) !== "Span") continue;
        const seen = new Set([i]);
        let frontier = [i];
        for (let d = 0; d < 3; d++) {
          const next: number[] = [];
          for (const f of frontier) for (const t of out.get(f) ?? []) if (!seen.has(t)) (seen.add(t), next.push(t));
          frontier = next;
        }
        for (const x of seen) if (cls(x) === name) n++;
      }
      return n;
    };
    expect(reachable("Marker")).toBe(1); // only the open span's
    kept[1].exit();
    expect(kept.length).toBe(2);
  });

  test("context.with(suppressTracing(ctx)) suppresses native spans, and exporter callbacks run suppressed", async () => {
    const { context, createContextKey } = require("@opentelemetry/api");
    // = @opentelemetry/core suppressTracing()
    const suppressTracing = (ctx: any) =>
      ctx.setValue(createContextKey("OpenTelemetry SDK Context Key SUPPRESS_TRACING"), true);
    using server = Bun.serve({ port: 0, fetch: () => new Response("x") });
    Bun.otel.start({ exporters: [{ export: (b: any[]) => spans.push(...b) }], instrumentations: ["fetch"] });
    await context.with(suppressTracing(context.active()), async () => {
      await (await fetch(server.url)).text();
      Bun.otel.span("inner", () => {});
    });
    expect((await collect()).filter(s => s.scope.name === "bun.http.client" || s.name === "inner")).toEqual([]);
    // an exporter that fetch()es does not trace its own export
    let exported = 0;
    Bun.otel.start({
      exporters: [
        {
          async export(b: any[]) {
            exported += b.length;
            await (await fetch(server.url)).text();
          },
        },
      ],
      instrumentations: ["fetch"],
    });
    Bun.otel.span("one", () => {});
    await Bun.otel.forceFlush();
    await Bun.otel.forceFlush();
    expect([exported, Bun.otel.stats().spansPending]).toEqual([1, 0]);
  });

  test("after shutdown() nothing is recorded or delivered until the next start()", async () => {
    let delivered = 0;
    Bun.otel.start({ exporters: [{ export: (b: any[]) => (delivered += b.length) }] });
    Bun.otel.span("before", () => {});
    await Bun.otel.shutdown();
    expect(delivered).toBe(1);
    const late = Bun.otel.span("after-shutdown");
    expect(late.isRecording()).toBe(false);
    late.end();
    Bun.otel.tracer("t").startSpan("after2").end();
    await Bun.otel.forceFlush();
    expect(delivered).toBe(1);
    restore();
    Bun.otel.span("revived", () => {});
    expect((await collect()).map(s => s.name)).toEqual(["revived"]);
  });

  test("tracer() with no name is the default 'bun' scope", async () => {
    expect(Bun.otel.tracer().name).toBe("bun");
    Bun.otel.tracer().startSpan("t").end();
    const [s] = await collect();
    expect(s.scope.name).toBe("bun");
  });

  test("Bun.otel.set returns false once the span it would write to has ended, and on an unsampled span", async () => {
    let late: boolean | undefined;
    const { promise, resolve } = Promise.withResolvers<void>();
    Bun.otel.start({ exporters: [{ export: (b: any[]) => spans.push(...b) }], instrumentations: { http: true } });
    using server = Bun.serve({
      port: 0,
      fetch() {
        setTimeout(() => {
          late = Bun.otel.set("late", 1);
          resolve();
        }, 20);
        return new Response("ok");
      },
    });
    await (await fetch(server.url)).text();
    await promise;
    expect(late).toBe(false);
    Bun.otel.start({ exporters: [{ export: (b: any[]) => spans.push(...b) }], sampler: "always_off" });
    expect(Bun.otel.span("unsampled", s => Bun.otel.set("k", 1))).toBe(false);
    await collect();
  });

  test("span.fail / span.ok / string status and kind names", async () => {
    const s1 = tracer.startSpan("s1", { kind: "producer" });
    s1.fail("just a message").end();
    const s2 = tracer.startSpan("s2", { kind: "client" });
    s2.setStatus("error", "e").ok().setStatus("error", "ignored after ok").end();
    const s3 = tracer.startSpan("s3", { kind: "bogus" as any });
    s3.setStatus("unset").end();
    const got = Object.fromEntries((await collect()).map(s => [s.name, s]));
    expect([got.s1.kind, got.s1.status, got.s1.events[0].attributes]).toEqual([
      3,
      { code: 2, message: "just a message" },
      { "exception.message": "just a message" },
    ]);
    expect([got.s2.kind, got.s2.status]).toEqual([2, { code: 1 }]);
    expect([got.s3.kind, got.s3.status]).toEqual([0, { code: 0 }]);
  });

  test("span.fail(error) describes the error like a throw out of Bun.otel.span; recordException takes primitives", async () => {
    tracer.startSpan("manual").fail(new RangeError("x")).end();
    expect(() =>
      Bun.otel.span("auto", () => {
        throw new RangeError("x");
      }),
    ).toThrow("x");
    const dom = new DOMException("nope", "AbortError"); // numeric .code (20): the name is the type, not "20"
    tracer.startSpan("dom").fail(dom).end();
    tracer
      .startSpan("coded")
      .fail(Object.assign(new Error("e"), { code: "E_CODE" }))
      .end();
    tracer.startSpan("prim").recordException(42).recordException(false).recordException("s").end();
    const got = Object.fromEntries((await collect()).map(s => [s.name, s]));
    for (const name of ["manual", "auto"]) {
      expect(got[name]).toMatchObject({
        status: { code: 2, message: "x" },
        attributes: { "error.type": "RangeError" },
        events: [{ name: "exception", attributes: { "exception.type": "RangeError", "exception.message": "x" } }],
      });
    }
    expect(got.manual.events[0].attributes["exception.stacktrace"]).toEqual(expect.any(String));
    expect([got.dom.attributes["error.type"], got.dom.events[0].attributes["exception.type"]]).toEqual([
      "AbortError",
      "AbortError",
    ]);
    expect([got.coded.attributes["error.type"], got.coded.events[0].attributes["exception.type"]]).toEqual([
      "E_CODE",
      "E_CODE",
    ]);
    expect(got.prim.events.map((e: any) => e.attributes)).toEqual([
      { "exception.message": "42" },
      { "exception.message": "false" },
      { "exception.message": "s" },
    ]);
  });

  test("a span with its prototype removed still takes attributes through Bun.otel.set (no crash)", async () => {
    {
      using span = Bun.otel.span("noproto");
      Object.setPrototypeOf(span, null);
      expect(Bun.otel.set(new Proxy({ a: 1 }, {}) as any)).toBe(true);
      expect(Bun.otel.set("b", 2)).toBe(true);
    }
    const [s] = (await collect()).filter(s => s.name === "noproto");
    expect(s.attributes).toEqual({ a: 1, b: 2 });
  });

  test("a worker spawned before the main thread enables tracing gets the @opentelemetry/api global once it records", async () => {
    const { stdout, exitCode } = await run(`
      const { Worker } = require("node:worker_threads");
      const w = new Worker(\`
        const { parentPort } = require("node:worker_threads");
        parentPort.on("message", async () => {
          Bun.otel.tracer("w").startSpan("first").end(); // first touch: records natively
          await new Promise(r => setImmediate(r));
          const { trace } = require("@opentelemetry/api");
          parentPort.postMessage(trace.getTracer("x").startSpan("y").isRecording());
        });
        parentPort.postMessage("ready");
      \`, { eval: true });
      await new Promise(r => w.once("message", r));
      Bun.otel.start({ exporters: [] });
      w.postMessage("go");
      console.log(await new Promise(r => w.once("message", r)));
      await w.terminate();
    `);
    expect(stdout.trim()).toBe("true");
    expect(exitCode).toBe(0);
  });

  test("Bun.otel exposes only the public surface", () => {
    expect(Object.keys(Bun.otel).sort()).toEqual([
      "ROOT_CONTEXT",
      "SpanKind",
      "SpanStatusCode",
      "activeSpan",
      "contextManager",
      "decode",
      "enabled",
      "forceFlush",
      "propagator",
      "set",
      "shutdown",
      "span",
      "start",
      "stats",
      "tracer",
      "tracerProvider",
      "with",
      "wrap",
    ]);
    expect(() => (Bun.otel.span as any)("x", { a: 1 }, "not a function")).toThrow();
  });

  test("Bun.otel.wrap: name/length/this forwarded, span per call, errors and rejections recorded", async () => {
    const add = Bun.otel.wrap("add", function (this: any, a: number, b: number) {
      Bun.otel.set("args", `${a},${b}`);
      return (this?.base ?? 0) + a + b;
    });
    expect([add.name, add.length, add(1, 2), add.call({ base: 10 }, 1, 2)]).toEqual(["add", 2, 3, 13]);
    const named = Bun.otel.wrap(async function loadUser(id: string) {
      await 1;
      Bun.otel.set({ "user.id": id });
      return { id };
    });
    expect(named.name).toBe("loadUser");
    expect(await named("u1")).toEqual({ id: "u1" });
    const boom = Bun.otel.wrap("boom", () => {
      throw new RangeError("nope");
    });
    expect(() => boom()).toThrow("nope");
    const rejects = Bun.otel.wrap("rejects", async () => {
      await 1;
      throw Object.assign(new Error("later"), { code: "E_LATER" });
    });
    await expect(rejects()).rejects.toThrow("later");
    expect(() => (Bun.otel.wrap as any)(() => 1)).toThrow(/span name/);
    const weird = Object.defineProperty(() => 1, "length", { value: Infinity });
    expect(Bun.otel.wrap("weird", weird).length).toBe(0); // non-finite lengths are not forwarded
    // no active span → false
    expect(Bun.otel.set("k", 1)).toBe(false);
    const got = await collect();
    const by = (n: string) => got.filter(s => s.name === n);
    expect(by("add").map(s => s.attributes.args)).toEqual(["1,2", "1,2"]);
    expect(by("loadUser")[0].attributes).toEqual({ "user.id": "u1" });
    expect(by("boom")[0]).toMatchObject({
      status: { code: 2, message: "nope" },
      attributes: { "error.type": "RangeError" },
      events: [{ name: "exception", attributes: { "exception.type": "RangeError", "exception.message": "nope" } }],
    });
    expect(by("rejects")[0]).toMatchObject({
      status: { code: 2, message: "later" },
      attributes: { "error.type": "E_LATER" },
    });
  });

  test("Bun.otel.wrap'd async function: the returned promise is the function's own and stays unhandled if nobody handles it", async () => {
    const { stdout, exitCode } = await run(`
      Bun.otel.start({ exporters: [] });
      const f = Bun.otel.wrap("f", async () => { await 1; throw new Error("unhandled!"); });
      process.on("unhandledRejection", (e) => { console.log("unhandledRejection", e.message); });
      const inner = (async () => 1)();
      const same = Bun.otel.wrap("g", () => inner)() === inner;
      console.log("same promise", same);
      f();
    `);
    expect(stdout.trim().split("\n")).toEqual(["same promise true", "unhandledRejection unhandled!"]);
    expect(exitCode).toBe(0);
  });

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

  test("many attributes on one span: order kept, a repeated key overwrites in place", async () => {
    Bun.otel.start({
      exporters: [{ export: (b: any[]) => spans.push(...b) }],
      instrumentations: [],
      limits: { attributeCountLimit: 1000 },
    });
    const expected: Record<string, unknown> = {};
    // startSpan({ attributes }) with more keys than the scan threshold, then setAttribute/set past it.
    const initial: Record<string, number> = {};
    for (let i = 0; i < 40; i++) initial["init." + i] = expected["init." + i] = i;
    const span = Bun.otel.tracer("wide").startSpan("wide", { attributes: initial });
    for (let i = 0; i < 150; i++) {
      span.setAttribute("k." + i, i);
      expected["k." + i] = i;
    }
    // Overwrites: keys from before and after the index existed, through every entry point.
    span.setAttribute("init.3", "a");
    span.set("k.0", "b");
    span.setAttributes({ "k.149": "c", "init.39": "d", "new.1": 1 });
    span.set({ "k.75": "e", "new.2": 2 });
    Bun.otel.with(span, () => Bun.otel.set("k.1", "f"));
    span.fail(Object.assign(new Error("x"), { code: "E_WIDE" }));
    Object.assign(expected, {
      "init.3": "a",
      "k.0": "b",
      "k.149": "c",
      "init.39": "d",
      "new.1": 1,
      "k.75": "e",
      "new.2": 2,
      "k.1": "f",
      "error.type": "E_WIDE",
    });
    span.end();
    const [got] = await collect();
    expect(got.attributes).toEqual(expected);
    expect(Object.keys(got.attributes)).toEqual(Object.keys(expected));
    expect(got.droppedAttributesCount ?? 0).toBe(0);
  });

  test("non-Latin-1 attribute keys and long non-Latin-1 values are exported as UTF-8", async () => {
    const span = tracer.startSpan("unicode");
    const long = "值".repeat(4000);
    span.setAttribute("ключ🎉0", 1);
    span.setAttribute("big", long);
    span.setAttributes({ "キー": "値", ascii: "плохо" });
    span.end();
    const [got] = await collect();
    expect(got.attributes).toEqual({ "ключ🎉0": 1, big: long, "キー": "値", ascii: "плохо" });
  });

  test("events, links, status, exceptions, updateName", async () => {
    const other = tracer.startSpan("other");
    const span = tracer.startSpan("rich", { links: [{ context: other.spanContext(), attributes: { l: 1 } }] });
    span.addEvent("ev1", { a: 1 });
    span.addEvent("ev2", Date.now());
    span.addLink({ context: { ...other.spanContext(), traceState: "vendor=abc", isRemote: true } });
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
    expect(s.links[0].flags).toBe(0x101); // sampled, known-local
    expect(s.links[1].traceState).toBe("vendor=abc");
    expect(s.links[1].flags).toBe(0x301); // sampled, known-remote (isRemote: true)
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

  test("survives await, timers, queueMicrotask, process.nextTick, promise chains", () =>
    scoped(async () => {
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
    }));

  test("a `using` span in an async function's synchronous prefix has AsyncLocalStorage.enterWith semantics: active inside the function across awaits, and left active in the caller's frame", async () => {
    async function* agen() {
      yield 1;
    }
    async function plain() {
      using span = tracer.startActiveSpan("plain");
      await 1;
      return Bun.otel.activeSpan() === span;
    }
    async function forAwaitAsyncGen() {
      using span = tracer.startActiveSpan("fa");
      for await (const _ of agen()) {
      }
      return Bun.otel.activeSpan() === span;
    }
    // The synchronous prefix runs in the caller's frame (like ALS.enterWith):
    // the caller sees the span until its own context is next restored. The
    // callback forms (span(name, fn), wrap, startActiveSpan(name, fn)) scope
    // it lexically instead.
    await scoped(async () => {
      const p1 = plain();
      expect(Bun.otel.activeSpan()?.name).toBe("plain");
      expect(await p1).toBe(true);
    });
    expect(Bun.otel.activeSpan()).toBeUndefined();
    const p2 = Bun.otel.span("scoped", async () => forAwaitAsyncGen());
    expect(Bun.otel.activeSpan()?.name).not.toBe("fa");
    expect(await p2).toBe(true);
    await collect();
  });

  test("concurrent async functions keep separate contexts", async () => {
    const work = Bun.otel.wrap(async function work(delay: number) {
      const span = Bun.otel.activeSpan()!;
      await Bun.sleep(delay);
      expect(Bun.otel.activeSpan()).toBe(span);
      await Bun.sleep(1);
      expect(Bun.otel.activeSpan()).toBe(span);
      return span.spanId;
    });
    const ids = await Promise.all([work(3), work(1), work(2)]);
    expect(new Set(ids).size).toBe(3);
    expect(Bun.otel.activeSpan()).toBeUndefined();
    await collect();
  });

  // Needs oven-sh/WebKit#482 (every continuation installs the context it
  // captured, including "none"); on a JSC without it the span entered inside
  // the continuation stays active in the awaiting caller. Runs in a scope so a
  // failure here cannot leak that span into the tests after it.
  test.todo("context captured at await, not resume: enter after first await is scoped to that continuation", () =>
    scoped(async () => {
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
    }));

  test("coexists with AsyncLocalStorage in both nesting orders", () =>
    scoped(async () => {
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
      // `als.run` puts its own store back but, like enterWith, leaves the span
      // the callback's `using` activated in this frame (it suspended inside it).
      expect(Bun.otel.activeSpan()?.name).toBe("in-als");
      await collect();
    }));

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
    expect(() => Bun.otel.start({ sampler: { ratio: 0 } } as any)).toThrow(/sampler must be/);
    // pipeline still intact
  });
});
