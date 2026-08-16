import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import net from "net";
import perf, { PerformanceObserver } from "perf_hooks";

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
  expect(() => performance.markResourceTiming()).not.toThrow();
});

// Node coerces the name via `${name}` for mark/clearMarks/clearMeasures, so a
// Symbol hits V8's ToString message. Verified against Node v26.3.0.
test("Symbol name argument throws V8 wording", () => {
  const msg = "Cannot convert a Symbol value to a string";
  expect(() => performance.mark(Symbol())).toThrow(new TypeError(msg));
  expect(() => performance.clearMarks(Symbol())).toThrow(new TypeError(msg));
  expect(() => performance.clearMeasures(Symbol())).toThrow(new TypeError(msg));
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
  const { promise, resolve } = Promise.withResolvers();
  const observer = new PerformanceObserver(list => resolve(list.getEntries()[0]));
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
  const { promise, resolve } = Promise.withResolvers();
  const observer = new PerformanceObserver(list => resolve(list.getEntries()[0]));
  observer.observe({ entryTypes: ["net"] });

  const server = net.createServer(c => c.end());
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
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

// performance.nodeTiming reports each startup phase in ms since timeOrigin
// (-1 until reached), and Node reserves the six milestone names in the User
// Timing API: mark()/clearMarks() reject them and measure() resolves them to
// nodeTiming's values. Behaviour verified against Node v26.3.0.
describe("nodeTiming milestones", () => {
  const milestones = ["nodeStart", "v8Start", "environment", "bootstrapComplete", "loopStart", "loopExit"] as const;

  function thrown(fn: () => unknown) {
    try {
      fn();
    } catch (e: any) {
      return { isTypeError: e instanceof TypeError, code: e.code, message: e.message };
    }
    return "did not throw";
  }

  test("nodeTiming has Node's shape and its values are offsets from timeOrigin", () => {
    const nodeTiming = perf.performance.nodeTiming;
    expect(nodeTiming).toBeInstanceOf(PerformanceEntry);
    expect(Object.keys(nodeTiming)).toEqual([
      "name",
      "entryType",
      "startTime",
      "duration",
      "nodeStart",
      "v8Start",
      "environment",
      "loopStart",
      "loopExit",
      "bootstrapComplete",
      "idleTime",
    ]);
    for (const name of milestones) {
      expect(Object.getOwnPropertyDescriptor(nodeTiming, name)).toEqual({
        get: expect.any(Function),
        set: undefined,
        enumerable: true,
        configurable: true,
      });
    }

    const { nodeStart, v8Start, environment, bootstrapComplete, loopStart } = nodeTiming;
    expect(nodeStart).toBeGreaterThanOrEqual(0);
    expect(v8Start).toBeGreaterThan(nodeStart);
    expect(environment).toBeGreaterThan(v8Start);
    expect(bootstrapComplete).toBeGreaterThan(environment);
    expect(bootstrapComplete).toBeLessThanOrEqual(performance.now());
    // The test runner entered the event loop before running this test body,
    // and will not leave it until the file is done.
    expect(loopStart).toBeGreaterThanOrEqual(0);
    expect(nodeTiming.toJSON()).toEqual({
      name: "node",
      entryType: "node",
      startTime: 0,
      duration: expect.any(Number),
      nodeStart,
      v8Start,
      bootstrapComplete,
      environment,
      loopStart,
      loopExit: -1,
      idleTime: 0,
    });
    expect(nodeTiming.duration).toBeLessThanOrEqual(performance.now());
  });

  test("measure() resolves the milestone names to nodeTiming's values", () => {
    const nodeTiming = perf.performance.nodeTiming;
    const timing = (entry: PerformanceMeasure) => ({ startTime: entry.startTime, duration: entry.duration });

    // Like Node, an unreached milestone (loopExit) resolves to -1 rather than throwing.
    for (const name of milestones) {
      expect(performance.measure(`since ${name}`, name).startTime).toBe(nodeTiming[name]);
    }
    expect(timing(performance.measure("boot", "nodeStart", "bootstrapComplete"))).toEqual({
      startTime: nodeTiming.nodeStart,
      duration: nodeTiming.bootstrapComplete - nodeTiming.nodeStart,
    });
    expect(timing(performance.measure("jsc", { start: "v8Start", end: "environment" }))).toEqual({
      startTime: nodeTiming.v8Start,
      duration: nodeTiming.environment - nodeTiming.v8Start,
    });
    expect(timing(performance.measure("until bootstrap", undefined, "bootstrapComplete"))).toEqual({
      startTime: 0,
      duration: nodeTiming.bootstrapComplete,
    });
    const fromStart = performance.measure("after nodeStart", { start: "nodeStart", duration: 5 });
    expect(fromStart.startTime).toBe(nodeTiming.nodeStart);
    expect(fromStart.duration).toBeCloseTo(5, 6);
    const untilEnd = performance.measure("before bootstrap", { end: "bootstrapComplete", duration: 5 });
    expect(untilEnd.startTime).toBe(nodeTiming.bootstrapComplete - 5);
    expect(untilEnd.duration).toBeCloseTo(5, 6);

    // Only marks are looked up this way: a measure may be named after a
    // milestone, and unknown mark names still throw.
    expect(performance.measure("nodeStart").entryType).toBe("measure");
    expect(() => performance.measure("m", "noSuchMark")).toThrow();
    expect(() => performance.measure("m", { start: "nodeStart", end: "noSuchMark" })).toThrow();
    performance.clearMeasures();
  });

  test("mark(), new PerformanceMark() and clearMarks() reject the milestone names", () => {
    for (const name of milestones) {
      const expected = {
        isTypeError: true,
        code: "ERR_INVALID_ARG_VALUE",
        message: `The argument 'name' is invalid. Received '${name}'`,
      };
      expect(thrown(() => performance.mark(name))).toEqual(expected);
      expect(thrown(() => new PerformanceMark(name))).toEqual(expected);
      expect(thrown(() => performance.clearMarks(name))).toEqual(expected);
      expect(performance.getEntriesByName(name, "mark")).toEqual([]);
    }
    // Only the six milestones are reserved; other nodeTiming property names are ordinary marks.
    expect(performance.mark("idleTime").entryType).toBe("mark");
    performance.clearMarks("idleTime");
    expect(performance.getEntriesByName("idleTime", "mark")).toEqual([]);
  });

  test.concurrent("loopStart and loopExit follow the main script's lifecycle", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { performance } = require("perf_hooks");
         const nodeTiming = performance.nodeTiming;
         const seen = { topLevel: { loopStart: nodeTiming.loopStart, loopExit: nodeTiming.loopExit } };
         setImmediate(() => {
           seen.inLoop = {
             loopStartAfterBootstrap: nodeTiming.loopStart >= nodeTiming.bootstrapComplete,
             measureStartsAtLoopStart: performance.measure("loop", "loopStart").startTime === nodeTiming.loopStart,
             loopExit: nodeTiming.loopExit,
           };
         });
         process.on("beforeExit", () => {
           seen.beforeExit = { loopExit: nodeTiming.loopExit };
         });
         process.on("exit", () => {
           seen.exit = {
             loopExitAfterLoopStart: nodeTiming.loopExit >= nodeTiming.loopStart,
             measureStartsAtLoopExit: performance.measure("exit", "loopExit").startTime === nodeTiming.loopExit,
           };
           console.log(JSON.stringify(seen));
         });`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      topLevel: { loopStart: -1, loopExit: -1 },
      inLoop: { loopStartAfterBootstrap: true, measureStartsAtLoopStart: true, loopExit: -1 },
      beforeExit: { loopExit: -1 },
      exit: { loopExitAfterLoopStart: true, measureStartsAtLoopExit: true },
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("process.exit() does not count as the loop exiting", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { performance } = require("perf_hooks");
         process.on("exit", () => console.log(performance.nodeTiming.loopStart >= 0, performance.nodeTiming.loopExit));
         setImmediate(() => process.exit(0));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("true -1\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("a script with no async work still gets loopStart and loopExit", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { nodeTiming } = require("perf_hooks").performance;
         process.on("beforeExit", () => console.log("beforeExit", nodeTiming.loopStart >= nodeTiming.bootstrapComplete, nodeTiming.loopExit));
         process.on("exit", () => console.log("exit", nodeTiming.loopExit >= nodeTiming.loopStart));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("beforeExit true -1\nexit true\n");
    expect(exitCode).toBe(0);
  });

  // Workers boot through the same VM setup, so a worker's performance object
  // gets a complete set of milestones of its own.
  test.concurrent("worker threads report their own startup milestones", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { Worker } = require("worker_threads");
         const worker = new Worker(
           \`const { parentPort } = require("worker_threads");
            const { performance } = require("perf_hooks");
            const { nodeStart, v8Start, environment, bootstrapComplete } = performance.nodeTiming;
            let markRejected;
            try { performance.mark("nodeStart"); } catch (e) { markRejected = e.code; }
            parentPort.postMessage({
              ordered: 0 <= nodeStart && nodeStart < v8Start && v8Start < environment && environment < bootstrapComplete,
              bootMeasure: performance.measure("boot", "nodeStart", "bootstrapComplete").duration === bootstrapComplete - nodeStart,
              markRejected,
            });\`,
           { eval: true },
         );
         worker.on("message", message => console.log(JSON.stringify(message)));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ ordered: true, bootMeasure: true, markRejected: "ERR_INVALID_ARG_VALUE" });
    expect(exitCode).toBe(0);
  });
});
