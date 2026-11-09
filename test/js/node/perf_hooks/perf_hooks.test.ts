import * as internalForTesting from "bun:internal-for-testing";
import { estimateShallowMemoryUsageOf, heapStats } from "bun:jsc";
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, nodeExeAtLeast, tempDir, withoutAggressiveGC } from "harness";
import net from "net";
import { join } from "path";
import perf, { PerformanceObserver, type PerformanceNodeEntry } from "perf_hooks";
import { MessageChannel, receiveMessageOnPort, Worker } from "worker_threads";

test("stubs", () => {
  expect(perf.performance.nodeTiming).toBeObject();

  expect(perf.performance.now()).toBeNumber();
  expect(perf.performance.timeOrigin).toBeNumber();
  expect(perf.performance.eventLoopUtilization()).toBeObject();
});

// CI runs tests with BUN_GARBAGE_COLLECTOR_LEVEL=1, with which `expect()` collects. So a test of whether the GC runs by
// itself is in `withoutAggressiveGC`.

// Buckets are allocated 4 KB at a time, when a value is first recorded in them.
const chunk = 4096;
// With the default options, a value in each of the 88 chunks: 360 KB.
const valuesInEveryChunk = [1, 512, 1024, 1536];
for (let value = 2048; value < Number.MAX_SAFE_INTEGER; value *= 2) valuesInEveryChunk.push(value, value * 1.5);

test("the garbage collector knows the size of a histogram", () => {
  for (const [figures, chunks] of [
    [3, 88],
    [5, 9472],
  ]) {
    const histogram = perf.createHistogram({ figures });
    const size = () => estimateShallowMemoryUsageOf(histogram);
    expect(size()).toBeLessThan(1024);
    // 8 bytes for each chunk there can be.
    const table = chunks * 8;
    histogram.record(100);
    histogram.record(101);
    expect(size()).toBeWithin(table + chunk, table + chunk + 1024);
    histogram.record(Number.MAX_SAFE_INTEGER);
    histogram.add(histogram);
    expect(size()).toBeWithin(table + 2 * chunk, table + 2 * chunk + 1024);

    // A structured clone shares the buckets, and each of the two counts all of them, as with a SharedArrayBuffer.
    const clone = structuredClone(histogram);
    expect(estimateShallowMemoryUsageOf(clone)).toBe(size());
    expect(size()).toBeWithin(table + 2 * chunk, table + 2 * chunk + 1024);

    histogram.reset();
    expect(estimateShallowMemoryUsageOf(clone)).toBe(size());
    expect(size()).toBeLessThan(1024);
  }

  const histogram = perf.createHistogram();
  for (const value of valuesInEveryChunk) histogram.record(value);
  expect(estimateShallowMemoryUsageOf(histogram)).toBeWithin(88 * (chunk + 8), 88 * (chunk + 8) + 1024);
});

// The tests below count them, and a count that is `undefined` would end their loops at once.
test("heapStats() counts the histograms of each class", () => {
  const recordable = perf.createHistogram();
  const held = [recordable, structuredClone(recordable), perf.monitorEventLoopDelay()];
  held.push(structuredClone(held[2]));
  const { RecordableHistogram, ELDHistogram, Histogram } = heapStats().objectTypeCounts;
  expect(RecordableHistogram).toBeGreaterThanOrEqual(2);
  expect(ELDHistogram).toBeGreaterThanOrEqual(1);
  expect(Histogram).toBeGreaterThanOrEqual(1);
  expect(held.map(histogram => histogram.constructor.name)).toEqual([
    "RecordableHistogram",
    "RecordableHistogram",
    "ELDHistogram",
    "Histogram",
  ]);
});

test("histograms that grew are collected without an explicit GC", () => {
  // How many it takes depends on the size of the heap, but 720 MB is far more than enough.
  let created = 0;
  withoutAggressiveGC(() => {
    do {
      for (let i = 0; i < 100; i++) {
        const histogram = perf.createHistogram();
        for (const value of valuesInEveryChunk) histogram.record(value);
      }
      created += 100;
    } while (created < 2000 && heapStats().objectTypeCounts.RecordableHistogram > created / 2);
  });
  expect(created).toBeLessThan(2000);
});

// A clone did not allocate the buckets, but it keeps them alive once the original is dropped.
test("structured clones are collected without an explicit GC", () => {
  const histogram = perf.createHistogram();
  for (const value of valuesInEveryChunk) histogram.record(value);
  let created = 0;
  withoutAggressiveGC(() => {
    do {
      for (let i = 0; i < 100; i++) structuredClone(histogram);
      created += 100;
    } while (created < 2000 && heapStats().objectTypeCounts.RecordableHistogram > created / 2);
  });
  expect(created).toBeLessThan(2000);
});

test.each([
  ["full", `histograms = Array.from({ length: 100 }, () => createHistogram()); histograms.forEach(fill);`],
  [
    "empty, and again once it has filled them,",
    `if (step % 2 === 1) histograms = Array.from({ length: 100 }, () => createHistogram());
    else histograms.forEach(fill);`,
  ],
])("histograms that another thread sends %s are collected without an explicit GC", async (_, inWorker) => {
  const { port1, port2 } = new MessageChannel();
  const turn = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(
    `const { workerData: { port, turn, values } } = require("node:worker_threads");
    const { createHistogram } = require("node:perf_hooks");
    const fill = histogram => values.forEach(value => histogram.record(value));
    let histograms;
    for (let step = 1; ; step++) {
      Atomics.wait(turn, 0, step * 2 - 2);
      if (Atomics.load(turn, 0) < 0) break;
      try {
        ${inWorker}
        for (const histogram of histograms) port.postMessage(histogram);
      } catch (error) {
        Atomics.store(turn, 0, -1);
        Atomics.notify(turn, 0);
        throw error;
      }
      Atomics.store(turn, 0, step * 2);
      Atomics.notify(turn, 0);
    }`,
    { eval: true, workerData: { port: port2, turn, values: valuesInEveryChunk }, transferList: [port2] },
  );
  const failed = new Promise(resolve => worker.once("error", resolve));
  try {
    let received = 0;
    withoutAggressiveGC(() => {
      do {
        Atomics.add(turn, 0, 1);
        Atomics.notify(turn, 0);
        // Not a turn of the event loop, in which an idle GC could run. So nothing would time the test out.
        expect(Atomics.wait(turn, 0, (received / 100) * 2 + 1, 30_000)).not.toBe("timed-out");
        if (Atomics.load(turn, 0) < 0) return;
        for (let i = 0; i < 100; i++) expect(receiveMessageOnPort(port1)).toBeDefined();
        received += 100;
      } while (received < 2000 && heapStats().objectTypeCounts.RecordableHistogram > received / 2);
    });
    if (Atomics.load(turn, 0) < 0) throw await failed;
    expect(received).toBeLessThan(2000);
  } finally {
    Atomics.store(turn, 0, -1);
    Atomics.notify(turn, 0);
    await worker.terminate();
    port1.close();
  }
});

test("the prototypes of a histogram can be printed", () => {
  const printed: string[] = [];
  for (const histogram of [perf.createHistogram(), perf.monitorEventLoopDelay()]) {
    for (let p = Object.getPrototypeOf(histogram); p !== Object.prototype; p = Object.getPrototypeOf(p)) {
      printed.push(Bun.inspect({ p }).split("\n", 3).join(" "));
    }
  }
  expect(printed).toEqual([
    // As for every native class: the getter throws for a prototype.
    "{   p: RecordableHistogram {     count: undefined,",
    "{   p: Histogram {}, }",
    "{   p: ELDHistogram {     count: undefined,",
    "{   p: Histogram {}, }",
  ]);
});

test("doesn't throw", () => {
  expect(() => performance.mark("test")).not.toThrow();
  expect(() => performance.measure("test", "test")).not.toThrow();
  expect(() => performance.clearMarks()).not.toThrow();
  expect(() => performance.clearMeasures()).not.toThrow();
  expect(() => performance.getEntries()).not.toThrow();
  expect(() => performance.getEntriesByName("test")).not.toThrow();
  expect(() => performance.getEntriesByType("measure")).not.toThrow();
  expect(() => performance.now()).not.toThrow();
  expect(() => performance.timeOrigin).not.toThrow();
  // @ts-expect-error
  expect(() => performance.markResourceTiming()).not.toThrow();
});

// Node coerces the name via `${name}` for mark/clearMarks/clearMeasures, so a
// Symbol hits V8's ToString message. Verified against Node v26.3.0.
test("Symbol name argument throws V8 wording", () => {
  const msg = "Cannot convert a Symbol value to a string";
  expect(() => performance.mark(Symbol() as any)).toThrow(new TypeError(msg));
  expect(() => performance.clearMarks(Symbol() as any)).toThrow(new TypeError(msg));
  expect(() => performance.clearMeasures(Symbol() as any)).toThrow(new TypeError(msg));
});

// Node only looks at start/end to decide whether the options dict supplies
// timing; a {detail}/{duration}-only dict falls through and the trailing
// endMark is honoured. Verified against Node v26.3.0.
test("measure(name, optionsWithoutStartOrEnd, endMark) honours the trailing endMark", () => {
  performance.mark("end100", { startTime: 100 });
  const e = performance.measure("x", { detail: "d" }, "end100");
  expect({ detail: e.detail, startTime: e.startTime, duration: e.duration }).toEqual({
    detail: "d",
    startTime: 0,
    duration: 100,
  });
  // duration in the dict is discarded when endMark is supplied.
  const e2 = performance.measure("x2", { duration: 999 }, "end100");
  expect({ startTime: e2.startTime, duration: e2.duration }).toEqual({ startTime: 0, duration: 100 });
  // An empty dict + endMark still measures to the mark, not to now().
  const e3 = performance.measure("x3", {}, "end100");
  expect({ startTime: e3.startTime, duration: e3.duration }).toEqual({ startTime: 0, duration: 100 });
  performance.clearMarks("end100");
  performance.clearMeasures();
});

test("timerify entry shape", async () => {
  const { promise, resolve } = Promise.withResolvers<PerformanceNodeEntry>();
  const observer = new PerformanceObserver(list => resolve(list.getEntries()[0] as PerformanceNodeEntry));
  observer.observe({ entryTypes: ["function"] });

  const fn = perf.performance.timerify(function work(_a, _b) {});
  fn(42, "hello");

  const entry = await promise;
  observer.disconnect();

  expect(entry).toBeInstanceOf(PerformanceEntry);
  expect(entry.constructor.name).toBe("PerformanceNodeEntry");
  expect(Object.getPrototypeOf(entry.constructor)).toBe(PerformanceEntry);
  expect(entry.name).toBe("work");
  expect(entry.entryType).toBe("function");
  expect(typeof entry.startTime).toBe("number");
  expect(typeof entry.duration).toBe("number");
  expect(entry.detail).toEqual([42, "hello"]);
  // Node also exposes the args as indexed own-properties on the entry.
  expect(entry[0]).toBe(42);
  expect(entry[1]).toBe("hello");
  expect(entry.toJSON()).toEqual({
    name: "work",
    entryType: "function",
    startTime: entry.startTime,
    duration: entry.duration,
    detail: [42, "hello"],
  });
});

test("timerify is exposed on both performance and as a top-level export (Node v25.2+)", () => {
  expect(perf.performance.timerify).toBeFunction();
  expect(perf.timerify).toBeFunction();
});

// Captured from the real node v26.3.0 binary:
// `node -p "Object.keys(require('perf_hooks')).sort()"`.
test("export surface matches Node v26.3.0", () => {
  const nodeExports = [
    "Performance",
    "PerformanceEntry",
    "PerformanceMark",
    "PerformanceMeasure",
    "PerformanceObserver",
    "PerformanceObserverEntryList",
    "PerformanceResourceTiming",
    "constants",
    "createHistogram",
    "eventLoopUtilization",
    "monitorEventLoopDelay",
    "performance",
    "timerify",
  ];
  for (const name of nodeExports) {
    expect(perf).toHaveProperty(name);
  }
  // Node names the PerformanceNodeEntry class but does not export it.
  expect(perf.PerformanceNodeEntry).toBeUndefined();
  // Known bun-only extra, pre-existing on main: PerformanceNodeTiming.
  expect(
    Object.keys(perf)
      .filter(k => !nodeExports.includes(k))
      .sort(),
  ).toEqual(["PerformanceNodeTiming"]);
});

