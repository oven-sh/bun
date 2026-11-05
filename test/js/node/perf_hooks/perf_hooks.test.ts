import * as internalForTesting from "bun:internal-for-testing";
import { estimateShallowMemoryUsageOf, heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, withoutAggressiveGC } from "harness";
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
  // Each script runs in a process of its own and counts the collections of that process. A collection keeps no event
  // loop alive, so a script holds an interval until it has the entries it waits for. Bun also collects by itself (once
  // the entry point has loaded, and more often under BUN_GARBAGE_COLLECTOR_LEVEL), so a script tells the collections
  // it asks for by their flag.
  const prelude = `
    const { PerformanceObserver, constants } = require("node:perf_hooks");
    const keepAlive = setInterval(() => {}, 1000);
    const isForced = entry => entry.detail.flags === constants.NODE_PERFORMANCE_GC_FLAGS_FORCED;
    const finish = result => {
      clearInterval(keepAlive);
      console.log(JSON.stringify(result));
    };
  `;

  // A test that has timed out cannot end its script, which holds an interval. So each script has its own limit.
  const limit = { timeout: 4_000, killSignal: "SIGKILL" } as const;

  async function run(
    script: string,
    { flags = [], env = {} }: { flags?: string[]; env?: Record<string, string> } = {},
  ) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...flags, "-e", prelude + script],
      env: { ...bunEnv, ...env },
      stdout: "pipe",
      stderr: "pipe",
      ...limit,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    return { result: stdout && JSON.parse(stdout), exitCode };
  }

  // Observes from here on and reports how many forced collections the first list with one has, after one of its own.
  const countForcedFromNowOn = `
    const counting = new PerformanceObserver(list => {
      const forced = list.getEntries().filter(isForced).length;
      if (forced === 0) return;
      counting.disconnect();
      finish({ forced });
    });
    counting.observe({ type: "gc" });
    Bun.gc(true);
  `;

  test.concurrent("an entry has the shape and the times of Node's", async () => {
    const { result, exitCode } = await run(`
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
            // The collection started and ended inside Bun.gc(true). The start is put on the timeline of
            // performance.now() when the entry reaches JS, from two clocks that are read one after the other.
            startsInsideTheCall: entry.startTime >= before - 100 && entry.startTime <= after,
            lastsNoLongerThanTheCall: entry.duration >= 0 && entry.duration <= after - before + 1,
          });
        }).observe(options);
      }
      before = performance.now();
      Bun.gc(true);
      after = performance.now();
    `);
    const { startTime, duration } = result;
    expect(result).toEqual({
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
      startsInsideTheCall: true,
      lastsNoLongerThanTheCall: true,
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("only the collections that gc() and Bun.gc(true) force have the forced flag", async () => {
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
          inOrder: entries.every((entry, i) => i === 0 || entries[i - 1].startTime <= entry.startTime),
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
      inOrder: true,
      allOfTheType: true,
      allOfTheName: true,
    });
    expect(exitCode).toBe(0);
  });

  // With BUN_JSC_collectContinuously, other collections start and end inside the call that forces one.
  test.concurrent("a forced collection has the flag when other collections end inside the same call", async () => {
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
      for (let i = 0; i < 100; i++) Bun.gc(true);
    `,
      { env: { BUN_JSC_collectContinuously: "1" } },
    );
    expect(result).toEqual({ forced: 100, forcedMinor: 0 });
    expect(exitCode).toBe(0);
  });

  // With BUN_GARBAGE_COLLECTOR_LEVEL=2, Bun collects synchronously by itself each time it has handled a rejection.
  test.concurrent("a collection that Bun makes by itself is not the one that a later call forces", async () => {
    const { result, exitCode } = await run(
      `
      let handled = 0;
      const observer = new PerformanceObserver(list => {
        const entries = list.getEntries();
        observer.disconnect();
        finish({ entries: entries.length > 0, forced: entries.filter(isForced).length });
      });
      observer.observe({ type: "gc" });
      process.on("unhandledRejection", () => {
        if (++handled !== 2) return;
        // Bun's own collection is on its way to JS. Nothing observes the one that is forced here.
        observer.disconnect();
        Bun.gc(true);
        observer.observe({ type: "gc" });
      });
      Promise.reject(new Error("one"));
      Promise.reject(new Error("two"));
    `,
      { env: { BUN_GARBAGE_COLLECTOR_LEVEL: "2" } },
    );
    expect(result).toEqual({ entries: true, forced: 0 });
    expect(exitCode).toBe(0);
  });

  test.concurrent("a forced entry lasts until the call that forces the collection returns", async () => {
    // As in Node v26.3.0. What the collection frees is swept before the call returns, and that takes most of the call.
    const { result, exitCode } = await run(`
      const text = "[" + Buffer.alloc(300000 * 9, '"string",').toString() + '""]';
      const calls = [];
      new PerformanceObserver((list, observer) => {
        const forced = list.getEntries().filter(isForced);
        if (forced.length === 0) return;
        observer.disconnect();
        const endWithTheCall = forced.filter((entry, i) => {
          const { before, after } = calls[i];
          return after - (entry.startTime + entry.duration) < (after - before) / 4;
        });
        // A thread that loses the CPU between the end of the entry and the next line makes one call look longer.
        finish({ forced: forced.length, mostEndWithTheCall: endWithTheCall.length >= 2 });
      }).observe({ type: "gc" });
      for (let i = 0; i < 3; i++) {
        let garbage = JSON.parse(text);
        garbage = undefined;
        const before = performance.now();
        Bun.gc(true);
        calls.push({ before, after: performance.now() });
      }
    `);
    expect(result).toEqual({ forced: 3, mostEndWithTheCall: true });
    expect(exitCode).toBe(0);
  });

  test.concurrent("no collection is timed while nothing observes gc", async () => {
    const { result, exitCode } = await run(`
      const observer = new PerformanceObserver(() => {});
      observer.observe({ type: "gc" });
      observer.disconnect();
      Bun.gc(true);
      Bun.gc(true);
      Bun.gc(true);
      ${countForcedFromNowOn}
    `);
    expect(result).toEqual({ forced: 1 });
    expect(exitCode).toBe(0);
  });

  test.concurrent("no collection is timed after observe({ entryTypes }) takes gc from the last observer", async () => {
    const { result, exitCode } = await run(`
      const observer = new PerformanceObserver(() => {});
      observer.observe({ entryTypes: ["gc", "function"] });
      observer.observe({ entryTypes: ["function"] });
      Bun.gc(true);
      Bun.gc(true);
      Bun.gc(true);
      ${countForcedFromNowOn}
      observer.disconnect();
    `);
    expect(result).toEqual({ forced: 1 });
    expect(exitCode).toBe(0);
  });

  // Nothing calls disconnect() for the observer of a disposed graph: the registry drops it when it next has an entry for it.
  test.concurrent.each([
    ["a function entry", `performance.timerify(function produced() {})(); start();`],
    ["a gc entry", `Bun.gc(true); setImmediate(start);`],
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

  test.concurrent("no collection is timed once the realm of the last observer is collected", async () => {
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
        // The record of that collection reaches JS first: nothing is left to call, so the heap is let go.
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

  test.concurrent("the observers that exist when an entry reaches JS get it", async () => {
    // Node v26.3.0 prints the same: the entry is for whoever observes when it is handed over, and between the two
    // observers here nothing observes.
    const { result, exitCode } = await run(`
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
      Bun.gc(true);
      left.disconnect();
      came.observe({ type: "gc" });
    `);
    expect(result).toEqual({ left: 0, came: 1 });
    expect(exitCode).toBe(0);
  });

  // No interval here. Node v26.3.0 prints the same for each: the entries are never delivered, an unref'd immediate
  // does not run, and "beforeExit" is emitted once.
  test.concurrent.each([
    ["alone", "", ""],
    ["beside an unref'd immediate", "", `setImmediate(() => { ranUnrefd = true; }).unref();`],
    ["beside a cleared immediate", "", `clearImmediate(setImmediate(() => {}));`],
    [
      "in an unref'd immediate that queues itself again",
      "",
      `(function again() { Bun.gc(true); setImmediate(() => { ranUnrefd = true; again(); }).unref(); })();`,
    ],
    // The cleanup of a FinalizationRegistry is a task that the collection itself queues, and it holds the loop until it ran.
    [
      "with a cleanup for a FinalizationRegistry, beside an unref'd immediate",
      `const registry = new FinalizationRegistry(() => {}); (() => { registry.register({}, 0); })();`,
      `setImmediate(() => { ranUnrefd = true; }).unref();`,
    ],
  ])("a collection %s does not keep the event loop alive", async (_, before, after) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { PerformanceObserver } = require("node:perf_hooks");
         let delivered = 0;
         let beforeExit = 0;
         let ranUnrefd = false;
         new PerformanceObserver(list => {
           delivered += list.getEntries().length;
         }).observe({ type: "gc" });
         ${before}
         Bun.gc(true);
         ${after}
         process.on("beforeExit", () => {
           beforeExit++;
           for (let i = 0; i < 20; i++) Bun.gc(true);
         });
         process.on("exit", () => console.log(JSON.stringify({ delivered, beforeExit, ranUnrefd })));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      ...limit,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect({ printed: stdout && JSON.parse(stdout), signalCode: proc.signalCode }).toEqual({
      printed: { delivered: 0, beforeExit: 1, ranUnrefd: false },
      signalCode: null,
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("a Worker's observer gets the collections of the Worker only", async () => {
    const { result, exitCode } = await run(`
      const { Worker } = require("node:worker_threads");
      // The Worker ends with its observer connected.
      const worker = new Worker(
        \`const { parentPort } = require("node:worker_threads");
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
           Bun.gc(true);
           Bun.gc(true);
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
        Bun.gc(true);
        Bun.gc(true);
        Bun.gc(true);
        worker.postMessage("go");
      });
      worker.on("exit", code => {
        workerExitCode = code;
        done();
      });
    `);
    expect(result).toEqual({ forcedHere: 3, forcedInWorker: 2, workerExitCode: 0 });
    expect(exitCode).toBe(0);
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

  test.concurrent("an error from the code that takes an entry is reported, and the next entries arrive", async () => {
    const { result, exitCode } = await run(`
      let thrown = 0;
      let delivered = 0;
      const uncaught = [];
      process.on("uncaughtException", error => uncaught.push(error.message));
      new PerformanceObserver((list, observer) => {
        delivered += list.getEntries().filter(isForced).length;
        observer.disconnect();
        finish({ thrownForEachEntry: thrown === uncaught.length && thrown >= 2, uncaught: [...new Set(uncaught)], delivered });
      }).observe({ type: "gc" });
      ${whenTheRegistryBuffersAGCEntry(`thrown++; throw new Error("thrown for a gc entry");`)}
      Bun.gc(true);
      Bun.gc(true);
      // The first turn hands those over. The next collection is for the restored push.
      setImmediate(() => {
        Array.prototype.push = push;
        Bun.gc(true);
      });
    `);
    expect(result).toEqual({ thrownForEachEntry: true, uncaught: ["thrown for a gc entry"], delivered: 1 });
    expect(exitCode).toBe(0);
  });

  test.concurrent.each([
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

  test.concurrent("v8.GCProfiler reports the same collections beside a gc observer", async () => {
    const { result, exitCode } = await run(`
      const profiler = new (require("node:v8").GCProfiler)();
      profiler.start();
      new PerformanceObserver((list, observer) => {
        const forced = list.getEntries().filter(isForced);
        if (forced.length === 0) return;
        observer.disconnect();
        const major = profiler.stop().statistics.filter(statistic => statistic.gcType === "MarkSweepCompact");
        finish({ forced: forced.length, profiledAtLeastAsMany: major.length >= forced.length });
      }).observe({ type: "gc" });
      Bun.gc(true);
      Bun.gc(true);
    `);
    expect(result).toEqual({ forced: 2, profiledAtLeastAsMany: true });
    expect(exitCode).toBe(0);
  });

  // An idle collection is asked for after BUN_IDLE_GC_SECONDS of quiet. The JS thread then waits without heap access, so
  // on a machine that is not busy the collector thread ends the collection. On Windows the JS thread always ends it.
  test.concurrent.skipIf(isWindows)(
    "an idle collection reaches the observers of a program that waits",
    async () => {
      using dir = tempDir("perf-hooks-gc-idle", {
        "waits.cjs": `
          const { PerformanceObserver, constants } = require("node:perf_hooks");
          // Enough live objects that the marking is not over in the pause that starts the collection.
          const live = [];
          for (let i = 0; i < 100000; i++) live.push({ i, text: "x" + i, tags: ["a" + i, "b" + i] });
          const giveUp = setTimeout(() => console.log(JSON.stringify({ gaveUp: true })), 15000);
          let waitsSince = Infinity;
          new PerformanceObserver((list, observer) => {
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
      await using proc = Bun.spawn({
        cmd: [bunExe(), "waits.cjs"],
        env: {
          ...bunEnv,
          BUN_IDLE_GC_SECONDS: "1",
          BUN_GC_TIMER_INTERVAL: "250",
          BUN_GC_TIMER_DISABLE: undefined,
          BUN_GC_RUNS_UNTIL_SKIP_RELEASE_ACCESS: "0",
        },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
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

  const attempt = (...calls: object[]) => {
    const observer = new PerformanceObserver(() => {});
    try {
      for (const options of calls) observer.observe(options);
      return "no throw";
    } catch (error) {
      return (error as Error).name;
    } finally {
      observer.disconnect();
    }
  };

  // The native class makes these checks, as it did while "gc" was a type without entries. Node v26.3.0 throws the same.
  test("observe() takes `type` or `entryTypes` with gc, and does not change from one to the other", () => {
    expect({
      "entryTypes:[mark] -> type:gc": attempt({ entryTypes: ["mark"] }, { type: "gc" }),
      "type:mark -> entryTypes:[gc]": attempt({ type: "mark" }, { entryTypes: ["gc"] }),
      "{entryTypes:[gc], type:gc}": attempt({ entryTypes: ["gc"], type: "gc" }),
      "entryTypes:[mark,gc] -> type:gc": attempt({ entryTypes: ["mark", "gc"] }, { type: "gc" }),
      "{entryTypes:[gc], type:mark}": attempt({ entryTypes: ["gc"], type: "mark" }),
      "type:mark -> entryTypes:[mark,gc]": attempt({ type: "mark" }, { entryTypes: ["mark", "gc"] }),
      "entryTypes:[mark,gc] -> type:mark": attempt({ entryTypes: ["mark", "gc"] }, { type: "mark" }),
      "{entryTypes:[mark], type:gc}": attempt({ entryTypes: ["mark"], type: "gc" }),
      "{entryTypes:[mark,gc], type:mark}": attempt({ entryTypes: ["mark", "gc"], type: "mark" }),
    }).toEqual({
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
      expect(PerformanceObserver.supportedEntryTypes).toContain("gc");
    } finally {
      observer.disconnect();
      performance.clearMarks("observed after the throw");
    }
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
  async function runTestFiles(files: Record<string, string>, ...flags: string[]) {
    using dir = tempDir("perf-hooks-gc-bun-test", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...flags, ...Object.keys(files).filter(name => name.endsWith(".test.js"))],
      env: { ...bunEnv, NODE_PATH: undefined },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const log = Bun.file(join(String(dir), "forced.log"));
    return { output: stdout + stderr, exitCode, forcedLog: (await log.exists()) ? await log.text() : "" };
  }

  // `bun test` runs on after an error that nothing handles, and its event loop no longer counts as alive then.
  const throwsWhereNothingHandlesIt = `
    test("throws where nothing handles it", async () => {
      const { promise, resolve } = Promise.withResolvers();
      setTimeout(() => {
        resolve();
        throw new Error("unhandled on purpose");
      }, 1);
      await promise;
    });
  `;

  test.concurrent(
    "bun test delivers entries after an unhandled error",
    async () => {
      const { output, exitCode } = await runTestFiles({
        "gc-after-error.test.js": `
          import { test } from "bun:test";
          import { PerformanceObserver, constants } from "node:perf_hooks";
          ${throwsWhereNothingHandlesIt}
          test("gets a gc entry afterwards", async () => {
            const keepAlive = setInterval(() => {}, 1000);
            const { promise, resolve } = Promise.withResolvers();
            const observer = new PerformanceObserver(list => {
              if (list.getEntries().some(entry => entry.detail.flags === constants.NODE_PERFORMANCE_GC_FLAGS_FORCED)) resolve();
            });
            observer.observe({ type: "gc" });
            Bun.gc(true);
            await promise;
            observer.disconnect();
            clearInterval(keepAlive);
          });
        `,
      });
      expect(output).toContain("unhandled on purpose");
      expect(output).toContain("(pass) gets a gc entry afterwards");
      expect(exitCode).toBe(1);
    },
    30_000,
  );

  // An unref'd immediate asks what the hand-off of a gc entry asks: does something else keep the loop alive?
  test.concurrent(
    "bun test runs an unref'd immediate after an unhandled error",
    async () => {
      const { output, exitCode } = await runTestFiles({
        "unrefd-after-error.test.js": `
          import { test } from "bun:test";
          ${throwsWhereNothingHandlesIt}
          test("an unref'd immediate runs afterwards", async () => {
            const keepAlive = setInterval(() => {}, 1000);
            const { promise, resolve } = Promise.withResolvers();
            setImmediate(resolve).unref();
            await promise;
            clearInterval(keepAlive);
          });
        `,
      });
      expect(output).toContain("unhandled on purpose");
      expect(output).toContain("(pass) an unref'd immediate runs afterwards");
      expect(exitCode).toBe(1);
    },
    30_000,
  );

  // --isolate gives each file a global object of its own, and nothing disconnects the observers of a finished file.
  test.concurrent(
    "bun test --isolate: an observer that a file leaves connected gets nothing of the next file",
    async () => {
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
        "--isolate",
      );
      expect(output).toContain("(pass) a gets its own forced collection");
      expect(output).toContain("(pass) b gets its own forced collection");
      expect(forcedLog).toBe("ab");
      expect(exitCode).toBe(0);
    },
    30_000,
  );

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

  test.concurrent(
    "bun test --isolate: the next file gets no collection that a file leaves on its way to JS",
    async () => {
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
        "--isolate",
      );
      expect(output).toContain("(pass) the next file gets its own forced collection only");
      expect(exitCode).toBe(0);
    },
    30_000,
  );

  // --isolate=modules keeps the global object, and retires the realms that a file made.
  test.concurrent.each(["--isolate", "--isolate=modules"])(
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
        isolate,
      );
      expect(output).toContain("(pass) the next file gets its own forced collection only");
      expect(exitCode).toBe(0);
    },
    30_000,
  );

  // Split in two: `bun test` looks for the name in the whole text of a test file, and this is one.
  const inTheEnvironmentOfThePackage = "@vitest" + "-environment happy-dom";

  // With --isolate, the package of a DOM environment is loaded once, into a realm that outlives the files. This package
  // only hands out the PerformanceObserver of that realm.
  test.concurrent(
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
        "--isolate",
      );
      expect(output).toContain("(pass) a gets its forced collection");
      expect(output).toContain("(pass) b gets its forced collection");
      expect(exitCode).toBe(0);
    },
    30_000,
  );
});
