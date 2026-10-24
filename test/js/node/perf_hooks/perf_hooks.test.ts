import { estimateShallowMemoryUsageOf, heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, withoutAggressiveGC } from "harness";
import net from "net";
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
    } while (created < 2000 && heapStats().objectTypeCounts.Histogram > created / 2);
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
    } while (created < 2000 && heapStats().objectTypeCounts.Histogram > created / 2);
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
      } while (received < 2000 && heapStats().objectTypeCounts.Histogram > received / 2);
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
    "{   p: RecordableHistogram {     record: [Function: record],",
    "{   p: Histogram {     count: [Getter],",
    "{   p: ELDHistogram {     enable: [Function: enable],",
    "{   p: Histogram {     count: [Getter],",
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
