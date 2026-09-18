import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import inspector from "node:inspector";
import inspectorPromises from "node:inspector/promises";

// Mirrors how vitest's @vitest/coverage-v8 provider drives the inspector: a
// promise Session, Profiler.enable, startPreciseCoverage, evaluating modules
// through node:vm, then takePreciseCoverage.
const coverageVmFixture = `
import { Session } from "node:inspector/promises";
import vm from "node:vm";

const callCount = process.argv[2] === "true";
const detailed = process.argv[3] === "true";

const session = new Session();
session.connect();
await session.post("Profiler.enable");
await session.post("Profiler.startPreciseCoverage", { callCount, detailed });

const code = [
  "function add(a, b) {",
  "  return a + b;",
  "}",
  "function classify(n) {",
  "  if (n < 0) {",
  "    return 'negative';",
  "  }",
  "  return 'positive';",
  "}",
  "function neverCalled(x) {",
  "  return x * 2;",
  "}",
  "({ add, classify, neverCalled });",
].join("\\n");
const url = "file:///inspector-coverage-fixture/virtual.js";
const exported = vm.runInThisContext(code, { filename: url });
exported.add(1, 2);
exported.add(3, 4);
exported.add(5, 6);
exported.classify(1);
exported.classify(2);

const coverage = await session.post("Profiler.takePreciseCoverage");
await session.post("Profiler.stopPreciseCoverage");
await session.post("Profiler.disable");
session.disconnect();

const entry = coverage.result.find(script => script.url === url);
console.log(
  JSON.stringify({
    codeLength: code.length,
    timestampType: typeof coverage.timestamp,
    offsets: {
      addBody: code.indexOf("return a + b"),
      negativeReturn: code.indexOf("'negative'"),
      positiveReturn: code.indexOf("'positive'"),
      neverCalledBody: code.indexOf("x * 2"),
    },
    entry,
  }),
);
`;

const coverageImportFixture = `
import { Session } from "node:inspector/promises";

const session = new Session();
session.connect();
await session.post("Profiler.enable");
await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });

const { double } = await import("./covered-module.mjs");
double(2);
double(3);

const coverage = await session.post("Profiler.takePreciseCoverage");
await session.post("Profiler.stopPreciseCoverage");
session.disconnect();

const entry = coverage.result.find(script => script.url.endsWith("covered-module.mjs"));
console.log(
  JSON.stringify({
    url: entry?.url ?? null,
    functionCounts: entry ? entry.functions.map(f => f.ranges[0].count) : null,
  }),
);
`;

const coveredModuleFixture = `
export function double(x) {
  return x * 2;
}

export function neverCalled(x) {
  return x + 1;
}
`;

// The exported-declaration form makes JSC emit a zero-width basic block past
// the end of the function, and an empty vm script would get a zero-width
// whole-script range (issue #39821).
const zeroWidthRangeFixture = `
import { Session } from "node:inspector/promises";
import vm from "node:vm";

const session = new Session();
session.connect();
await session.post("Profiler.enable");
await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });

const { f } = await import("./exported-fn.mjs");
f(1);
vm.runInThisContext("", { filename: "file:///empty-script.js" });

const coverage = await session.post("Profiler.takePreciseCoverage");
await session.post("Profiler.stopPreciseCoverage");
session.disconnect();

const zeroWidth = [];
let rangeCount = 0;
for (const script of coverage.result) {
  for (const fn of script.functions) {
    for (const range of fn.ranges) {
      rangeCount++;
      if (range.startOffset >= range.endOffset) {
        zeroWidth.push({ url: script.url, ...range });
      }
    }
  }
}
const entry = coverage.result.find(script => script.url.endsWith("exported-fn.mjs"));
console.log(JSON.stringify({ rangeCount, zeroWidth, fixtureRanges: entry?.functions.length ?? 0 }));
`;

// Picks the entry whose primary range most tightly encloses the offset, the
// same way a coverage consumer attributes an AST node to a function.
function entryCoveringOffset(functions: any[], offset: number) {
  let best: any;
  for (const fn of functions) {
    const range = fn.ranges[0];
    if (range.startOffset <= offset && offset < range.endOffset) {
      if (
        !best ||
        range.startOffset > best.ranges[0].startOffset ||
        (range.startOffset === best.ranges[0].startOffset && range.endOffset < best.ranges[0].endOffset)
      ) {
        best = fn;
      }
    }
  }
  return best;
}