test("monitorEventLoopDelay().enable() doesn't reset a histogram that's already enabled", async () => {
  const histogram = perf.monitorEventLoopDelay({ resolution: 1 });
  expect(histogram.enable()).toBe(true);
  try {
    while (histogram.count === 0) await new Promise(resolve => setTimeout(resolve, 1));
    const { count } = histogram;
    expect(histogram.enable()).toBe(false);
    expect(histogram.count).toBeGreaterThanOrEqual(count);
  } finally {
    histogram.disable();
  }
});

// The options defaults must not read through a polluted Object.prototype.
// Node uses kEmptyObject for both; verified against Node v26.3.0.
test("timerify and createHistogram survive Object.prototype option pollution", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `Object.prototype.histogram = 1;
       Object.prototype.lowest = 99;
       Object.prototype.figures = 99;
       const { performance, createHistogram } = require("perf_hooks");
       console.log("timerify=" + typeof performance.timerify(function f() {}));
       console.log("histogram=" + typeof createHistogram().record);`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: "timerify=function\nhistogram=function\n", exitCode: 0 });
  expect(stderr).not.toContain("ERR_INVALID_ARG_TYPE");
});

test("timerify and AsyncResource.bind survive Object.prototype.get pollution", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { performance } = require("perf_hooks");
       const { AsyncResource } = require("async_hooks");
       // Pollute after module load: this test targets the two defineProperties
       // sites that timerify()/bind() call per invocation, not module init.
       Object.prototype.get = function () {};
       const t = performance.timerify(function f(_a) {});
       console.log("timerified name=" + t.name + " length=" + t.length);
       const bound = new AsyncResource("R").bind(function g(_a, _b) {});
       console.log("bound length=" + bound.length);`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("Invalid property descriptor");
  expect(stdout).toBe("timerified name=timerified f length=1\nbound length=2\n");
  expect(exitCode).toBe(0);
});

test("net entries are instanceof PerformanceEntry", async () => {
  const { promise, resolve } = Promise.withResolvers<PerformanceNodeEntry>();
  const observer = new PerformanceObserver(list => resolve(list.getEntries()[0] as PerformanceNodeEntry));
  observer.observe({ entryTypes: ["net"] });

  const server = net.createServer(c => c.end());
  await new Promise<void>(r => server.listen(0, r));
  const port = (server.address() as net.AddressInfo).port;
  const socket = net.connect(port, "127.0.0.1");
  await new Promise(r => socket.on("connect", r));

  const entry = await promise;
  observer.disconnect();
  socket.destroy();
  await new Promise(r => server.close(r));

  expect(entry).toBeInstanceOf(PerformanceEntry);
  expect(entry.constructor.name).toBe("PerformanceNodeEntry");
  expect(entry.entryType).toBe("net");
});

test("re-wrapped native entries, timing and observer keep JS identity", async () => {
  const name = "identity-" + Math.random();
  performance.mark(name);
  expect(performance.getEntriesByName(name)[0]).toBe(performance.getEntriesByName(name)[0]);
  expect((performance as any).timing).toBe((performance as any).timing);

  const { promise, resolve } = Promise.withResolvers<boolean>();
  const observer = new PerformanceObserver((list, obs) => {
    obs.disconnect();
    resolve(obs === observer && list.getEntries()[0] === list.getEntries()[0]);
  });
  observer.observe({ entryTypes: ["mark"] });
  performance.mark(name + "-2");
  expect(await promise).toBe(true);
});

test("PerformanceObserver delivers entries to a callback created in a node:vm context", async () => {
  // A context has no PerformanceObserver of its own. A test runner or a sandbox hands it the host class,
  // and the callback is then a function of the context's realm. Delivery used to crash the process.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const vm = require("node:vm");
       const perfHooks = require("node:perf_hooks");

       // Only its source is used: a context evaluates it, so the function belongs to the context's realm.
       function contextCallback(list, observer) {
         observer.disconnect();
         report({ receiver: this, passed: observer, list, names: list.getEntries().map(entry => entry.name) });
       }
       const callbackSource = "(" + contextCallback + ")";
       const check = ({ receiver, passed, list, names }, observer, callback) => ({
         foreignCallback: !(callback instanceof Function),
         receiver: receiver === observer,
         observer: passed === observer,
         list: list instanceof PerformanceObserverEntryList,
         names,
       });

       // The context gets the host class and constructs the observer itself.
       function insideTheContext() {
         const { promise, resolve } = Promise.withResolvers();
         const context = vm.createContext({
           PerformanceObserver,
           performance,
           report: result => resolve(check(result, observer, callback)),
         });
         const { observer, callback } = vm.runInContext(
           "const callback = " + callbackSource + ";" +
           "const observer = new PerformanceObserver(callback);" +
           "observer.observe({ entryTypes: ['mark'] });" +
           "performance.mark('inside-the-context');" +
           "({ observer, callback });",
           context,
         );
         return promise;
       }

       // The host constructs the observer around a function that a context returned.
       function fromTheHost(Observer, options, trigger) {
         const { promise, resolve } = Promise.withResolvers();
         const callback = vm.runInNewContext(callbackSource, {
           report: result => resolve(check(result, observer, callback)),
         });
         const observer = new Observer(callback);
         observer.observe(options);
         trigger?.();
         return promise;
       }

       (async () => {
         performance.measure("buffered", { start: 0, end: 1 });
         console.log(
           JSON.stringify({
             insideTheContext: await insideTheContext(),
             globalClass: await fromTheHost(PerformanceObserver, { entryTypes: ["mark"] }, () => performance.mark("global")),
             perfHooksClass: await fromTheHost(perfHooks.PerformanceObserver, { entryTypes: ["mark"] }, () =>
               performance.mark("perf_hooks"),
             ),
             // observe({ buffered: true }) delivers before it returns, not from a task.
             buffered: await fromTheHost(PerformanceObserver, { type: "measure", buffered: true }),
           }),
         );
       })();`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const delivered = { foreignCallback: true, receiver: true, observer: true, list: true };
  expect(JSON.parse(stdout)).toEqual({
    insideTheContext: { ...delivered, names: ["inside-the-context"] },
    globalClass: { ...delivered, names: ["global"] },
    perfHooksClass: { ...delivered, names: ["perf_hooks"] },
    buffered: { ...delivered, names: ["buffered"] },
  });
  expect(exitCode).toBe(0);
});

test("mark/measure toJSON and inspection include detail without perf_hooks being loaded", async () => {
  // These used to be patched onto the prototypes when node:perf_hooks was first required,
  // so JSON.stringify(performance.mark(...)) dropped `detail` until then.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const mark = performance.mark("m", { detail: { a: 1 } });
       const measure = performance.measure("mm", { start: 0, end: 1, detail: [1, 2] });
       const json = [JSON.parse(JSON.stringify(mark)), JSON.parse(JSON.stringify(measure))];
       const { inspect } = require("node:util");
       const custom = Symbol.for("nodejs.util.inspect.custom");
       const result = {
         json,
         inspected: [inspect(mark), inspect(measure, { depth: 0 }), inspect(mark, { depth: -1 })],
         nativeInspected: Bun.inspect(mark),
         // util.inspect never calls the hook on a prototype object. Bun.inspect / console.log do,
         // and the hook has to fall back to the default formatting there instead of throwing
         // from the brand-checked toJSON.
         protos: [
           inspect(PerformanceMark.prototype),
           Bun.inspect(PerformanceEntry.prototype).split("\\n")[0],
           Bun.inspect(PerformanceMark.prototype).split("\\n")[0],
           Bun.inspect(PerformanceMeasure.prototype).split("\\n")[0],
         ],
         descriptor: { ...Object.getOwnPropertyDescriptor(PerformanceEntry.prototype, custom), value: PerformanceEntry.prototype[custom].name },
         toJSONEnumerable: Object.getOwnPropertyDescriptor(PerformanceMark.prototype, "toJSON").enumerable,
         generic: PerformanceEntry.prototype[custom].call({ constructor: { name: "Fake" }, toJSON: () => ({ z: 1 }) }, 1, {}, inspect),
       };
       // util.inspect forwards an option it does not know to the hook as-is, so the hook's copy
       // of the options has to cope with an index key.
       result.indexOption = inspect(mark, { 0: 1 }).split("\\n")[0];
       // The hook copies the options the way { ...options } does: a setter that userland put on
       // Object.prototype under one of the option names must not run.
       Object.defineProperty(Object.prototype, "showHidden", { configurable: true, set() { throw new Error("setter ran"); } });
       result.polluted = inspect(mark).split("\\n")[0];
       console.log(JSON.stringify(result));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const result = JSON.parse(stdout);
  expect(result.json).toEqual([
    { name: "m", entryType: "mark", startTime: expect.any(Number), duration: 0, detail: { a: 1 } },
    { name: "mm", entryType: "measure", startTime: 0, duration: 1, detail: [1, 2] },
  ]);
  expect(result.inspected[0]).toStartWith("PerformanceMark {\n  name: 'm',");
  expect(result.inspected[0]).toContain("detail: { a: 1 }");
  expect(result.inspected[1]).toBe("PerformanceMeasure [Object]");
  expect(result.inspected[2]).toBe("PerformanceMark {}");
  expect(result.nativeInspected).toStartWith("PerformanceMark {\n  name: 'm',");
  expect(result.protos).toEqual([
    "PerformanceEntry [PerformanceMark] { detail: [Getter] }",
    "PerformanceEntry {",
    "PerformanceMark {",
    "PerformanceMeasure {",
  ]);
  expect(result.descriptor).toEqual({
    value: "[nodejs.util.inspect.custom]",
    writable: true,
    enumerable: false,
    configurable: true,
  });
  expect(result.toJSONEnumerable).toBe(false);
  expect(result.generic).toBe("Fake { z: 1 }");
  expect(result.indexOption).toBe("PerformanceMark {");
  expect(result.polluted).toBe("PerformanceMark {");
  expect(exitCode).toBe(0);
});

test("does not read performance and its classes from globalThis", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const natives = { performance, Performance, PerformanceEntry, PerformanceMark, PerformanceObserver };
       for (const name in natives) globalThis[name] = class {};
       const perf = require("node:perf_hooks");
       console.log(JSON.stringify({
         performance: perf.performance === natives.performance,
         Performance: perf.Performance === natives.Performance,
         PerformanceEntry: perf.PerformanceEntry === natives.PerformanceEntry,
         PerformanceMark: perf.PerformanceMark === natives.PerformanceMark,
         PerformanceObserver: Object.getPrototypeOf(perf.PerformanceObserver) === natives.PerformanceObserver,
         nodeTiming: perf.performance.nodeTiming instanceof natives.PerformanceEntry,
         eventLoopUtilization: typeof perf.performance.eventLoopUtilization,
         timerified: perf.performance.timerify(() => 1)(),
       }));`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    performance: true,
    Performance: true,
    PerformanceEntry: true,
    PerformanceMark: true,
    PerformanceObserver: true,
    nodeTiming: true,
    eventLoopUtilization: "function",
    timerified: 1,
  });
  expect(exitCode).toBe(0);
});

// `options.resolution` can be any safe integer >= 1.
describe("monitorEventLoopDelay with a resolution above the int32 range", () => {
  const cases = [
    { resolution: 2 ** 31, earlierCall: false, when: "as the first call" },
    { resolution: 2 ** 31, earlierCall: true, when: "after an earlier call" },
    { resolution: 2 ** 32, earlierCall: true, when: "after an earlier call" },
    { resolution: 2 ** 32 + 1, earlierCall: true, when: "after an earlier call" },
  ];

  test.concurrent.each(cases)("doesn't wrap resolution $resolution $when", async ({ resolution, earlierCall }) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { monitorEventLoopDelay } = require("node:perf_hooks");
         ${earlierCall ? "monitorEventLoopDelay();" : ""}
         const histogram = monitorEventLoopDelay({ resolution: ${resolution} });
         console.log("enable", histogram.enable());
         // If the resolution wrapped to 1 ms (2 ** 32 + 1 as an int32), it would record samples during these 10 ms.
         setTimeout(() => {
           console.log("count", histogram.count);
           console.log("disable", histogram.disable());
         }, 10);`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      // If the period wrapped to 0 ms (2 ** 32 as an int32), the timer would re-arm forever and hang the event loop.
      timeout: 4_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, stdout, exitCode, signalCode: proc.signalCode }).toEqual({
      stderr: "",
      stdout: "enable true\ncount 0\ndisable true\n",
      exitCode: 0,
      signalCode: null,
    });
  });
});

