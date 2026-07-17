import { expect, test } from "bun:test";
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