describe("node:inspector", () => {
  describe("Session", () => {
    let session: inspector.Session;

    beforeEach(() => {
      session = new inspector.Session();
    });

    afterEach(() => {
      try {
        session.disconnect();
      } catch {
        // Ignore if already disconnected
      }
    });

    test("Session is a constructor", () => {
      expect(inspector.Session).toBeInstanceOf(Function);
      expect(session).toBeInstanceOf(inspector.Session);
    });

    test("Session extends EventEmitter", () => {
      expect(typeof session.on).toBe("function");
      expect(typeof session.emit).toBe("function");
      expect(typeof session.removeListener).toBe("function");
    });

    test("connect() establishes connection", () => {
      expect(() => session.connect()).not.toThrow();
    });

    test("connect() throws if already connected", () => {
      session.connect();
      expect(() => session.connect()).toThrow("already connected");
    });

    test("connectToMainThread() throws ERR_INSPECTOR_NOT_WORKER on the main thread", () => {
      expect(() => session.connectToMainThread()).toThrow(
        expect.objectContaining({ code: "ERR_INSPECTOR_NOT_WORKER" }),
      );
    });

    test("disconnect() closes connection cleanly", () => {
      session.connect();
      expect(() => session.disconnect()).not.toThrow();
    });

    test("disconnect() is a no-op if not connected", () => {
      expect(() => session.disconnect()).not.toThrow();
    });

    test("post() throws if not connected", () => {
      expect(() => session.post("Profiler.enable")).toThrow("not connected");
    });

    test("post() with callback calls callback with error if not connected", async () => {
      const { promise, resolve, reject } = Promise.withResolvers<Error>();
      session.post("Profiler.enable", err => {
        if (err) resolve(err);
        else reject(new Error("Expected error"));
      });
      const error = await promise;
      expect(error.message).toContain("not connected");
    });
  });

  describe("Profiler", () => {
    let session: inspector.Session;

    beforeEach(() => {
      session = new inspector.Session();
      session.connect();
    });

    afterEach(() => {
      try {
        session.disconnect();
      } catch {
        // Ignore
      }
    });

    test("Profiler.enable succeeds", () => {
      const result = session.post("Profiler.enable");
      expect(result).toEqual({});
    });

    test("Profiler.disable succeeds", () => {
      session.post("Profiler.enable");
      const result = session.post("Profiler.disable");
      expect(result).toEqual({});
    });

    test("Profiler.start without enable throws", () => {
      expect(() => session.post("Profiler.start")).toThrow("not enabled");
    });

    test("Profiler.start after enable succeeds", () => {
      session.post("Profiler.enable");
      const result = session.post("Profiler.start");
      expect(result).toEqual({});
    });

    test("Profiler.stop without start throws", () => {
      session.post("Profiler.enable");
      expect(() => session.post("Profiler.stop")).toThrow("not started");
    });

    test("Profiler.stop returns valid profile", () => {
      session.post("Profiler.enable");
      session.post("Profiler.start");

      // Do some work to generate profile data
      let sum = 0;
      for (let i = 0; i < 10000; i++) {
        sum += Math.sqrt(i);
      }

      const result = session.post("Profiler.stop");

      expect(result).toHaveProperty("profile");
      const profile = result.profile;

      // Validate profile structure
      expect(profile).toHaveProperty("nodes");
      expect(profile).toHaveProperty("startTime");
      expect(profile).toHaveProperty("endTime");
      expect(profile).toHaveProperty("samples");
      expect(profile).toHaveProperty("timeDeltas");

      expect(profile.nodes).toBeArray();
      expect(profile.nodes.length).toBeGreaterThanOrEqual(1);

      // First node should be (root)
      const rootNode = profile.nodes[0];
      expect(rootNode).toHaveProperty("id", 1);
      expect(rootNode).toHaveProperty("callFrame");
      expect(rootNode.callFrame).toHaveProperty("functionName", "(root)");
      expect(rootNode.callFrame).toHaveProperty("scriptId", "0");
      expect(rootNode.callFrame).toHaveProperty("url", "");
      expect(rootNode.callFrame).toHaveProperty("lineNumber", -1);
      expect(rootNode.callFrame).toHaveProperty("columnNumber", -1);
    });

    test("complete enable->start->stop workflow", () => {
      // Enable profiler
      const enableResult = session.post("Profiler.enable");
      expect(enableResult).toEqual({});

      // Start profiling
      const startResult = session.post("Profiler.start");
      expect(startResult).toEqual({});

      // Do some work
      function fibonacci(n: number): number {
        if (n <= 1) return n;
        return fibonacci(n - 1) + fibonacci(n - 2);
      }
      fibonacci(20);

      // Stop profiling
      const stopResult = session.post("Profiler.stop");
      expect(stopResult).toHaveProperty("profile");

      // Disable profiler
      const disableResult = session.post("Profiler.disable");
      expect(disableResult).toEqual({});
    });

    test("samples and timeDeltas have same length", () => {
      session.post("Profiler.enable");
      session.post("Profiler.start");

      // Do some work
      let sum = 0;
      for (let i = 0; i < 5000; i++) {
        sum += Math.sqrt(i);
      }

      const result = session.post("Profiler.stop");
      const profile = result.profile;

      expect(profile.samples.length).toBe(profile.timeDeltas.length);
    });

    test("samples reference valid node IDs", () => {
      session.post("Profiler.enable");
      session.post("Profiler.start");

      // Do some work
      let sum = 0;
      for (let i = 0; i < 5000; i++) {
        sum += Math.sqrt(i);
      }

      const result = session.post("Profiler.stop");
      const profile = result.profile;

      const nodeIds = new Set(profile.nodes.map((n: any) => n.id));
      for (const sample of profile.samples) {
        expect(nodeIds.has(sample)).toBe(true);
      }
    });

    test("Profiler.setSamplingInterval works", () => {
      session.post("Profiler.enable");
      const result = session.post("Profiler.setSamplingInterval", { interval: 500 });
      expect(result).toEqual({});
    });

    test("Profiler.setSamplingInterval throws if profiler is running", () => {
      session.post("Profiler.enable");
      session.post("Profiler.start");
      expect(() => session.post("Profiler.setSamplingInterval", { interval: 500 })).toThrow(
        "Cannot change sampling interval while profiler is running",
      );
      session.post("Profiler.stop");
    });

    test("Profiler.setSamplingInterval requires positive interval", () => {
      session.post("Profiler.enable");
      expect(() => session.post("Profiler.setSamplingInterval", { interval: 0 })).toThrow();
      expect(() => session.post("Profiler.setSamplingInterval", { interval: -1 })).toThrow();
    });

    test("double Profiler.start is a no-op", () => {
      session.post("Profiler.enable");
      session.post("Profiler.start");
      const result = session.post("Profiler.start");
      expect(result).toEqual({});
      session.post("Profiler.stop");
    });

    test("profiler can be restarted after stop", () => {
      // First run
      session.post("Profiler.enable");
      session.post("Profiler.start");
      let sum = 0;
      for (let i = 0; i < 1000; i++) sum += i;
      const result1 = session.post("Profiler.stop");
      expect(result1).toHaveProperty("profile");

      // Second run
      session.post("Profiler.start");
      for (let i = 0; i < 1000; i++) sum += i;
      const result2 = session.post("Profiler.stop");
      expect(result2).toHaveProperty("profile");

      // Both profiles should be valid
      expect(result1.profile.nodes.length).toBeGreaterThanOrEqual(1);
      expect(result2.profile.nodes.length).toBeGreaterThanOrEqual(1);
    });

    test("disconnect() stops running profiler", () => {
      session.post("Profiler.enable");
      session.post("Profiler.start");
      session.disconnect();

      // Create new session and verify profiler was stopped
      const session2 = new inspector.Session();
      session2.connect();
      session2.post("Profiler.enable");

      // This should work without error (profiler is not running)
      const result = session2.post("Profiler.setSamplingInterval", { interval: 500 });
      expect(result).toEqual({});
      session2.disconnect();
    });
  });

  describe("callback API", () => {
    test("post() with callback receives result", async () => {
      const session = new inspector.Session();
      session.connect();

      const { promise, resolve } = Promise.withResolvers<any>();
      session.post("Profiler.enable", (err, result) => {
        resolve({ err, result });
      });

      const { err, result } = await promise;
      expect(err).toBeNull();
      expect(result).toEqual({});
      session.disconnect();
    });

    test("post() with callback receives error", async () => {
      const session = new inspector.Session();
      session.connect();

      const { promise, resolve } = Promise.withResolvers<any>();
      session.post("Profiler.start", (err, result) => {
        resolve({ err, result });
      });

      const { err, result } = await promise;
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain("not enabled");
      session.disconnect();
    });
  });

  describe("unsupported methods", () => {
    test("unsupported method throws ERR_INSPECTOR_COMMAND", () => {
      const session = new inspector.Session();
      session.connect();
      expect(() => session.post("Runtime.evaluate")).toThrow(
        expect.objectContaining({ code: "ERR_INSPECTOR_COMMAND" }),
      );
      session.disconnect();
    });
  });

  describe("precise coverage", () => {
    test("startPreciseCoverage requires Profiler.enable", () => {
      const session = new inspector.Session();
      session.connect();
      expect(() => session.post("Profiler.startPreciseCoverage")).toThrow("Profiler is not enabled");
      expect(() => session.post("Profiler.stopPreciseCoverage")).toThrow("Profiler is not enabled");
      session.disconnect();
    });

    test("takePreciseCoverage before startPreciseCoverage throws", () => {
      const session = new inspector.Session();
      session.connect();
      session.post("Profiler.enable");
      expect(() => session.post("Profiler.takePreciseCoverage")).toThrow("Precise coverage has not been started.");
      session.disconnect();
    });

    test("Profiler.disable stops precise coverage, like V8", () => {
      const session = new inspector.Session();
      session.connect();
      session.post("Profiler.enable");
      session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
      session.post("Profiler.disable");
      session.post("Profiler.enable");
      expect(() => session.post("Profiler.takePreciseCoverage")).toThrow("Precise coverage has not been started.");
      session.disconnect();
    });

    // Unlike V8 (which has always-on invocation counters), JSC has none, so
    // best-effort coverage is empty until startPreciseCoverage has run in the
    // process (once started, the profiler stays for the VM's lifetime).
    test("getBestEffortCoverage returns [] without a prior startPreciseCoverage", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const { Session } = require("node:inspector");
           const session = new Session();
           session.connect();
           console.log(JSON.stringify(session.post("Profiler.getBestEffortCoverage").result));`,
        ],
        env: bunEnv,
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout).toBe("[]\n");
      expect(exitCode).toBe(0);
    });

    // CDP contract: takePreciseCoverage resets execution counters, so a second
    // take reports the delta rather than the cumulative count.
    test.concurrent("takePreciseCoverage reports counts since the previous take", async () => {
      using dir = tempDir("inspector-coverage-delta", {
        "fixture.mjs": `
import { Session } from "node:inspector/promises";
import vm from "node:vm";
const session = new Session();
session.connect();
await session.post("Profiler.enable");
await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
const url = "file:///delta-fixture/virtual.js";
const f = vm.runInThisContext("function f(){return 1}; f", { filename: url });
f(); f(); f();
const first = await session.post("Profiler.takePreciseCoverage");
f();
const second = await session.post("Profiler.takePreciseCoverage");
await session.post("Profiler.stopPreciseCoverage");
session.disconnect();
const bodyOffset = "function f(){".length;
const countFor = c => {
  const entry = c.result.find(s => s.url === url);
  // Innermost function entry that covers the body of f().
  const fn = entry?.functions
    .filter(f => f.ranges[0].startOffset <= bodyOffset && bodyOffset < f.ranges[0].endOffset)
    .sort((a, b) => a.ranges[0].endOffset - b.ranges[0].endOffset)[0];
  return fn?.ranges[0].count;
};
console.log(JSON.stringify({ first: countFor(first), second: countFor(second) }));
`,
      });
      await using proc = Bun.spawn({ cmd: [bunExe(), "fixture.mjs"], env: bunEnv, cwd: String(dir), stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stderrIfFailed: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderrIfFailed: "", exitCode: 0 });
      expect(JSON.parse(stdout.trim())).toEqual({ first: 3, second: 1 });
    });

    // The VM's profiler outlives a stop, so a later start must re-base its
    // counters: executions between stop and the next start are not reported.
    test.concurrent("startPreciseCoverage after a stop counts from zero", async () => {
      using dir = tempDir("inspector-coverage-restart", {
        "fixture.mjs": `
import { Session } from "node:inspector/promises";
import vm from "node:vm";
const session = new Session();
session.connect();
await session.post("Profiler.enable");
await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
const url = "file:///restart-fixture/virtual.js";
const f = vm.runInThisContext("function f(){return 1}; f", { filename: url });
f();
await session.post("Profiler.takePreciseCoverage");
await session.post("Profiler.stopPreciseCoverage");
for (let i = 0; i < 100; i++) f();
await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
f(); f();
const after = await session.post("Profiler.takePreciseCoverage");
session.disconnect();
const bodyOffset = "function f(){".length;
const entry = after.result.find(s => s.url === url);
const fn = entry?.functions
  .filter(f => f.ranges[0].startOffset <= bodyOffset && bodyOffset < f.ranges[0].endOffset)
  .sort((a, b) => a.ranges[0].endOffset - b.ranges[0].endOffset)[0];
console.log(JSON.stringify({ count: fn?.ranges[0].count }));
`,
      });
      await using proc = Bun.spawn({ cmd: [bunExe(), "fixture.mjs"], env: bunEnv, cwd: String(dir), stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stderrIfFailed: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderrIfFailed: "", exitCode: 0 });
      expect(JSON.parse(stdout.trim())).toEqual({ count: 2 });
    });

    test.concurrent("collects block coverage with call counts for vm scripts", async () => {
      using dir = tempDir("inspector-coverage-vm", {
        "fixture.mjs": coverageVmFixture,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "fixture.mjs", "true", "true"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({ stderrIfFailed: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderrIfFailed: "", exitCode: 0 });
      const { codeLength, timestampType, offsets, entry } = JSON.parse(stdout);

      expect(timestampType).toBe("number");
      expect(entry).toBeDefined();
      expect(entry.scriptId).toBeString();

      // Whole-script entry spans the entire source and ran once.
      expect(entry.functions[0].isBlockCoverage).toBe(true);
      expect(entry.functions[0].ranges[0]).toEqual({ startOffset: 0, endOffset: codeLength, count: 1 });

      // add() was called 3 times.
      const addEntry = entryCoveringOffset(entry.functions, offsets.addBody);
      expect(addEntry.isBlockCoverage).toBe(true);
      expect(addEntry.ranges[0].count).toBe(3);

      // classify() was called twice and never took the negative branch, so a
      // block range with count 0 covers the untaken branch.
      const classifyEntry = entryCoveringOffset(entry.functions, offsets.positiveReturn);
      expect(classifyEntry.ranges[0].count).toBe(2);
      expect(
        classifyEntry.ranges.some(
          (range: any) =>
            range.count === 0 &&
            range.startOffset <= offsets.negativeReturn &&
            offsets.negativeReturn < range.endOffset,
        ),
      ).toBe(true);

      // neverCalled() reports a single function-granularity range with count 0.
      const neverCalledEntry = entryCoveringOffset(entry.functions, offsets.neverCalledBody);
      expect(neverCalledEntry).toEqual({
        functionName: "",
        isBlockCoverage: false,
        ranges: [{ startOffset: expect.any(Number), endOffset: expect.any(Number), count: 0 }],
      });
    });

    test.concurrent("respects callCount: false and detailed: false", async () => {
      using dir = tempDir("inspector-coverage-flags", {
        "fixture.mjs": coverageVmFixture,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "fixture.mjs", "false", "false"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({ stderrIfFailed: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderrIfFailed: "", exitCode: 0 });
      const { offsets, entry } = JSON.parse(stdout);

      expect(entry).toBeDefined();
      for (const fn of entry.functions) {
        expect(fn.isBlockCoverage).toBe(false);
        expect(fn.ranges).toHaveLength(1);
        expect([0, 1]).toContain(fn.ranges[0].count);
      }
      // Counts are clamped to 0/1 when callCount is false.
      expect(entryCoveringOffset(entry.functions, offsets.addBody).ranges[0].count).toBe(1);
      expect(entryCoveringOffset(entry.functions, offsets.neverCalledBody).ranges[0].count).toBe(0);
    });

    test.concurrent("collects coverage for modules imported after start", async () => {
      using dir = tempDir("inspector-coverage-import", {
        "fixture.mjs": coverageImportFixture,
        "covered-module.mjs": coveredModuleFixture,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "fixture.mjs"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({ stderrIfFailed: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderrIfFailed: "", exitCode: 0 });
      const { url, functionCounts } = JSON.parse(stdout);

      // Filesystem-backed scripts are reported with file:// URLs, like V8.
      expect(url).toStartWith("file://");
      expect(url).toEndWith("covered-module.mjs");
      // double() ran twice, neverCalled() never ran.
      expect(functionCounts).toContain(2);
      expect(functionCounts).toContain(0);
    });

    // V8 never emits startOffset === endOffset; @bcoe/v8-coverage (vitest/c8
    // --coverage) recurses forever on a zero-width range (issue #39821).
    test.concurrent("never emits zero-width ranges", async () => {
      using dir = tempDir("inspector-coverage-zero-width", {
        "fixture.mjs": zeroWidthRangeFixture,
        "exported-fn.mjs": "export function f(x){return x}\n",
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "fixture.mjs"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({ stderrIfFailed: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderrIfFailed: "", exitCode: 0 });
      const { rangeCount, zeroWidth, fixtureRanges } = JSON.parse(stdout);

      // The fixture module was reported and coverage was non-trivial.
      expect(fixtureRanges).toBeGreaterThan(0);
      expect(rangeCount).toBeGreaterThan(0);
      // Every range across every script satisfies startOffset < endOffset.
      expect(zeroWidth).toEqual([]);
    });
  });

  describe("exports", () => {
    test("url() returns undefined", () => {
      expect(inspector.url()).toBeUndefined();
    });

    test("console is exported", () => {
      expect(inspector.console).toBeObject();
      expect(inspector.console.log).toBe(globalThis.console.log);
    });

    // open()/close()/waitForDebugger() behavior is covered in inspector.test.ts;
    // opening a server is process-global state, so it is not exercised here.
    test("open(), close() and waitForDebugger() are functions", () => {
      expect(inspector.open).toBeInstanceOf(Function);
      expect(inspector.close).toBeInstanceOf(Function);
      expect(inspector.waitForDebugger).toBeInstanceOf(Function);
    });

    test("waitForDebugger() throws when the inspector is not active", () => {
      expect(() => inspector.waitForDebugger()).toThrow("Inspector is not active");
    });
  });
});

describe("node:inspector/promises", () => {
  test("Session is exported", () => {
    expect(inspectorPromises.Session).toBeInstanceOf(Function);
  });

  test("post() returns a Promise", async () => {
    const session = new inspectorPromises.Session();
    session.connect();

    const result = session.post("Profiler.enable");
    expect(result).toBeInstanceOf(Promise);

    await expect(result).resolves.toEqual({});
    session.disconnect();
  });

  test("post() rejects on error", async () => {
    const session = new inspectorPromises.Session();
    session.connect();

    await expect(session.post("Profiler.start")).rejects.toThrow("not enabled");
    session.disconnect();
  });

  test("complete profiling workflow with promises", async () => {
    const session = new inspectorPromises.Session();
    session.connect();

    await session.post("Profiler.enable");
    await session.post("Profiler.start");

    // Do some work
    function work(n: number): number {
      if (n <= 1) return n;
      return work(n - 1) + work(n - 2);
    }
    work(15);

    const result = await session.post("Profiler.stop");
    expect(result).toHaveProperty("profile");
    expect(result.profile.nodes).toBeArray();

    await session.post("Profiler.disable");
    session.disconnect();
  });

  test("other exports are the same as node:inspector", () => {
    expect(inspectorPromises.url).toBe(inspector.url);
    expect(inspectorPromises.console).toBe(inspector.console);
    expect(inspectorPromises.open).toBe(inspector.open);
    expect(inspectorPromises.close).toBe(inspector.close);
    expect(inspectorPromises.waitForDebugger).toBe(inspector.waitForDebugger);
  });
});

// Runtime.consoleAPICalled mirroring runs in a subprocess so its console
// hooks do not interfere with the test runner's own console, and so assertion
// output is not interleaved with the calls being mirrored.
describe("node:inspector Runtime.consoleAPICalled", () => {
  type Event = {
    type: string;
    args: any[];
    stackTrace?: { callFrames: { functionName: string; scriptId: string; url: string; lineNumber: number }[] };
  };

  async function collect(script: string): Promise<Event[]> {
    // The mirrored console calls also write to the child's stdout, so the JSON
    // result is tagged with a marker and split off on the parent side.
    const marker = "\n<<<RESULT>>>\n";
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const s = new (require("node:inspector").Session)();
         s.connect();
         const events = [];
         s.on("Runtime.consoleAPICalled", m => events.push(m.params));
         await new Promise((ok, no) => s.post("Runtime.enable", {}, e => (e ? no(e) : ok())));
         ${script}
         await new Promise(r => setImmediate(r));
         s.disconnect();
         process.stdout.write(${JSON.stringify(marker)} + JSON.stringify(events));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) throw new Error(`subprocess failed (${exitCode}): ${stderr}`);
    const at = stdout.lastIndexOf(marker);
    if (at < 0) throw new Error(`no result marker; stdout:\n${stdout}\nstderr:\n${stderr}`);
    return JSON.parse(stdout.slice(at + marker.length));
  }

  test.concurrent("object args carry subtype, className, description, objectId and preview", async () => {
    const events = await collect(`
      console.log([1, 2, 3]);
      console.error(new TypeError("boom"));
      console.log(new Map([["k", 7]]), new Set([1, 2]));
      console.log(new Uint8Array([9, 8]));
      console.log(new Date(0));
      console.log(/abc/g);
      console.log(Promise.resolve(1));
      console.log({ a: 1, b: { c: 2 } });
      console.log(function foo() {});
    `);

    const arr = events[0].args[0];
    expect(arr).toMatchObject({
      type: "object",
      subtype: "array",
      className: "Array",
      description: "Array(3)",
    });
    expect(typeof arr.objectId).toBe("string");
    expect(arr.preview).toMatchObject({
      type: "object",
      subtype: "array",
      description: "Array(3)",
      overflow: false,
      properties: [
        { name: "0", type: "number", value: "1" },
        { name: "1", type: "number", value: "2" },
        { name: "2", type: "number", value: "3" },
      ],
    });

    const err = events[1].args[0];
    expect(err).toMatchObject({ type: "object", subtype: "error", className: "TypeError" });
    expect(err.description).toStartWith("TypeError: boom");
    expect(err.description).toContain("\n    at "); // carries the stack, not just "[object Error]"
    const propNames = err.preview.properties.map((p: any) => p.name);
    expect(propNames).toContain("message");
    expect(propNames).toContain("stack");

    const [mapArg, setArg] = events[2].args;
    expect(mapArg).toMatchObject({ type: "object", subtype: "map", className: "Map", description: "Map(1)" });
    expect(mapArg.preview.entries).toEqual([
      {
        key: expect.objectContaining({ type: "string", description: "k" }),
        value: expect.objectContaining({ type: "number", description: "7" }),
      },
    ]);
    expect(setArg).toMatchObject({ type: "object", subtype: "set", className: "Set", description: "Set(2)" });
    expect(setArg.preview.entries).toEqual([
      { value: expect.objectContaining({ type: "number", description: "1" }) },
      { value: expect.objectContaining({ type: "number", description: "2" }) },
    ]);

    expect(events[3].args[0]).toMatchObject({
      type: "object",
      subtype: "typedarray",
      className: "Uint8Array",
      description: "Uint8Array(2)",
      preview: expect.objectContaining({
        properties: [
          { name: "0", type: "number", value: "9" },
          { name: "1", type: "number", value: "8" },
        ],
      }),
    });

    expect(events[4].args[0]).toMatchObject({ type: "object", subtype: "date", className: "Date" });
    expect(events[4].args[0].description).toContain("1970");
    expect(events[5].args[0]).toMatchObject({
      type: "object",
      subtype: "regexp",
      className: "RegExp",
      description: "/abc/g",
    });
    expect(events[6].args[0]).toMatchObject({
      type: "object",
      subtype: "promise",
      className: "Promise",
      description: "Promise",
    });

    const obj = events[7].args[0];
    expect(obj).toMatchObject({ type: "object", className: "Object", description: "Object" });
    expect(obj.subtype).toBeUndefined();
    expect(obj.preview.properties).toEqual([
      { name: "a", type: "number", value: "1" },
      { name: "b", type: "object", value: "Object" },
    ]);

    const fn = events[8].args[0];
    expect(fn).toMatchObject({ type: "function", className: "Function" });
    expect(fn.description).toContain("function foo");
    expect(typeof fn.objectId).toBe("string");
  });

  test.concurrent("every event carries a stackTrace with CDP call frames", async () => {
    const events = await collect(`
      function outer() { console.trace("t"); }
      outer();
      console.log("plain");
    `);
    expect(events.map(e => e.type)).toEqual(["trace", "log"]);
    for (const e of events) {
      expect(e.stackTrace).toBeDefined();
      expect(Array.isArray(e.stackTrace!.callFrames)).toBe(true);
      expect(e.stackTrace!.callFrames.length).toBeGreaterThan(0);
      const top = e.stackTrace!.callFrames[0];
      expect(top).toEqual({
        functionName: expect.any(String),
        scriptId: expect.any(String),
        url: expect.any(String),
        lineNumber: expect.any(Number),
        columnNumber: expect.any(Number),
      });
    }
    // The trace call's top frame is the user function, not the inspector hook.
    expect(events[0].stackTrace!.callFrames[0].functionName).toBe("outer");
  });

  test.concurrent("count, time/timeLog/timeEnd, assert, dirxml and clear emit events", async () => {
    const events = await collect(`
      console.count("cnt");
      console.count("cnt");
      console.countReset("cnt");
      console.count("cnt");
      console.time("tm");
      console.timeLog("tm", "extra");
      console.timeEnd("tm");
      console.assert(true, "quiet");
      console.assert(false, "loud");
      console.assert(false);
      console.dirxml({ x: 1 });
      console.clear();
    `);
    const byType = (t: string) => events.filter(e => e.type === t);

    const counts = byType("count");
    expect(counts.map(e => e.args[0].value)).toEqual(["cnt: 1", "cnt: 2", "cnt: 1"]);

    // timeLog emits as "log" per CDP, timeEnd as "timeEnd"; both formatted label: ms.
    const timeLog = byType("log").find(e => typeof e.args[0]?.value === "string" && e.args[0].value.startsWith("tm: "));
    expect(timeLog).toBeDefined();
    expect(timeLog!.args[0].value).toMatch(/^tm: [\d.]+ ms$/);
    expect(timeLog!.args[1]).toEqual({ type: "string", value: "extra" });
    const timeEnd = byType("timeEnd");
    expect(timeEnd).toHaveLength(1);
    expect(timeEnd[0].args[0].value).toMatch(/^tm: [\d.]+ ms$/);

    // assert: only on falsy; V8 substitutes "console.assert" when no message args were given.
    const asserts = byType("assert");
    expect(asserts).toHaveLength(2);
    expect(asserts[0].args).toEqual([{ type: "string", value: "loud" }]);
    expect(asserts[1].args).toEqual([{ type: "string", value: "console.assert" }]);

    const dirxml = byType("dirxml");
    expect(dirxml).toHaveLength(1);
    expect(dirxml[0].args[0]).toMatchObject({ type: "object", className: "Object" });

    expect(byType("clear")).toHaveLength(1);
  });

  test.concurrent("hostile arguments do not make console.log throw", async () => {
    const events = await collect(`
      const revoked = Proxy.revocable({}, {});
      revoked.revoke();
      let cyclic; cyclic = new Proxy({}, { getPrototypeOf: () => cyclic });
      console.log(revoked.proxy, Object.create(null), new Proxy([1], {}), cyclic);
      process.stderr.write("reached\\n");
    `);
    expect(events).toHaveLength(1);
    const [revoked, nullProto, arrayProxy, cyclic] = events[0].args;
    expect(revoked.type).toBe("object");
    expect(nullProto).toMatchObject({ type: "object", className: "Object", description: "Object" });
    expect(arrayProxy).toMatchObject({ type: "object", subtype: "proxy" });
    expect(cyclic).toMatchObject({ type: "object", subtype: "proxy" });
  });
});
