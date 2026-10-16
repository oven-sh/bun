import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, expectMaxObjectTypeCount, isDebug } from "harness";
import net from "net";
import perf, { monitorEventLoopDelay, PerformanceObserver, type PerformanceNodeEntry } from "perf_hooks";

test("stubs", () => {
  expect(perf.performance.nodeTiming).toBeObject();

  expect(perf.performance.now()).toBeNumber();
  expect(perf.performance.timeOrigin).toBeNumber();
  expect(perf.performance.eventLoopUtilization()).toBeObject();
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

// What each monitorEventLoopDelay() call returns is in test/js/bun/perf_hooks/histogram.test.ts,
// which also runs on node. These cases need Bun's APIs.
describe("monitorEventLoopDelay", () => {
  /** Yields to the timers until `condition()` is true. An enabled monitor adds a sample on every tick after its first. */
  async function until(condition: () => boolean) {
    const deadline = performance.now() + 2000;
    while (!condition() && performance.now() < deadline) await Bun.sleep(1);
  }
  /** Keeps the thread busy, so no timer runs. */
  function block(milliseconds: number) {
    for (const end = performance.now() + milliseconds; performance.now() < end; );
  }

  test("a tick that comes late is not followed by a short sample", async () => {
    const resolution = 20;
    const monitor = monitorEventLoopDelay({ resolution });
    // Both timers are overdue when the loop runs them, the slow one first: the monitor's first
    // tick comes 2 resolutions late.
    setTimeout(() => block(2 * resolution), 1);
    monitor.enable();
    block(resolution + 5);
    try {
      await until(() => monitor.count >= 2);
    } finally {
      monitor.disable();
    }
    expect(monitor.count).toBeGreaterThanOrEqual(2);
    // The next tick is a resolution after the late one. node counts from libuv's cached loop
    // time, which can be a resolution behind the late tick: its next tick then comes at once and
    // adds a sample near 0.
    expect(monitor.min).toBeGreaterThanOrEqual(0.9 * resolution * 1e6);
  });

  // At 1 ms the monitors tick until the GC sweeps them. At the largest resolution no tick comes.
  // Either way only the histogram's destructor takes the timer out of the heap.
  test.each([1, 2 ** 31 - 1])("an enabled monitor that nothing references is collected (%d ms)", async resolution => {
    const last = monitorEventLoopDelay({ resolution: 1 });
    Bun.gc(true);
    const baseline = heapStats().objectTypeCounts.RecordableHistogram ?? 0;

    const distinct = (() => {
      const monitors = Array.from({ length: 50 }, () => {
        const monitor = monitorEventLoopDelay({ resolution });
        monitor.enable();
        return monitor;
      });
      return new Set(monitors).size;
    })();
    expect(distinct).toBe(50);
    await expectMaxObjectTypeCount(expect, "RecordableHistogram", baseline + 5);

    // The timer heap is intact: a monitor enabled now still ticks.
    last.enable();
    try {
      await until(() => last.count >= 3);
      expect(last.count).toBeGreaterThanOrEqual(3);
    } finally {
      last.disable();
    }
  });

  describe("the Bun.ModuleGraph whose script enabled a monitor stops it", () => {
    test("when the graph is disposed, and the host's monitor goes on", async () => {
      const host = monitorEventLoopDelay({ resolution: 1 });
      const graph = new Bun.ModuleGraph();
      const inGraph = graph.run(() => {
        const monitor = monitorEventLoopDelay({ resolution: 1 });
        monitor.enable();
        return monitor;
      });
      host.enable();
      try {
        await until(() => host.count > 0 && inGraph.count > 0);
        expect(inGraph.count).toBeGreaterThan(0);

        graph.dispose();
        const stoppedAt = inGraph.count;
        const before = host.count;
        await until(() => host.count >= before + 5);
        expect({ host: host.count >= before + 5, inGraph: inGraph.count, inGraphDisable: inGraph.disable() }).toEqual({
          host: true,
          inGraph: stoppedAt,
          inGraphDisable: false,
        });
      } finally {
        host.disable();
        inGraph.disable();
        graph.dispose();
      }
    });

    test("not a monitor that the host enabled again after the graph", async () => {
      const graph = new Bun.ModuleGraph();
      const monitor = graph.run(() => {
        const monitor = monitorEventLoopDelay({ resolution: 1 });
        monitor.enable();
        return monitor;
      });
      try {
        expect([monitor.disable(), monitor.enable()]).toEqual([true, true]);
        graph.dispose();
        const before = monitor.count;
        await until(() => monitor.count >= before + 3);
        expect({ samples: monitor.count >= before + 3, disable: monitor.disable() }).toEqual({
          samples: true,
          disable: true,
        });
      } finally {
        monitor.disable();
        graph.dispose();
      }
    });

    test("also a monitor of the host's that the graph enabled again", async () => {
      const monitor = monitorEventLoopDelay({ resolution: 1 });
      const witness = monitorEventLoopDelay({ resolution: 1 });
      const graph = new Bun.ModuleGraph();
      try {
        expect([monitor.enable(), monitor.disable(), graph.run(() => monitor.enable())]).toEqual([true, true, true]);
        witness.enable();
        graph.dispose();
        const stoppedAt = monitor.count;
        const before = witness.count;
        await until(() => witness.count >= before + 5);
        expect({ witness: witness.count >= before + 5, count: monitor.count, disable: monitor.disable() }).toEqual({
          witness: true,
          count: stoppedAt,
          disable: false,
        });
      } finally {
        monitor.disable();
        witness.disable();
        graph.dispose();
      }
    });

    test("also a monitor that script of the disposed graph enables later", async () => {
      const witness = monitorEventLoopDelay({ resolution: 1 });
      const graph = new Bun.ModuleGraph();
      let late: ReturnType<typeof monitorEventLoopDelay> | undefined;
      let lateEnable: boolean | undefined;
      const { promise: gate, resolve } = Promise.withResolvers<void>();
      graph.run(() => {
        gate.then(() => {
          late = monitorEventLoopDelay({ resolution: 1 });
          lateEnable = late.enable();
        });
      });
      graph.dispose();
      resolve();
      witness.enable();
      try {
        await until(() => witness.count >= 5);
        expect({ witness: witness.count >= 5, lateEnable, count: late?.count, disable: late?.disable() }).toEqual({
          witness: true,
          lateEnable: true,
          count: 0,
          disable: false,
        });
      } finally {
        witness.disable();
        late?.disable();
      }
    });
  });

  test(
    "terminating a Worker with enabled monitors leaves the main thread's monitor running",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const { Worker } = require("node:worker_threads");
         const { monitorEventLoopDelay } = require("node:perf_hooks");
         const host = monitorEventLoopDelay({ resolution: 1 });
         host.enable();
         const worker = new Worker(
           \`const { parentPort } = require("node:worker_threads");
             const { monitorEventLoopDelay } = require("node:perf_hooks");
             const monitors = [1, 2, 3].map(resolution => monitorEventLoopDelay({ resolution }));
             for (const monitor of monitors) monitor.enable();
             const report = () => monitors.every(monitor => monitor.count > 0) ? parentPort.postMessage("sampling") : setTimeout(report, 1);
             report();\`,
           { eval: true },
         );
         worker.once("message", async () => {
           await worker.terminate();
           const before = host.count;
           const report = () => host.count >= before + 5 ? console.log("host still samples") : setTimeout(report, 1);
           report();
         });`,
        ],
        // The main thread's VM is destroyed too, so its enabled monitor goes through teardown as well.
        env: { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "host still samples\n", stderr: "", exitCode: 0 });
    },
    // A debug build takes seconds to start a Worker.
    isDebug ? 30_000 : 5_000,
  );

  test("a resolution above int32 is accepted, and enabled monitors do not keep the process alive", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { monitorEventLoopDelay } = require("node:perf_hooks");
         const far = [2 ** 31, 2 ** 32, 2 ** 32 + 1, Number.MAX_SAFE_INTEGER].map(resolution => monitorEventLoopDelay({ resolution }));
         const enabled = far.map(monitor => monitor.enable());
         const near = monitorEventLoopDelay({ resolution: 1 });
         near.enable();
         const report = () =>
           near.count >= 5
             ? console.log(JSON.stringify({ enabled, counts: far.map(monitor => monitor.count) }))
             : setTimeout(report, 1);
         report();`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: JSON.stringify({ enabled: [true, true, true, true], counts: [0, 0, 0, 0] }) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