describe("gc entries", () => {
  // Most tests here run a script in a process of its own. A debug build cannot run twenty of those at once inside the
  // time that a test has.
  const concurrent = test.concurrentIf(!isDebug);

  // Each script runs in a process of its own and counts the collections of that process. A collection keeps no event
  // loop alive and does not wake it: its entry comes with the next turn of the loop. So a script holds a
  // short interval until it has the entries it waits for. Bun also collects by itself (once the entry point has loaded,
  // and more often under BUN_GARBAGE_COLLECTOR_LEVEL), so a script tells the collections it asks for by their flag.
  // forceGC() forces a full collection, as gc() does under --expose-gc. A script that has nothing else of Bun in it runs
  // on Node.js too, where this machine has one that is new enough, and its test expects the same of both runs.
  const defineForceGC = `
    const forceGC =
      typeof Bun === "object"
        ? () => Bun.gc(true)
        : (require("node:v8").setFlagsFromString("--expose-gc"), require("node:vm").runInNewContext("gc"));
  `;
  const node = nodeExeAtLeast("26.0.0");
  const bunAndNode = [bunExe(), ...(node ? [node] : [])];
  const nameOf = (exe: string) => (exe === node ? "Node.js" : "Bun");

  const prelude = `
    ${defineForceGC}
    const { PerformanceObserver, constants } = require("node:perf_hooks");
    const keepAlive = setInterval(() => {}, 10);
    const isForced = entry => entry.detail.flags === constants.NODE_PERFORMANCE_GC_FLAGS_FORCED;
    const finish = result => {
      clearInterval(keepAlive);
      console.log(JSON.stringify(result));
    };
  `;

  // A test that has timed out cannot end its script, which holds an interval or waits in the loop of --watch. The
  // scripts that still run when the tests are over are ended here.
  const scripts = new Set<{ kill(signal: "SIGKILL"): void }>();
  afterAll(() => {
    for (const script of scripts) script.kill("SIGKILL");
  });
  const tracked = <T extends { kill(signal: "SIGKILL"): void }>(script: T) => {
    scripts.add(script);
    return script;
  };

  type RunOptions = { flags?: string[]; env?: Record<string, string> };
  async function runOn(exe: string, script: string, { flags = [], env = {} }: RunOptions = {}) {
    await using proc = tracked(
      Bun.spawn({
        cmd: [exe, ...flags, "-e", prelude + script],
        env: { ...bunEnv, ...env },
        stdout: "pipe",
        stderr: "pipe",
      }),
    );
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr, nameOf(exe)).toBe("");
    return { on: nameOf(exe), result: stdout && JSON.parse(stdout), exitCode };
  }
  const run = (script: string, options?: RunOptions) => runOn(bunExe(), script, options);
  const runOnNodeToo = (script: string, options?: RunOptions) =>
    Promise.all(bunAndNode.map(exe => runOn(exe, script, options)));

  // Observes from here on and reports how many forced collections the first list with one has, after one of its own.
  const countForcedFromNowOn = `
    const counting = new PerformanceObserver(list => {
      const forced = list.getEntries().filter(isForced).length;
      if (forced === 0) return;
      counting.disconnect();
      finish({ forced });
    });
    counting.observe({ type: "gc" });
    forceGC();
  `;

  concurrent("an entry has the shape and the times of Node's", async () => {
    for (const { on, result, exitCode } of await runOnNodeToo(`
      const seen = {};
      let before, after;
      for (const [form, options] of [["entryTypes", { entryTypes: ["gc"] }], ["type", { type: "gc" }]]) {
        new PerformanceObserver((list, observer) => {
          const entry = list.getEntries().find(isForced);
          if (!entry) return;
          observer.disconnect();
          seen[form] = entry;
          if (!seen.entryTypes || !seen.type) return;
          finish({
            supported: PerformanceObserver.supportedEntryTypes.includes("gc"),
            sameEntryForBothObservers: seen.entryTypes === seen.type,
            isPerformanceEntry: entry instanceof PerformanceEntry,
            className: entry.constructor.name,
            json: entry.toJSON(),
            startTime: entry.startTime,
            duration: entry.duration,
            // The forced flag tells that the entry is the one of this call.
            lasts: entry.duration > 0,
            startsInsideTheCall: entry.startTime >= before,
            endsBeforeTheCallReturns: entry.startTime + entry.duration <= after,
          });
        }).observe(options);
      }
      before = performance.now();
      forceGC();
      after = performance.now();
    `)) {
      const { startTime, duration } = result;
      expect(result, on).toEqual({
        supported: true,
        sameEntryForBothObservers: true,
        isPerformanceEntry: true,
        className: "PerformanceNodeEntry",
        json: {
          name: "gc",
          entryType: "gc",
          startTime,
          duration,
          detail: {
            kind: perf.constants.NODE_PERFORMANCE_GC_MAJOR,
            flags: perf.constants.NODE_PERFORMANCE_GC_FLAGS_FORCED,
          },
        },
        startTime: expect.any(Number),
        duration: expect.any(Number),
        lasts: true,
        startsInsideTheCall: true,
        endsBeforeTheCallReturns: true,
      });
      expect(exitCode, on).toBe(0);
    }
  });

  concurrent("gc() and Bun.gc(true) have the forced flag, and Bun.gc(false) and bun:jsc do not", async () => {
    const { result, exitCode } = await run(
      `
      const { fullGC, gcAndSweep, edenGC } = require("bun:jsc");
      const texts = Array.from({ length: 50 }, (_, length) => Buffer.alloc(length, "x").toString());
      let garbage = [];
      const allocate = () => {
        for (let i = 0; i < 20000; i++) garbage.push({ i, text: texts[i % 50] });
        garbage = garbage.slice(-1000);
      };
      new PerformanceObserver((list, observer) => {
        const now = performance.now();
        const entries = list.getEntries();
        if (!entries.some(isForced)) return;
        observer.disconnect();
        const minor = entries.filter(entry => entry.detail.kind === constants.NODE_PERFORMANCE_GC_MINOR);
        finish({
          forcedKinds: entries.filter(isForced).map(entry => entry.detail.kind),
          unforcedFlags: [...new Set(entries.filter(entry => !isForced(entry)).map(entry => entry.detail.flags))],
          hasMinor: minor.length > 0,
          minorAreUnforced: !minor.some(isForced),
          kinds: [...new Set(entries.map(entry => entry.detail.kind))].sort(),
          everyOneLasts: entries.every(entry => entry.duration > 0),
          // One collection at a time.
          oneAfterTheOther: entries.every((entry, i) => {
            const last = entries[i - 1];
            return i === 0 || last.startTime + last.duration <= entry.startTime;
          }),
          everyOneHasEnded: entries.every(entry => entry.startTime + entry.duration <= now),
          allOfTheType: list.getEntriesByType("gc").length === entries.length,
          allOfTheName: list.getEntriesByName("gc").length === entries.length,
        });
      }).observe({ entryTypes: ["gc"] });
      // Bun.gc(false) only asks for a collection. It then runs inside the call that forces the next one.
      for (let i = 0; i < 3; i++) {
        allocate();
        Bun.gc(false);
        Bun.gc(true);
      }
      gc();
      gc();
      // What bun:jsc collects is not what the program forces in Node's sense.
      fullGC();
      gcAndSweep();
      edenGC();
    `,
      { flags: ["--expose-gc"] },
    );
    const { NODE_PERFORMANCE_GC_MAJOR: major, NODE_PERFORMANCE_GC_MINOR: minor } = perf.constants;
    expect(result).toEqual({
      forcedKinds: [major, major, major, major, major],
      unforcedFlags: [perf.constants.NODE_PERFORMANCE_GC_FLAGS_NO],
      hasMinor: true,
      minorAreUnforced: true,
      kinds: [minor, major],
      everyOneLasts: true,
      oneAfterTheOther: true,
      everyOneHasEnded: true,
      allOfTheType: true,
      allOfTheName: true,
    });
    expect(exitCode).toBe(0);
  });

  // The kind and the flags are Node's numbers, not what `constants` holds when the entry is made. The module of the
  // entries loads with the first observer, after the program had its chance to replace a global.
  concurrent("an entry does not depend on what the program did to constants and to Object.setPrototypeOf", async () => {
    for (const { on, result, exitCode } of await runOnNodeToo(`
      const { NODE_PERFORMANCE_GC_MAJOR: major, NODE_PERFORMANCE_GC_FLAGS_FORCED: forced } = constants;
      for (const name of Object.keys(constants)) constants[name] = -1;
      Object.setPrototypeOf = () => {
        throw new Error("replaced by the program");
      };
      new PerformanceObserver((list, observer) => {
        const entry = list.getEntries().find(entry => entry.detail.flags === forced);
        if (!entry) return;
        observer.disconnect();
        finish({ hasTheKindOfNode: entry.detail.kind === major });
      }).observe({ type: "gc" });
      forceGC();
    `)) {
      expect(result, on).toEqual({ hasTheKindOfNode: true });
      expect(exitCode, on).toBe(0);
    }
  });

  // With BUN_JSC_collectContinuously, other collections start and end inside the call that forces one.
  concurrent("a forced collection has the flag when other collections end inside the same call", async () => {
    const { result, exitCode } = await run(
      `
      new PerformanceObserver((list, observer) => {
        const forced = list.getEntries().filter(isForced);
        if (forced.length === 0) return;
        observer.disconnect();
        finish({
          forced: forced.length,
          forcedMinor: forced.filter(entry => entry.detail.kind === constants.NODE_PERFORMANCE_GC_MINOR).length,
        });
      }).observe({ type: "gc" });
      for (let i = 0; i < 40; i++) Bun.gc(true);
    `,
      { env: { BUN_JSC_collectContinuously: "1" } },
    );
    expect(result).toEqual({ forced: 40, forcedMinor: 0 });
    expect(exitCode).toBe(0);
  });

  concurrent("no collection is timed while nothing observes gc", async () => {
    for (const { on, result, exitCode } of await runOnNodeToo(`
      const observer = new PerformanceObserver(() => {});
      observer.observe({ type: "gc" });
      observer.disconnect();
      forceGC();
      forceGC();
      forceGC();
      ${countForcedFromNowOn}
    `)) {
      expect(result, on).toEqual({ forced: 1 });
      expect(exitCode, on).toBe(0);
    }
  });

  concurrent("no collection is timed after observe({ entryTypes }) takes gc from the last observer", async () => {
    for (const { on, result, exitCode } of await runOnNodeToo(`
      const observer = new PerformanceObserver(() => {});
      observer.observe({ entryTypes: ["gc", "function"] });
      observer.observe({ entryTypes: ["function"] });
      forceGC();
      forceGC();
      forceGC();
      ${countForcedFromNowOn}
      observer.disconnect();
    `)) {
      expect(result, on).toEqual({ forced: 1 });
      expect(exitCode, on).toBe(0);
    }
  });

  // Nothing calls disconnect() for the observer of a disposed graph: the registry drops it when it next has an entry for it.
  concurrent.each([
    ["a function entry", `performance.timerify(function produced() {})(); start();`],
    [
      "a gc entry",
      `new PerformanceObserver((list, observer) => {
         if (!list.getEntries().some(isForced)) return;
         observer.disconnect();
         start();
       }).observe({ type: "gc" });
       Bun.gc(true);`,
    ],
  ])("no collection is timed once %s has found the observer of a disposed Bun.ModuleGraph", async (_, find) => {
    const { result, exitCode } = await run(`
      const { performance } = require("node:perf_hooks");
      const graph = new Bun.ModuleGraph();
      graph.run(() => new PerformanceObserver(() => {}).observe({ entryTypes: ["gc", "function"] }));
      graph.dispose();
      function start() {
        Bun.gc(true);
        Bun.gc(true);
        Bun.gc(true);
        ${countForcedFromNowOn}
      }
      ${find}
    `);
    expect(result).toEqual({ forced: 1 });
    expect(exitCode).toBe(0);
  });

  concurrent("no collection is timed once the realm of the last observer is collected", async () => {
    const { result, exitCode } = await run(`
      const { heapStats } = require("bun:jsc");
      const realms = () => heapStats().objectTypeCounts.GlobalObject;
      const realmsBefore = realms();
      (() => {
        new ShadowRealm().evaluate(\`
          const { PerformanceObserver } = process.getBuiltinModule("node:perf_hooks");
          new PerformanceObserver(() => {}).observe({ type: "gc" });
        \`);
      })();
      let collections = 0;
      (function collect() {
        Bun.gc(true);
        if (realms() > realmsBefore && ++collections < 100) return setImmediate(collect);
        // The record of that collection reaches JS first, because the hand-off comes before the immediates of a turn.
        // Nothing is left to call, so the heap is let go.
        setImmediate(() => {
          Bun.gc(true);
          Bun.gc(true);
          Bun.gc(true);
          ${countForcedFromNowOn}
        });
      })();
    `);
    expect(result).toEqual({ forced: 1 });
    expect(exitCode).toBe(0);
  });

  // Each realm has its own node:perf_hooks, and so its own function that native code calls.
  concurrent.each(["main", "realm"])(
    "two realms that observe together both get a collection, with the %s first",
    async first => {
      const { result, exitCode } = await run(`
        const realm = new ShadowRealm();
        const inRealm = realm.evaluate(\`
          const { PerformanceObserver, constants } = process.getBuiltinModule("node:perf_hooks");
          let forced = 0;
          const observer = new PerformanceObserver(list => {
            forced += list.getEntries().filter(entry => entry.detail.flags === constants.NODE_PERFORMANCE_GC_FLAGS_FORCED).length;
          });
          what => (what === "observe" ? observer.observe({ type: "gc" }) : what === "disconnect" ? observer.disconnect() : forced);
        \`);
        const got = {};
        let forced = 0;
        const observer = new PerformanceObserver(list => {
          const before = forced;
          forced += list.getEntries().filter(isForced).length;
          // The other realm has its list by the next turn: one task called both realms.
          if (forced !== before) setImmediate(forced === 1 ? together : afterTheRealmLeft);
        });
        const mainIsFirst = ${first === "main"};
        if (mainIsFirst) observer.observe({ type: "gc" });
        inRealm("observe");
        if (!mainIsFirst) observer.observe({ type: "gc" });
        Bun.gc(true);
        function together() {
          got.together = { main: forced, realm: inRealm("count") };
          inRealm("disconnect");
          Bun.gc(true);
        }
        function afterTheRealmLeft() {
          got.afterTheRealmLeft = { main: forced, realm: inRealm("count") };
          observer.disconnect();
          Bun.gc(true);
          Bun.gc(true);
          Bun.gc(true);
          const counting = new PerformanceObserver(list => {
            const forced = list.getEntries().filter(isForced).length;
            if (forced === 0) return;
            counting.disconnect();
            finish({ ...got, forcedOnceBothLeft: forced });
          });
          counting.observe({ type: "gc" });
          Bun.gc(true);
        }
      `);
      expect(result).toEqual({
        together: { main: 1, realm: 1 },
        afterTheRealmLeft: { main: 2, realm: 1 },
        forcedOnceBothLeft: 1,
      });
      expect(exitCode).toBe(0);
    },
  );

  // The JS thread conducts a collection that it asked for, and the collection only goes on where the program
  // allocates. So with young objects to mark it is still under way at the next statement. It began before the observer
  // came, so it has no entry.
  concurrent("a collection that is under way when the first observer comes has no entry", async () => {
    const { result, exitCode } = await run(
      `
      const startACollection = () => {
        globalThis.young = Array.from({ length: 20000 }, (_, i) => ({ i, pair: [i, i] }));
        Bun.gc(false);
        globalThis.more = Array.from({ length: 2000 }, (_, i) => ({ i }));
      };
      let rounds = 0;
      let since;
      let beganBeforeTheObserverCame = 0;
      const observer = new PerformanceObserver(list => {
        const entries = list.getEntries();
        beganBeforeTheObserverCame += entries.filter(entry => entry.startTime < since).length;
        if (!entries.some(isForced)) return;
        observer.disconnect();
        // The hand-off comes before the immediates of a turn. It finds no observer, and drops what this round has left.
        if (++rounds < 5) return setImmediate(round);
        finish({ beganBeforeTheObserverCame });
      });
      function round() {
        startACollection();
        since = performance.now();
        observer.observe({ type: "gc" });
        Bun.gc(true);
      }
      round();
    `,
      { env: { BUN_GC_TIMER_DISABLE: "1" } },
    );
    expect(result).toEqual({ beganBeforeTheObserverCame: 0 });
    expect(exitCode).toBe(0);
  });

  // An entry lasts for the time that its collection kept the program from running. The program runs beside the
  // collection that Bun.gc(false) asks for: with young objects to mark, that collection is still under way when the loop
  // starts, and it goes on where the program allocates, so it ends behind the loop. The loop is no part of its entry.
  // So the entry is shorter than the time from its start to the start of the next collection, by half of the loop at
  // least. A collection that ended before the loop has a short entry whatever the entry counts, so the script looks at
  // three rounds in which a collection began before the loop.
  concurrent("an entry does not count the time in which the program runs beside its collection", async () => {
    const { result, exitCode } = await run(
      `
      const startACollection = () => {
        globalThis.young = Array.from({ length: 20000 }, (_, i) => ({ i, pair: [i, i] }));
        Bun.gc(false);
        globalThis.more = Array.from({ length: 2000 }, (_, i) => ({ i }));
      };
      const loopLasts = 200;
      const besideTheLoop = [];
      let rounds = 0;
      let loopStarted;
      new PerformanceObserver((list, observer) => {
        const entries = list.getEntries();
        if (!entries.some(isForced)) return;
        const beside = entries.findLast(entry => entry.startTime < loopStarted);
        const next = entries[entries.indexOf(beside) + 1];
        if (beside) besideTheLoop.push({ lasts: beside.duration, untilTheNext: next.startTime - beside.startTime });
        if (besideTheLoop.length < 3 && ++rounds < 20) return setImmediate(round);
        observer.disconnect();
        finish({
          beganBeforeTheLoop: besideTheLoop.length,
          lastWithoutTheLoop: besideTheLoop.every(({ lasts, untilTheNext }) => lasts < untilTheNext - loopLasts / 2),
        });
      }).observe({ type: "gc" });
      function round() {
        startACollection();
        loopStarted = performance.now();
        while (performance.now() - loopStarted < loopLasts);
        Bun.gc(true);
      }
      round();
    `,
      { env: { BUN_GC_TIMER_DISABLE: "1" } },
    );
    expect(result).toEqual({ beganBeforeTheLoop: 3, lastWithoutTheLoop: true });
    expect(exitCode).toBe(0);
  });

  // The start of an entry is on the timeline of performance.now(), and the program waits for all of a collection that
  // edenGC() asks for. So each entry lies between the two readings of the clock around its call.
  concurrent("the entry of a collection that the program waits for lies inside the call", async () => {
    const { result, exitCode } = await run(`
      const { edenGC } = require("bun:jsc");
      const calls = [];
      const entries = [];
      new PerformanceObserver((list, observer) => {
        entries.push(...list.getEntries());
        if (!entries.some(isForced)) return;
        observer.disconnect();
        // The first entry that starts at or after a call is of a collection that ends inside that call.
        const inside = calls.map(({ before, after }) => {
          const entry = entries.find(entry => entry.startTime >= before);
          return entry !== undefined && entry.startTime + entry.duration <= after;
        });
        finish({ inside });
      }).observe({ type: "gc" });
      for (let i = 0; i < 10; i++) {
        const before = performance.now();
        edenGC();
        calls.push({ before, after: performance.now() });
      }
      forceGC();
    `);
    expect(result).toEqual({ inside: Array(10).fill(true) });
    expect(exitCode).toBe(0);
  });

  // With BUN_JSC_logGC=1, JavaScriptCore prints each stop of a collection (p=) and the length of its cycle, in
  // milliseconds with six digits behind the point.
  const collectionsInTheLog = (log: string) =>
    [...log.matchAll(/START[^]*?cycle ([0-9.]+)ms END\]/g)].map(([collection, cycle]) => {
      const stops = [...collection.matchAll(/ p=([0-9.]+)ms/g)].map(([, stop]) => Number(stop));
      return { cycle: Number(cycle), stops: stops.length, allStops: stops.reduce((sum, stop) => sum + stop, 0) };
    });

  // The program runs beside the collections that its own allocations bring, so the entry of each lasts for its stops,
  // and for no longer than its cycle. The script marks where the allocations begin and end in the log. A collection
  // that is still under way at the second mark is left out: the forced collection behind the mark waits for it. A debug
  // build takes a second for three of the twenty rounds. With BUN_JSC_useConcurrentGC=0 a collection is one stop, which
  // begins a moment before its cycle is timed, so there the entry lasts for the cycle. Each row sets the option, so
  // that the environment of the test run does not decide how many stops a collection has.
  concurrent.each([
    ["some of which have more than one stop", { BUN_JSC_useConcurrentGC: "1" }, true],
    ["each of which is one stop", { BUN_JSC_useConcurrentGC: "0" }, false],
  ])(
    "an entry lasts for the stops that JavaScriptCore logs for its collection, %s",
    async (_, env, moreThanOneStop) => {
      await using proc = tracked(
        Bun.spawn({
          cmd: [
            bunExe(),
            "-e",
            `
            const { PerformanceObserver, constants } = require("node:perf_hooks");
            const { writeSync } = require("node:fs");
            const keepAlive = setInterval(() => {}, 10);
            const isForced = entry => entry.detail.flags === constants.NODE_PERFORMANCE_GC_FLAGS_FORCED;
            const entries = [];
            new PerformanceObserver((list, observer) => {
              entries.push(...list.getEntries());
              const [first, last] = entries.filter(isForced);
              if (!last) return;
              observer.disconnect();
              clearInterval(keepAlive);
              const between = entries.slice(entries.indexOf(first) + 1, entries.indexOf(last));
              console.log(JSON.stringify(between.map(entry => entry.duration)));
            }).observe({ type: "gc" });
            Bun.gc(true);
            writeSync(2, "\\n== the allocations begin\\n");
            let live = [];
            for (let round = 0; round < ${isDebug ? 3 : 20}; round++) {
              const made = [];
              for (let i = 0; i < 100000; i++) made.push({ i, pair: [i, i] });
              live = made;
            }
            writeSync(2, "\\n== the allocations end\\n");
            Bun.gc(true);
          `,
          ],
          env: { ...bunEnv, BUN_JSC_logGC: "1", BUN_GC_TIMER_DISABLE: "1", ...env },
          stdout: "pipe",
          stderr: "pipe",
        }),
      );
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const logged = collectionsInTheLog(
        stderr.slice(stderr.indexOf("== the allocations begin"), stderr.indexOf("== the allocations end")),
      );
      const durations: number[] = JSON.parse(stdout);
      expect({
        someHaveMoreThanOneStop: logged.some(({ stops }) => stops > 1),
        differFromTheLog: logged.filter(
          ({ cycle, allStops }, i) => !(Math.abs(durations[i] - Math.min(cycle, allStops)) < 0.001),
        ),
        // One more entry at most: the collection that was under way at the second mark.
        entriesForTheLog: [0, 1].includes(durations.length - logged.length),
      }).toEqual({ someHaveMoreThanOneStop: moreThanOneStop, differFromTheLog: [], entriesForTheLog: true });
      expect(exitCode).toBe(0);
    },
  );

  // With BUN_JSC_collectContinuously=1 a thread of JavaScriptCore asks for the next collection again and again. So a
  // collection can begin while the program is still inside the call that waited for the forced collection before it,
  // and then end beside the program. Whether one does in a round is up to the timing of that thread, so the test does
  // not count those collections: it holds every entry to one rule. Each stop that the log has for a collection kept
  // the program from running, so no entry is shorter than the stops of its collection, and none is longer than its
  // cycle. The entry of a forced collection lasts for its cycle. That finds the forced collections in the log, and with
  // them all those between. Without the generational collector, and with the concurrent one, each of those marks all
  // of the live objects in more than one stop. Windows and a debug build take too long for a child that collects at
  // every moment of its start, so the test is made only for the other builds.
  if (!isDebug && !isWindows) {
    test.concurrent(
      "no entry is shorter than the stops of its collection where one collection follows the other at once",
      async () => {
        await using proc = tracked(
          Bun.spawn({
            cmd: [
              bunExe(),
              "-e",
              `
            const { PerformanceObserver, constants } = require("node:perf_hooks");
            const isForced = entry => entry.detail.flags === constants.NODE_PERFORMANCE_GC_FLAGS_FORCED;
            globalThis.live = Array.from({ length: 100000 }, (_, i) => ({ i, pair: [i, i] }));
            const keepAlive = setInterval(() => {}, 1);
            const entries = [];
            let rounds = 0;
            const observer = new PerformanceObserver(list => {
              entries.push(...list.getEntries());
            });
            observer.observe({ type: "gc" });
            (function round() {
              // Until the forced entry of the round before is here, and the entry of a collection behind it.
              if (rounds && (entries.filter(isForced).length < rounds || isForced(entries.at(-1)))) {
                return setImmediate(round);
              }
              if (rounds === 20) {
                observer.disconnect();
                clearInterval(keepAlive);
                console.log(JSON.stringify(entries.map(entry => ({ lasts: entry.duration, forced: isForced(entry) }))));
                return;
              }
              rounds++;
              Bun.gc(true);
              setImmediate(round);
            })();
          `,
            ],
            env: {
              ...bunEnv,
              BUN_JSC_logGC: "1",
              BUN_JSC_collectContinuously: "1",
              BUN_JSC_collectContinuouslyPeriodMS: "0.1",
              BUN_JSC_useGenerationalGC: "0",
              BUN_JSC_useConcurrentGC: "1",
              BUN_GC_TIMER_DISABLE: "1",
            },
            stdout: "pipe",
            stderr: "pipe",
          }),
        );
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        const logged = collectionsInTheLog(stderr);
        const entries: { lasts: number; forced: boolean }[] = JSON.parse(stdout);
        const forced = entries.flatMap(({ forced }, i) => (forced ? [i] : []));
        // How far the log is ahead of the entries: there, each forced entry lasts for the cycle of its collection.
        const ahead = logged.flatMap((_, at) => {
          const by = at - forced[0];
          return forced.every(i => Math.abs((logged[i + by]?.cycle ?? NaN) - entries[i].lasts) < 0.000001) ? [by] : [];
        });
        const between = entries
          .slice(forced[0], forced.at(-1)! + 1)
          .map((entry, i) => ({ ...entry, ...logged[forced[0] + ahead[0] + i] }));
        const unforced = between.filter(({ forced }) => !forced);
        expect({
          forcedCollections: forced.length,
          placesInTheLog: ahead.length,
          someHaveMoreThanOneStop: unforced.some(({ stops }) => stops > 1),
          shorterThanTheirStops: unforced.filter(
            ({ lasts, cycle, allStops }) => !(lasts >= Math.min(cycle, allStops) - 0.001),
          ),
          longerThanTheirCycle: between.filter(({ lasts, cycle }) => !(lasts <= cycle + 0.001)),
        }).toEqual({
          forcedCollections: 20,
          placesInTheLog: 1,
          someHaveMoreThanOneStop: true,
          shorterThanTheirStops: [],
          longerThanTheirCycle: [],
        });
        expect(exitCode).toBe(0);
      },
    );
  }

  concurrent("the observers that exist when an entry reaches JS get it", async () => {
    // The entry is for whoever observes when it is handed over, and between the two
    // observers here nothing observes.
    for (const { on, result, exitCode } of await runOnNodeToo(`
      const got = { left: 0, came: 0 };
      const left = new PerformanceObserver(list => {
        got.left += list.getEntries().filter(isForced).length;
      });
      const came = new PerformanceObserver(list => {
        got.came += list.getEntries().filter(isForced).length;
        if (got.came === 0) return;
        came.disconnect();
        finish(got);
      });
      left.observe({ type: "gc" });
      forceGC();
      left.disconnect();
      came.observe({ type: "gc" });
    `)) {
      expect(result, on).toEqual({ left: 0, came: 1 });
      expect(exitCode, on).toBe(0);
    }
  });

  // observe() then has a registration for the Node types already, and gives it the class that follows the gc observers.
  concurrent("an observer of another Node type gets gc entries once it observes gc too", async () => {
    for (const { on, result, exitCode } of await runOnNodeToo(`
      const got = {};
      for (const [form, first, second] of [
        ["type", { type: "function" }, { type: "gc" }],
        ["entryTypes", { entryTypes: ["function"] }, { entryTypes: ["function", "gc"] }],
      ]) {
        const observer = new PerformanceObserver(list => {
          if (!list.getEntries().some(isForced)) return;
          observer.disconnect();
          got[form] = true;
          if (got.type && got.entryTypes) finish(got);
        });
        observer.observe(first);
        observer.observe(second);
      }
      forceGC();
    `)) {
      expect(result, on).toEqual({ type: true, entryTypes: true });
      expect(exitCode, on).toBe(0);
    }
  });

  // The thread pool answers faster than the callbacks run, so a task is queued at every point of every turn of the loop.
  // A debug build runs each callback far slower, so a quarter of the reads keeps its queue as full.
  concurrent("an entry reaches its observers while tasks keep the event loop busy", async () => {
    for (const { on, result, exitCode } of await runOnNodeToo(`
      const { stat } = require("node:fs");
      let reads = 0;
      let work = 0;
      let busy = true;
      new PerformanceObserver((list, observer) => {
        if (!list.getEntries().some(isForced)) return;
        observer.disconnect();
        const reachedWhileBusy = busy;
        busy = false;
        finish({ reachedWhileBusy });
      }).observe({ type: "gc" });
      function read() {
        if (!busy) return;
        stat(process.execPath, () => {
          for (let i = 0; i < 2000; i++) work += i % 7;
          if (++reads === 2000) forceGC();
          // Long after the collection. An entry that waits for an empty queue comes behind this.
          if (reads === 150000) busy = false;
          read();
        });
      }
      for (let i = 0; i < ${isDebug ? 128 : 512}; i++) read();
    `)) {
      expect(result, on).toEqual({ reachedWhileBusy: true });
      expect(exitCode, on).toBe(0);
    }
  });

  // A reader of getEntries()[0] alone counts one of these five.
  concurrent("the collections of one turn of the loop reach an observer in one list", async () => {
    for (const { on, result, exitCode } of await runOnNodeToo(`
      const lists = [];
      new PerformanceObserver((list, observer) => {
        const forced = list.getEntries().filter(isForced).length;
        if (forced === 0) return;
        lists.push(forced);
        if (lists.reduce((sum, count) => sum + count) < 5) return;
        observer.disconnect();
        finish({ lists });
      }).observe({ type: "gc" });
      setTimeout(() => {
        for (let i = 0; i < 5; i++) forceGC();
      }, 1);
    `)) {
      expect(result, on).toEqual({ lists: [5] });
      expect(exitCode, on).toBe(0);
    }
  });

  // Node's test-performance-gc.js holds the loop with two immediates, one from the other, and no longer. As in Node,
  // the entry reaches its observer between the two: the first turn of the loop after the collection hands it over.
  // The small collection of the second row, and the two turns behind it, end well inside a millisecond.
  concurrent.each([
    {
      what: "gc() at the top level",
      exes: bunAndNode,
      collect: (then: string) => `asked = performance.now(); gc(); ${then}`,
    },
    {
      what: "a small collection in a timer",
      exes: [bunExe()],
      collect: (then: string) =>
        `setTimeout(() => { asked = performance.now(); require("bun:jsc").edenGC(); ${then} }, 1);`,
    },
  ])("the entry of $what reaches its observer in the first turn of the loop after it", async ({ exes, collect }) => {
    for (const exe of exes) {
      await using proc = tracked(
        Bun.spawn({
          cmd: [
            exe,
            "--expose-gc",
            "-e",
            `
              const { PerformanceObserver } = require("node:perf_hooks");
              const order = [];
              let asked;
              new PerformanceObserver((list, observer) => {
                if (!list.getEntries().some(entry => entry.startTime >= asked)) return;
                observer.disconnect();
                order.push("entry");
              }).observe({ type: "gc" });
              ${collect(`
                setImmediate(() => {
                  order.push("first immediate");
                  setImmediate(() => order.push("second immediate"));
                });
              `)}
              process.on("exit", () => console.log(JSON.stringify(order)));
            `,
          ],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        }),
      );
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr, nameOf(exe)).toBe("");
      expect(stdout, nameOf(exe)).toBe('["first immediate","entry","second immediate"]\n');
      expect(exitCode, nameOf(exe)).toBe(0);
    }
  });

  // A collection in every turn of the loop does not put off the entry of the first one.
  concurrent("the entry of a collection does not wait for the collections that follow it closely", async () => {
    const { result, exitCode } = await run(`
      const { edenGC } = require("bun:jsc");
      let arrived = false;
      let turns = 0;
      const since = performance.now();
      new PerformanceObserver((list, observer) => {
        if (!list.getEntries().some(entry => entry.startTime >= since)) return;
        observer.disconnect();
        arrived = true;
      }).observe({ type: "gc" });
      setImmediate(function again() {
        if (arrived || ++turns === 500) return finish({ arrived });
        edenGC();
        setImmediate(again);
      });
    `);
    expect(result).toEqual({ arrived: true });
    expect(exitCode).toBe(0);
  });

  // No interval here. The entries are never delivered, an unref'd immediate does not run, and "beforeExit" is emitted
  // once.
  concurrent.each([
    ["alone", "", "", 0],
    ["beside an unref'd immediate", "", `setImmediate(() => { ranUnrefd = true; }).unref();`, 0],
    ["beside a cleared immediate", "", `clearImmediate(setImmediate(() => {}));`, 0],
    [
      "in an unref'd immediate that queues itself again",
      "",
      `(function again() { forceGC(); setImmediate(() => { ranUnrefd = true; again(); }).unref(); })();`,
      0,
    ],
    // The cleanup of a FinalizationRegistry is a task that the collection itself queues, and it holds the loop until it ran.
    [
      "with a cleanup for a FinalizationRegistry, beside an unref'd immediate",
      `const registry = new FinalizationRegistry(() => { cleanups++; }); (() => { registry.register({}, 0); })();`,
      `setImmediate(() => { ranUnrefd = true; }).unref();`,
      1,
    ],
  ])("a collection %s does not keep the event loop alive", async (_, before, after, cleanups) => {
    for (const exe of bunAndNode) {
      await using proc = tracked(
        Bun.spawn({
          cmd: [
            exe,
            "-e",
            `${defineForceGC}
             const { PerformanceObserver } = require("node:perf_hooks");
             let delivered = 0;
             let beforeExit = 0;
             let ranUnrefd = false;
             let cleanups = 0;
             new PerformanceObserver(list => {
               delivered += list.getEntries().length;
             }).observe({ type: "gc" });
             ${before}
             forceGC();
             ${after}
             process.on("beforeExit", () => {
               beforeExit++;
               for (let i = 0; i < 20; i++) forceGC();
             });
             process.on("exit", () => console.log(JSON.stringify({ delivered, beforeExit, ranUnrefd, cleanups })));`,
          ],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        }),
      );
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr, nameOf(exe)).toBe("");
      expect({ printed: stdout && JSON.parse(stdout), signalCode: proc.signalCode }, nameOf(exe)).toEqual({
        printed: { delivered: 0, beforeExit: 1, ranUnrefd: false, cleanups },
        signalCode: null,
      });
      expect(exitCode, nameOf(exe)).toBe(0);
    }
  });

  // The loop makes a turn in which nothing holds it. An unref'd immediate brings that turn. Or the collection is in the
  // last immediate and queues the cleanup of a FinalizationRegistry, which holds the loop until it has run. The entry
  // waits, and arrives in the turn that the timer of the listener brings.
  concurrent.each([
    [
      "an unref'd immediate",
      `Bun.gc(true);
       const until = performance.now() + 5;
       while (performance.now() < until);
       setImmediate(() => {}).unref();`,
    ],
    [
      "the cleanup of its own FinalizationRegistry",
      `const registry = new FinalizationRegistry(() => {});
       setImmediate(() => {
         (() => { registry.register({}, 0); })();
         Bun.gc(true);
         const until = performance.now() + 5;
         while (performance.now() < until);
       });`,
    ],
  ])(
    "an entry that waits through a turn that only %s brings arrives once something holds the loop",
    async (_, collects) => {
      await using proc = tracked(
        Bun.spawn({
          cmd: [
            bunExe(),
            "-e",
            `const { PerformanceObserver, constants } = require("node:perf_hooks");
           let giveUp;
           let emittedBeforeExit = false;
           const forced = { beforeTheListener: 0, afterIt: 0 };
           new PerformanceObserver((list, observer) => {
             const count = list.getEntries().filter(entry => entry.detail.flags === constants.NODE_PERFORMANCE_GC_FLAGS_FORCED).length;
             if (emittedBeforeExit) forced.afterIt += count;
             else forced.beforeTheListener += count;
             if (forced.afterIt === 0) return;
             observer.disconnect();
             clearTimeout(giveUp);
             console.log(JSON.stringify(forced));
           }).observe({ type: "gc" });
           ${collects}
           process.once("beforeExit", () => {
             emittedBeforeExit = true;
             giveUp = setTimeout(() => console.log(JSON.stringify({ ...forced, gaveUp: true })), 3000);
           });`,
          ],
          env: { ...bunEnv, BUN_GC_TIMER_DISABLE: "1" },
          stdout: "pipe",
          stderr: "pipe",
        }),
      );
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe('{"beforeTheListener":0,"afterIt":1}\n');
      expect(exitCode).toBe(0);
    },
  );

  // No interval at first. The hand-off finds nothing that holds the loop, and tries again in the turn that the interval of
  // the listener brings.
  concurrent("an entry that found nothing to hold the loop arrives once something holds it", async () => {
    await using proc = tracked(
      Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const { PerformanceObserver, constants } = require("node:perf_hooks");
         const registry = new FinalizationRegistry(() => {});
         (() => { registry.register({}, 0); })();
         let keepAlive;
         let lists = 0;
         new PerformanceObserver((list, observer) => {
           lists++;
           if (!list.getEntries().some(entry => entry.detail.flags === constants.NODE_PERFORMANCE_GC_FLAGS_FORCED)) return;
           observer.disconnect();
           clearInterval(keepAlive);
           console.log(JSON.stringify({ lists }));
         }).observe({ type: "gc" });
         Bun.gc(true);
         process.once("beforeExit", () => {
           keepAlive = setInterval(() => {}, 1000);
         });`,
        ],
        env: { ...bunEnv, BUN_GC_TIMER_DISABLE: "1" },
        stdout: "pipe",
        stderr: "pipe",
      }),
    );
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe('{"lists":1}\n');
    expect(exitCode).toBe(0);
  });

  // A macro runs inside require(), on an event loop of its own that ends with the macro. What the hand-off queued there
  // would never run again. So the entry of a collection in the macro waits for the loop of the program.
  concurrent("the entry of a collection in a macro that waits arrives once the macro has returned", async () => {
    using dir = tempDir("perf-hooks-gc-macro", {
      "macro.ts": `
        import { readFile } from "node:fs";
        export async function collectsAndWaits() {
          Bun.gc(true);
          await new Promise<void>(resolve => readFile(import.meta.path, () => resolve()));
          return 1;
        }
      `,
      "uses-macro.ts": `
        import { collectsAndWaits } from "./macro.ts" with { type: "macro" };
        export const value = collectsAndWaits();
      `,
      "main.cjs": `
        const { PerformanceObserver, constants } = require("node:perf_hooks");
        const log = [];
        let insideRequire = false;
        const keepAlive = setInterval(() => {}, 1000);
        new PerformanceObserver(list => {
          const forced = list.getEntries().filter(entry => entry.detail.flags === constants.NODE_PERFORMANCE_GC_FLAGS_FORCED);
          if (forced.length === 0) return;
          log.push({ forced: forced.length, insideRequire });
          // The observer still gets the entries of later collections.
          if (log.length === 2) return setTimeout(() => Bun.gc(true), 1);
          clearInterval(keepAlive);
          console.log(JSON.stringify(log));
        }).observe({ type: "gc" });
        // From a timer: the turn of the loop that follows it hands the record over with no wait in between.
        setTimeout(() => {
          insideRequire = true;
          const { value } = require("./uses-macro.ts");
          insideRequire = false;
          log.push({ required: value });
        }, 1);
      `,
    });
    await using proc = tracked(
      Bun.spawn({
        cmd: [bunExe(), "main.cjs"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      }),
    );
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // A debug build prints a line for each call of a macro first.
    expect(JSON.parse(stdout.trim().split("\n").at(-1)!)).toEqual([
      { required: 1 },
      { forced: 1, insideRequire: false },
      { forced: 1, insideRequire: false },
    ]);
    expect(exitCode).toBe(0);
  });

  concurrent("a Worker's observer gets the collections of the Worker only", async () => {
    for (const { on, result, exitCode } of await runOnNodeToo(`
      const { Worker } = require("node:worker_threads");
      // The Worker ends with its observer connected.
      const worker = new Worker(
        \`${defineForceGC}
         const { parentPort } = require("node:worker_threads");
         const { PerformanceObserver, constants } = require("node:perf_hooks");
         const keepAlive = setInterval(() => {}, 1000);
         let forced = 0;
         new PerformanceObserver(list => {
           forced += list.getEntries().filter(entry => entry.detail.flags === constants.NODE_PERFORMANCE_GC_FLAGS_FORCED).length;
           if (forced === 0) return;
           clearInterval(keepAlive);
           parentPort.postMessage({ forced });
         }).observe({ type: "gc" });
         parentPort.once("message", () => {
           forceGC();
           forceGC();
         });
         parentPort.postMessage("ready");\`,
        { eval: true },
      );
      let forcedHere = 0;
      let forcedInWorker;
      let workerExitCode;
      const observer = new PerformanceObserver(list => {
        forcedHere += list.getEntries().filter(isForced).length;
        done();
      });
      observer.observe({ type: "gc" });
      function done() {
        if (forcedHere === 0 || workerExitCode === undefined) return;
        observer.disconnect();
        finish({ forcedHere, forcedInWorker, workerExitCode });
      }
      worker.on("message", message => {
        if (message !== "ready") {
          forcedInWorker = message.forced;
          return;
        }
        forceGC();
        forceGC();
        forceGC();
        worker.postMessage("go");
      });
      worker.on("exit", code => {
        workerExitCode = code;
        done();
      });
    `)) {
      expect(result, on).toEqual({ forcedHere: 3, forcedInWorker: 2, workerExitCode: 0 });
      expect(exitCode, on).toBe(0);
    }
  });

  // The registry puts each entry into the buffer of its observers with Array.prototype.push, which a program can replace.
  const whenTheRegistryBuffersAGCEntry = (then: string) => `
    const push = Array.prototype.push;
    Array.prototype.push = function (...items) {
      if (items[0]?.entryType === "gc") {
        ${then}
      }
      return push.apply(this, items);
    };
  `;

  concurrent("an error from the code that takes an entry is reported, and the next entries arrive", async () => {
    const { result, exitCode } = await run(`
      let thrown = 0;
      let delivered = 0;
      const uncaught = [];
      process.on("uncaughtException", error => {
        uncaught.push(error.message);
        if (uncaught.length !== 2) return;
        // Two entries have thrown. The next collection is for the restored push.
        Array.prototype.push = push;
        Bun.gc(true);
      });
      new PerformanceObserver((list, observer) => {
        // A collection that Bun made by itself can be in the first list.
        delivered += list.getEntries().filter(isForced).length;
        if (delivered === 0) return;
        observer.disconnect();
        finish({ thrownForEachEntry: thrown === uncaught.length && thrown >= 2, uncaught: [...new Set(uncaught)], delivered });
      }).observe({ type: "gc" });
      ${whenTheRegistryBuffersAGCEntry(`thrown++; throw new Error("thrown for a gc entry");`)}
      Bun.gc(true);
      Bun.gc(true);
    `);
    expect(result).toEqual({ thrownForEachEntry: true, uncaught: ["thrown for a gc entry"], delivered: 1 });
    expect(exitCode).toBe(0);
  });

  // The hand-off is a callback of the event loop like any other: a microtask that was queued inside it runs when it
  // returns. The immediate of the timer is in the batch of that turn.
  concurrent("a microtask from the hand-off of an entry runs before the immediates of that turn", async () => {
    const { result, exitCode } = await run(`
      let queued = 0;
      let ran = 0;
      new PerformanceObserver(() => {}).observe({ type: "gc" });
      ${whenTheRegistryBuffersAGCEntry(`queued++; queueMicrotask(() => { ran++; });`)}
      setTimeout(() => {
        Bun.gc(true);
        setImmediate(() => finish({ queued: queued > 0, ranAllOfThem: ran === queued }));
      }, 1);
    `);
    expect(result).toEqual({ queued: true, ranAllOfThem: true });
    expect(exitCode).toBe(0);
  });

  // The deadline of a node:vm run ends the script that a nested wait of the event loop runs: Bun.build() waits for
  // setup(). Under load the deadline can pass before the task of the run has collected, so the run is made again until
  // `done` says that it did what the test is about. A task that comes after its run does nothing, because no deadline
  // would end it there.
  const runsIntoAVMTimeoutInANestedWait = (inTheTask: string) => `
    const vm = require("node:vm");
    const { readFile } = require("node:fs");
    const { PerformanceObserver, constants } = require("node:perf_hooks");
    const never = new Promise(() => {});
    const isForced = entry => entry.detail.flags === constants.NODE_PERFORMANCE_GC_FLAGS_FORCED;
    let inTheRun = false;
    let forcedCollections = 0;
    globalThis.collectInATask = () => {
      readFile(__filename, () => {
        if (!inTheRun) return;
        forcedCollections++;
        Bun.gc(true);
        ${inTheTask}
      });
    };
    function runUntil(done) {
      let code;
      do {
        inTheRun = true;
        try {
          vm.runInNewContext(
            "collectInATask(); Bun.build({ entrypoints: ['./entry.js'], plugins: [{ name: 'never', setup: () => never }] })",
            { Bun, never, collectInATask },
            { timeout: 100 },
          );
        } catch (error) {
          code = error.code;
        }
        inTheRun = false;
      } while (!done());
      return code;
    }
  `;

  async function runInADirectory(script: string) {
    using dir = tempDir("perf-hooks-gc-vm-timeout", { "entry.js": `export default 1;`, "main.cjs": script });
    await using proc = tracked(
      Bun.spawn({ cmd: [bunExe(), "main.cjs"], env: bunEnv, cwd: String(dir), stdout: "pipe", stderr: "pipe" }),
    );
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    return { result: stdout && JSON.parse(stdout), exitCode };
  }

  // The task is ended with its record on the way. The hand-off does not enter script with that termination pending, so
  // the record waits and arrives after the run.
  const afterATaskThatTheDeadlineEnds = (then: string) => `
    ${runsIntoAVMTimeoutInANestedWait(`for (;;) {}`)}
    function run() {
      const keepAlive = setInterval(() => {}, 50);
      let code;
      const finish = result => {
        clearInterval(keepAlive);
        console.log(JSON.stringify({ code, ...result }));
      };
      new PerformanceObserver((list, observer) => {
        if (!list.getEntries().some(isForced)) return;
        observer.disconnect();
        ${then}
      }).observe({ type: "gc" });
      code = runUntil(() => forcedCollections > 0);
    }
  `;

  concurrent(
    "the entry of a collection arrives after a node:vm timeout that ends the task that collected",
    async () => {
      const { result, exitCode } = await runInADirectory(
        `${afterATaskThatTheDeadlineEnds(`finish({ arrived: true });`)} run();`,
      );
      expect(result).toEqual({ code: "ERR_SCRIPT_EXECUTION_TIMEOUT", arrived: true });
      expect(exitCode).toBe(0);
    },
  );

  // Here the deadline ends the hand-off itself: the code that takes the entry of a forced collection does not return
  // inside the run. The record that it did not take waits for the next turn. The observer of the run can have lost the
  // immediate that calls it to the same termination, so an observer that comes after the run counts the entries.
  concurrent("no entry is lost to a node:vm timeout that ends the code that takes it", async () => {
    const { result, exitCode } = await runInADirectory(`
      ${runsIntoAVMTimeoutInANestedWait(``)}
      let endedInTheHandOff = false;
      ${whenTheRegistryBuffersAGCEntry(`
        if (inTheRun && isForced(items[0])) {
          endedInTheHandOff = true;
          for (;;) {}
        }
      `)}
      const keepAlive = setInterval(() => {}, 50);
      const inTheRunObserver = new PerformanceObserver(() => {});
      inTheRunObserver.observe({ type: "gc" });
      const code = runUntil(() => endedInTheHandOff);
      Array.prototype.push = push;
      const afterTheRun = new PerformanceObserver((list, observer) => {
        const forced = list.getEntries().filter(isForced).length;
        if (forced === 0) return;
        observer.disconnect();
        clearInterval(keepAlive);
        console.log(JSON.stringify({ code, lost: forcedCollections - forced }));
      });
      afterTheRun.observe({ type: "gc" });
      inTheRunObserver.disconnect();
      forcedCollections++;
      Bun.gc(true);
    `);
    expect(result).toEqual({ code: "ERR_SCRIPT_EXECUTION_TIMEOUT", lost: 0 });
    expect(exitCode).toBe(0);
  });

  // A "beforeExit" listener runs with no callback of the event loop under it. The hand-off leaves the loop as it found
  // it: afterwards the tick and the microtask of a timer still run before the next timer.
  concurrent("callbacks keep their order after a node:vm timeout that a hand-off met", async () => {
    const { result, exitCode } = await runInADirectory(`
      ${afterATaskThatTheDeadlineEnds(
        `const order = [];
         setTimeout(() => {
           order.push("timer 1");
           Promise.resolve().then(() => order.push("microtask"));
           process.nextTick(() => order.push("tick"));
         }, 1);
         setTimeout(() => {
           order.push("timer 2");
           setImmediate(() => finish({ order }));
         }, 1);`,
      )}
      process.once("beforeExit", run);
    `);
    expect(result).toEqual({
      code: "ERR_SCRIPT_EXECUTION_TIMEOUT",
      order: ["timer 1", "tick", "microtask", "timer 2"],
    });
    expect(exitCode).toBe(0);
  });

  concurrent.each([
    ["exits", `process.exit(7);`, "", 7],
    [
      "exits in a listener of uncaughtException",
      `throw new Error("thrown for a gc entry");`,
      `process.on("uncaughtException", () => process.exit(7));`,
      7,
    ],
    [
      "ends with an error from a listener of uncaughtException",
      `throw new Error("thrown for a gc entry");`,
      `process.on("uncaughtException", () => { throw new Error("thrown by the listener"); });`,
      1,
    ],
  ])("a Worker that %s while it takes an entry takes no more of them", async (_, then, more, code) => {
    const { result, exitCode } = await run(`
      const { Worker } = require("node:worker_threads");
      const taken = new Int32Array(new SharedArrayBuffer(4));
      const worker = new Worker(
        \`const { workerData: taken } = require("node:worker_threads");
         const { PerformanceObserver } = require("node:perf_hooks");
         new PerformanceObserver(() => {}).observe({ type: "gc" });
         ${whenTheRegistryBuffersAGCEntry(`Atomics.add(taken, 0, 1); ${then}`)}
         ${more}
         setInterval(() => {}, 1000);
         Bun.gc(true);
         Bun.gc(true);
         Bun.gc(true);\`,
        { eval: true, workerData: taken },
      );
      worker.on("error", () => {});
      worker.on("exit", workerExitCode => finish({ workerExitCode, taken: Atomics.load(taken, 0) }));
    `);
    expect(result).toEqual({ workerExitCode: code, taken: 1 });
    expect(exitCode).toBe(0);
  });

  // v8.GCProfiler times a collection from its start to its end. The program waits for a collection that edenGC(),
  // fullGC() or Bun.gc(true) asks for, so the entry of each lasts for all of it: these are the last three. With this
  // many live objects to mark, such a collection has more than one stop, and its stops alone are shorter. A debug build
  // marks slowly enough with a tenth of the objects. With BUN_JSC_useConcurrentGC=0 a collection is one stop from its
  // start to its end, so there the entry of every collection lasts for all of it.
  concurrent.each([
    ["a collection that the program waits for", {}, -3],
    ["every collection that never lets go of the program", { BUN_JSC_useConcurrentGC: "0" }, 0],
  ])("v8.GCProfiler reports the same collections, and the entry of %s lasts as long", async (_, env, from) => {
    const { result, exitCode } = await run(
      `
      const { fullGC, edenGC } = require("bun:jsc");
      globalThis.live = Array.from({ length: ${isDebug ? 10000 : 100000} }, (_, i) => ({ i, pair: [i, i] }));
      const profiler = new (require("node:v8").GCProfiler)();
      const entries = [];
      let statistics;
      new PerformanceObserver((list, observer) => {
        entries.push(...list.getEntries());
        const [first, last] = entries.filter(isForced);
        if (!last) return;
        observer.disconnect();
        // The profiler starts behind the first forced collection and stops behind the last.
        const profiled = entries.slice(entries.indexOf(first) + 1, entries.indexOf(last) + 1);
        finish({
          kinds: profiled.map(entry => entry.detail.kind),
          profiledKinds: statistics.map(({ gcType }) =>
            gcType === "MarkSweepCompact" ? constants.NODE_PERFORMANCE_GC_MAJOR : constants.NODE_PERFORMANCE_GC_MINOR,
          ),
          lastAsLong:
            profiled.length === statistics.length &&
            profiled.slice(${from}).every((entry, i) => entry.duration >= statistics.slice(${from})[i].cost / 1000),
        });
      }).observe({ type: "gc" });
      Bun.gc(true);
      profiler.start();
      let garbage = [];
      for (let i = 0; i < 60000; i++) garbage.push({ i, pair: [i, i] });
      garbage = undefined;
      Bun.gc(false);
      edenGC();
      fullGC();
      Bun.gc(true);
      statistics = profiler.stop().statistics;
    `,
      { env },
    );
    expect(result.kinds.length).toBeGreaterThanOrEqual(3);
    expect(result).toEqual({ kinds: result.profiledKinds, profiledKinds: result.profiledKinds, lastAsLong: true });
    expect(exitCode).toBe(0);
  });

  // An idle collection is asked for after BUN_IDLE_GC_SECONDS of quiet. The JS thread then waits without heap access, so
  // on a machine that is not busy the collector thread ends the collection, and the request of an idle collection wakes
  // the loop when it has ended. On Windows the JS thread ends it, in a turn that the timer of Bun's collector brings.
  // One second of quiet is the least that Bun takes, and a debug build needs most of the default timeout for this test.
  // So it has a timeout of its own, above the time after which the program gives up, and then it says what it has seen.
  concurrent(
    "an idle collection reaches the observers of a program that waits",
    async () => {
      using dir = tempDir("perf-hooks-gc-idle", {
        "waits.cjs": `
          const { PerformanceObserver, constants } = require("node:perf_hooks");
          // Enough live objects that the marking is not over in the pause that starts the collection.
          const live = [];
          for (let i = 0; i < 100000; i++) live.push({ i, text: "x" + i, tags: ["a" + i, "b" + i] });
          const seen = [];
          const giveUp = setTimeout(() => console.log(JSON.stringify({ gaveUp: true, seen })), 15000);
          let waitsSince = Infinity;
          new PerformanceObserver((list, observer) => {
            for (const entry of list.getEntries())
              seen.push([entry.detail.kind, Math.round(entry.startTime - waitsSince), Math.round(entry.duration)]);
            // The idle collection is a full one. The full one right after the entry point has loaded is not it.
            const entry = list.getEntries().find(
              entry => entry.detail.kind === constants.NODE_PERFORMANCE_GC_MAJOR && entry.startTime > waitsSince + 500,
            );
            if (!entry) return;
            observer.disconnect();
            clearTimeout(giveUp);
            console.log(JSON.stringify({ flags: entry.detail.flags, live: live.length }));
          }).observe({ type: "gc" });
          waitsSince = performance.now();
        `,
      });
      await using proc = tracked(
        Bun.spawn({
          cmd: [bunExe(), "waits.cjs"],
          env: {
            ...bunEnv,
            BUN_IDLE_GC_SECONDS: "1",
            BUN_GC_TIMER_INTERVAL: "250",
            BUN_GC_TIMER_DISABLE: undefined,
          },
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        }),
      );
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ flags: perf.constants.NODE_PERFORMANCE_GC_FLAGS_NO, live: 100000 });
      expect(exitCode).toBe(0);
    },
    30_000,
  );

  // node:perf_hooks sets its own function. The tests of the built-in functions call the setter with every kind of value.
  test("what native code calls for each collection is a function", () => {
    for (const listener of [{}, null, 1, "emitGCEntry"]) {
      expect(() => internalForTesting.setGCPerformanceEntryListener(listener)).toThrow(
        new TypeError("The listener must be a function or undefined"),
      );
    }
  });

  // The native class makes these checks, as it did while "gc" was a type without entries.
  concurrent("observe() takes `type` or `entryTypes` with gc, and does not change from one to the other", async () => {
    for (const { on, result, exitCode } of await runOnNodeToo(`
      const attempt = (...calls) => {
        const observer = new PerformanceObserver(() => {});
        try {
          for (const options of calls) observer.observe(options);
          return "no throw";
        } catch (error) {
          return error.name;
        } finally {
          observer.disconnect();
        }
      };
      finish({
        "entryTypes:[mark] -> type:gc": attempt({ entryTypes: ["mark"] }, { type: "gc" }),
        "type:mark -> entryTypes:[gc]": attempt({ type: "mark" }, { entryTypes: ["gc"] }),
        "{entryTypes:[gc], type:gc}": attempt({ entryTypes: ["gc"], type: "gc" }),
        "entryTypes:[mark,gc] -> type:gc": attempt({ entryTypes: ["mark", "gc"] }, { type: "gc" }),
        "{entryTypes:[gc], type:mark}": attempt({ entryTypes: ["gc"], type: "mark" }),
        "type:mark -> entryTypes:[mark,gc]": attempt({ type: "mark" }, { entryTypes: ["mark", "gc"] }),
        "entryTypes:[mark,gc] -> type:mark": attempt({ entryTypes: ["mark", "gc"] }, { type: "mark" }),
        "{entryTypes:[mark], type:gc}": attempt({ entryTypes: ["mark"], type: "gc" }),
        "{entryTypes:[mark,gc], type:mark}": attempt({ entryTypes: ["mark", "gc"], type: "mark" }),
      });
    `)) {
      expect(result, on).toEqual({
        "entryTypes:[mark] -> type:gc": "InvalidModificationError",
        "type:mark -> entryTypes:[gc]": "InvalidModificationError",
        "{entryTypes:[gc], type:gc}": "TypeError",
        "entryTypes:[mark,gc] -> type:gc": "InvalidModificationError",
        "{entryTypes:[gc], type:mark}": "TypeError",
        "type:mark -> entryTypes:[mark,gc]": "InvalidModificationError",
        "entryTypes:[mark,gc] -> type:mark": "InvalidModificationError",
        "{entryTypes:[mark], type:gc}": "TypeError",
        "{entryTypes:[mark,gc], type:mark}": "TypeError",
      });
      expect(exitCode, on).toBe(0);
    }
  });

  test("an observe() with gc that throws leaves what the observer observes as it was", () => {
    const observer = new PerformanceObserver(() => {});
    try {
      observer.observe({ type: "mark" });
      expect(() => observer.observe({ entryTypes: ["gc", "measure"] })).toThrow(
        expect.objectContaining({ name: "InvalidModificationError" }),
      );
      performance.mark("observed after the throw");
      expect(observer.takeRecords().map(entry => entry.name)).toEqual(["observed after the throw"]);
    } finally {
      observer.disconnect();
      performance.clearMarks("observed after the throw");
    }
  });

  // The native class makes its checks before the registry knows that the observer asked for gc.
  concurrent("an observe() with gc that throws observes no gc, and no collection is timed for it", async () => {
    for (const { on, result, exitCode } of await runOnNodeToo(`
      let gcEntries = 0;
      const observer = new PerformanceObserver(list => {
        gcEntries += list.getEntries().filter(entry => entry.entryType === "gc").length;
      });
      observer.observe({ type: "mark" });
      let threw;
      try {
        observer.observe({ entryTypes: ["gc", "measure"] });
      } catch (error) {
        threw = error.name;
      }
      forceGC();
      forceGC();
      forceGC();
      const counting = new PerformanceObserver(list => {
        const forced = list.getEntries().filter(isForced).length;
        if (forced === 0) return;
        counting.disconnect();
        observer.disconnect();
        finish({ threw, gcEntries, forced });
      });
      counting.observe({ type: "gc" });
      forceGC();
    `)) {
      expect(result, on).toEqual({ threw: "InvalidModificationError", gcEntries: 0, forced: 1 });
      expect(exitCode, on).toBe(0);
    }
  });

  // The native class keeps the mode of an observer that has disconnected. A request that it saw twice found the observer
  // registered the second time, and threw.
  concurrent("observe() with gc beside a web type asks the native class once", async () => {
    for (const { on, result, exitCode } of await runOnNodeToo(`
      const observer = new PerformanceObserver(() => {});
      const attempt = options => {
        try {
          observer.observe(options);
          return "no throw";
        } catch (error) {
          return error.name;
        } finally {
          observer.disconnect();
        }
      };
      observer.observe({ type: "mark" });
      observer.disconnect();
      const besideAWebType = attempt({ entryTypes: ["gc", "mark"] });
      observer.observe({ type: "gc" });
      observer.disconnect();
      finish({ besideAWebType, everyType: attempt({ entryTypes: [...PerformanceObserver.supportedEntryTypes] }) });
    `)) {
      expect(result, on).toEqual({ besideAWebType: "no throw", everyType: "no throw" });
      expect(exitCode, on).toBe(0);
    }
  });

  test("supportedEntryTypes has the types of Node", () => {
    // `node -p "require('perf_hooks').PerformanceObserver.supportedEntryTypes"` of node v26.3.0.
    expect(PerformanceObserver.supportedEntryTypes).toEqual([
      "dns",
      "function",
      "gc",
      "http",
      "http2",
      "mark",
      "measure",
      "net",
      "quic",
      "resource",
    ]);
  });

  test("constants has Node's kinds of collection", () => {
    // `node -p "require('perf_hooks').constants"` of node v26.12.1, the NODE_PERFORMANCE_GC_ names without FLAGS.
    expect(
      Object.fromEntries(
        Object.entries(perf.constants).filter(([name]) => /^NODE_PERFORMANCE_GC_(?!FLAGS)/.test(name)),
      ),
    ).toEqual({
      NODE_PERFORMANCE_GC_MAJOR: 4,
      NODE_PERFORMANCE_GC_MINOR: 1,
      NODE_PERFORMANCE_GC_MINOR_MARK_SWEEP: 2,
      NODE_PERFORMANCE_GC_INCREMENTAL: 8,
      NODE_PERFORMANCE_GC_WEAKCB: 16,
    });
  });

  // Runs the test files with `bun test`, and gives what they wrote to "forced.log" too.
  async function runTestFiles(
    files: Record<string, string>,
    { flags = [], env = {} }: { flags?: string[]; env?: Record<string, string> } = {},
  ) {
    using dir = tempDir("perf-hooks-gc-bun-test", files);
    await using proc = tracked(
      Bun.spawn({
        cmd: [bunExe(), "test", ...flags, ...Object.keys(files).filter(name => name.endsWith(".test.js"))],
        env: { ...bunEnv, NODE_PATH: undefined, ...env },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      }),
    );
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const log = Bun.file(join(String(dir), "forced.log"));
    return { output: stdout + stderr, exitCode, forcedLog: (await log.exists()) ? await log.text() : "" };
  }

  // No interval here: nothing but the runner waits for the entry. A test with a timeout has the timer of that timeout,
  // so the runner turns the loop, and the entry arrives.
  concurrent("bun test delivers an entry to a test that only the runner waits for", async () => {
    const { output, exitCode } = await runTestFiles({
      "gc-runner-only.test.js": `
        import { test } from "bun:test";
        import { PerformanceObserver, constants } from "node:perf_hooks";
        test("gets a gc entry", async () => {
          await new Promise(resolve => {
            const observer = new PerformanceObserver(list => {
              if (!list.getEntries().some(entry => entry.detail.flags === constants.NODE_PERFORMANCE_GC_FLAGS_FORCED)) return;
              observer.disconnect();
              resolve();
            });
            observer.observe({ type: "gc" });
            Bun.gc(true);
          });
        });
      `,
    });
    expect(output).toContain("(pass) gets a gc entry");
    expect(exitCode).toBe(0);
  });

  // Fake timers replace performance.now(), and the clock of the collector is the real one.
  concurrent("bun test: an entry has its start on the real clock under fake timers", async () => {
    const { output, exitCode } = await runTestFiles({
      "gc-fake-timers.test.js": `
        import { expect, jest, test } from "bun:test";
        import { PerformanceObserver, constants } from "node:perf_hooks";
        test("a gc entry starts and ends on the real clock", async () => {
          const keepAlive = setInterval(() => {}, 1000);
          const before = performance.now();
          jest.useFakeTimers();
          const { promise, resolve } = Promise.withResolvers();
          const observer = new PerformanceObserver(list => {
            const forced = list.getEntries().find(entry => entry.detail.flags === constants.NODE_PERFORMANCE_GC_FLAGS_FORCED);
            if (forced) resolve(forced);
          });
          observer.observe({ type: "gc" });
          Bun.gc(true);
          const entry = await promise;
          observer.disconnect();
          jest.useRealTimers();
          clearInterval(keepAlive);
          expect(entry.startTime).toBeGreaterThanOrEqual(before);
          expect(entry.startTime + entry.duration).toBeLessThanOrEqual(performance.now());
        });
      `,
    });
    expect(output).toContain("(pass) a gc entry starts and ends on the real clock");
    expect(exitCode).toBe(0);
  });

  // --isolate gives each file a global object of its own, and nothing disconnects the observers of a finished file.
  concurrent("bun test --isolate: an observer that a file leaves connected gets nothing of the next file", async () => {
    // Each file's observer writes its name for every forced collection that it gets.
    const file = (name: string) => `
        import { test } from "bun:test";
        import { appendFileSync } from "node:fs";
        import { PerformanceObserver, constants } from "node:perf_hooks";

        test("${name} gets its own forced collection", async () => {
          const keepAlive = setInterval(() => {}, 1000);
          const { promise, resolve } = Promise.withResolvers();
          new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
              if (entry.detail.flags !== constants.NODE_PERFORMANCE_GC_FLAGS_FORCED) continue;
              appendFileSync("forced.log", "${name}");
              resolve();
            }
          }).observe({ type: "gc" });
          Bun.gc(true);
          await promise;
          clearInterval(keepAlive);
        });
      `;
    const { output, exitCode, forcedLog } = await runTestFiles(
      { "a.test.js": file("a"), "b.test.js": file("b") },
      { flags: ["--isolate"] },
    );
    expect(output).toContain("(pass) a gets its own forced collection");
    expect(output).toContain("(pass) b gets its own forced collection");
    expect(forcedLog).toBe("ab");
    expect(exitCode).toBe(0);
  });

  // A debug build takes more than a second for each file under --isolate=modules, so it runs these rows under --isolate only.
  const isolateModes = isDebug ? ["--isolate"] : ["--isolate", "--isolate=modules"];

  // The next file observes from its first line on, and counts the forced collections that its first list with one has.
  const nextFile = (before: string) => `
    import { expect, test } from "bun:test";
    import { PerformanceObserver, constants } from "node:perf_hooks";

    const keepAlive = setInterval(() => {}, 1000);
    const { promise, resolve } = Promise.withResolvers();
    ${before}
    const observer = new PerformanceObserver(list => {
      const forced = list.getEntries().filter(entry => entry.detail.flags === constants.NODE_PERFORMANCE_GC_FLAGS_FORCED);
      if (forced.length > 0) resolve(forced.length);
    });
    observer.observe({ type: "gc" });
    Bun.gc(true);

    test("the next file gets its own forced collection only", async () => {
      expect(await promise).toBe(1);
      observer.disconnect();
      clearInterval(keepAlive);
    });
  `;

  concurrent.each(isolateModes)(
    "bun test %s: the next file gets no collection that a file leaves on its way to JS",
    async isolate => {
      const { output, exitCode } = await runTestFiles(
        {
          "a.test.js": `
            import { afterAll, test } from "bun:test";
            import { PerformanceObserver } from "node:perf_hooks";

            new PerformanceObserver(() => {}).observe({ type: "gc" });
            test("a", () => {});
            // Nothing in the file waits for these.
            afterAll(() => {
              Bun.gc(true);
              Bun.gc(true);
            });
          `,
          "b.test.js": nextFile(""),
        },
        { flags: [isolate] },
      );
      expect(output).toContain("(pass) the next file gets its own forced collection only");
      expect(exitCode).toBe(0);
    },
  );

  // --isolate=modules keeps the global object, and retires the realms that a file made.
  concurrent.each(isolateModes)(
    "bun test %s: no collection is timed for the observer that a file leaves connected in a ShadowRealm",
    async isolate => {
      const { output, exitCode } = await runTestFiles(
        {
          "a.test.js": `
            import { expect, test } from "bun:test";

            test("a", () => {
              globalThis.realmOfA = new ShadowRealm();
              const observes = globalThis.realmOfA.evaluate(\`
                const { PerformanceObserver } = process.getBuiltinModule("node:perf_hooks");
                new PerformanceObserver(() => {}).observe({ type: "gc" });
                true;
              \`);
              expect(observes).toBe(true);
            });
          `,
          "b.test.js": nextFile("Bun.gc(true); Bun.gc(true); Bun.gc(true);"),
        },
        { flags: [isolate] },
      );
      expect(output).toContain("(pass) the next file gets its own forced collection only");
      expect(exitCode).toBe(0);
    },
  );

  // Split in two: `bun test` looks for the name in the whole text of a test file, and this is one.
  const inTheEnvironmentOfThePackage = "@vitest" + "-environment happy-dom";

  // With --isolate, the package of a DOM environment is loaded once, into a realm that outlives the files. This package
  // only hands out the PerformanceObserver of that realm.
  concurrent(
    "bun test --isolate: an observer of the realm that outlives the files gets the collections of each file",
    async () => {
      const file = (name: string) => `
        // ${inTheEnvironmentOfThePackage}
        import { test } from "bun:test";
        import { constants } from "node:perf_hooks";

        test("${name} gets its forced collection", async () => {
          const keepAlive = setInterval(() => {}, 1000);
          const { promise, resolve } = Promise.withResolvers();
          // The file leaves it connected.
          new PerformanceObserverOfThePackage(list => {
            if (list.getEntries().some(entry => entry.detail.flags === constants.NODE_PERFORMANCE_GC_FLAGS_FORCED)) resolve();
          }).observe({ type: "gc" });
          Bun.gc(true);
          await promise;
          clearInterval(keepAlive);
        });
      `;
      const { output, exitCode } = await runTestFiles(
        {
          "node_modules/happy-dom/package.json": JSON.stringify({ name: "happy-dom", main: "index.js" }),
          "node_modules/happy-dom/index.js": `
            const { PerformanceObserver } = require("node:perf_hooks");
            exports.Window = class Window {
              constructor() {
                this.PerformanceObserverOfThePackage = PerformanceObserver;
                this.document = { body: {}, defaultView: this };
                this.location = { href: "about:blank" };
                this.matchMedia = undefined;
                this.happyDOM = { async abort() {} };
                this.close = () => {};
              }
            };
          `,
          "a.test.js": file("a"),
          "b.test.js": file("b"),
        },
        { flags: ["--isolate"] },
      );
      expect(output).toContain("(pass) a gets its forced collection");
      expect(output).toContain("(pass) b gets its forced collection");
      expect(exitCode).toBe(0);
    },
  );
});
