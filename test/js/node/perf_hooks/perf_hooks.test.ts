import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import net from "net";
import perf, { PerformanceMark, PerformanceObserver } from "perf_hooks";

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

// performance.mark / performance.measure argument-validation contract, verified
// against Node v26.3.0 (lib/internal/perf/usertiming.js).
describe("User Timing argument validation", () => {
  function caught(fn: () => unknown) {
    try {
      fn();
    } catch (e: any) {
      return { name: e.name, code: e.code, constructor: e.constructor.name, message: e.message };
    }
    throw new Error("did not throw");
  }

  test("performance.mark rejects nodeTiming milestone names with ERR_INVALID_ARG_VALUE", () => {
    for (const name of ["nodeStart", "v8Start", "environment", "loopStart", "loopExit", "bootstrapComplete"]) {
      expect(caught(() => performance.mark(name))).toEqual({
        name: "TypeError",
        code: "ERR_INVALID_ARG_VALUE",
        constructor: "TypeError",
        message: `The argument 'name' is invalid. Received '${name}'`,
      });
    }
    // Not reserved in Node v26 despite being nodeTiming properties.
    expect(() => performance.mark("idleTime")).not.toThrow();
    expect(() => performance.mark("uvMetricsInfo")).not.toThrow();
    expect(performance.getEntriesByName("nodeStart", "mark").length).toBe(0);
    performance.clearMarks();
  });

  test("new PerformanceMark rejects nodeTiming milestone names with ERR_INVALID_ARG_VALUE", () => {
    expect(caught(() => new PerformanceMark("nodeStart"))).toEqual({
      name: "TypeError",
      code: "ERR_INVALID_ARG_VALUE",
      constructor: "TypeError",
      message: "The argument 'name' is invalid. Received 'nodeStart'",
    });
  });

  test("performance.mark startTime must be a number (ERR_INVALID_ARG_TYPE)", () => {
    expect(caught(() => performance.mark("x", { startTime: "7" }))).toEqual({
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
      constructor: "TypeError",
      message: `The "startTime" argument must be of type number. Received type string ('7')`,
    });
    expect(caught(() => new PerformanceMark("x", { startTime: "7" }))).toMatchObject({ code: "ERR_INVALID_ARG_TYPE" });
    // Node: options.startTime ?? now(), so null means "use now()".
    expect(performance.mark("x", { startTime: null }).startTime).toBeGreaterThan(0);
    performance.clearMarks("x");
  });

  test("performance.mark negative startTime throws ERR_PERFORMANCE_INVALID_TIMESTAMP", () => {
    for (const fn of [
      () => performance.mark("x", { startTime: -1 }),
      () => new PerformanceMark("x", { startTime: -1 }),
    ]) {
      expect(caught(fn)).toEqual({
        name: "TypeError",
        code: "ERR_PERFORMANCE_INVALID_TIMESTAMP",
        constructor: "TypeError",
        message: "-1 is not a valid timestamp",
      });
    }
  });

  test("performance.measure start+end+duration throws ERR_PERFORMANCE_MEASURE_INVALID_OPTIONS", () => {
    expect(caught(() => performance.measure("m", { start: 1, end: 2, duration: 1 }))).toEqual({
      name: "TypeError",
      code: "ERR_PERFORMANCE_MEASURE_INVALID_OPTIONS",
      constructor: "TypeError",
      message: "Must not have options.start, options.end, and options.duration specified",
    });
  });

  test("performance.measure options with trailing endMark throws ERR_PERFORMANCE_MEASURE_INVALID_OPTIONS", () => {
    expect(caught(() => performance.measure("m", { start: 1, end: 2 }, "endMark"))).toEqual({
      name: "TypeError",
      code: "ERR_PERFORMANCE_MEASURE_INVALID_OPTIONS",
      constructor: "TypeError",
      message: "endMark must not be specified",
    });
  });

  test("performance.measure negative start/end/duration throws ERR_PERFORMANCE_INVALID_TIMESTAMP", () => {
    for (const opts of [{ start: -1 }, { end: -1 }, { start: 1, duration: -1 }]) {
      expect(caught(() => performance.measure("m", opts))).toEqual({
        name: "TypeError",
        code: "ERR_PERFORMANCE_INVALID_TIMESTAMP",
        constructor: "TypeError",
        message: "-1 is not a valid timestamp",
      });
    }
  });

  test("performance.measure with unknown mark throws a DOMException SyntaxError", () => {
    for (const fn of [
      () => performance.measure("m", "unknownMark"),
      () => performance.measure("m", { start: "unknownMark" }),
    ]) {
      expect(caught(fn)).toEqual({
        name: "SyntaxError",
        code: 12,
        constructor: "DOMException",
        message: 'The "unknownMark" performance mark has not been set',
      });
    }
  });
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
