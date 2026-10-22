import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
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
      const result: any = session.post("Profiler.enable");
      expect(result).toEqual({});
    });

    test("Profiler.disable succeeds", () => {
      session.post("Profiler.enable");
      const result: any = session.post("Profiler.disable");
      expect(result).toEqual({});
    });

    test("Profiler.start without enable throws", () => {
      expect(() => session.post("Profiler.start")).toThrow("not enabled");
    });

    test("Profiler.start after enable succeeds", () => {
      session.post("Profiler.enable");
      const result: any = session.post("Profiler.start");
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

      const result: any = session.post("Profiler.stop");

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
      const enableResult: any = session.post("Profiler.enable");
      expect(enableResult).toEqual({});

      // Start profiling
      const startResult: any = session.post("Profiler.start");
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
      const disableResult: any = session.post("Profiler.disable");
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

      const result: any = session.post("Profiler.stop");
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

      const result: any = session.post("Profiler.stop");
      const profile = result.profile;

      const nodeIds = new Set(profile.nodes.map((n: any) => n.id));
      for (const sample of profile.samples) {
        expect(nodeIds.has(sample)).toBe(true);
      }
    });

    test("Profiler.setSamplingInterval works", () => {
      session.post("Profiler.enable");
      const result: any = session.post("Profiler.setSamplingInterval", { interval: 500 });
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
      const result: any = session.post("Profiler.start");
      expect(result).toEqual({});
      session.post("Profiler.stop");
    });

    test("profiler can be restarted after stop", () => {
      // First run
      session.post("Profiler.enable");
      session.post("Profiler.start");
      let sum = 0;
      for (let i = 0; i < 1000; i++) sum += i;
      const result1: any = session.post("Profiler.stop");
      expect(result1).toHaveProperty("profile");

      // Second run
      session.post("Profiler.start");
      for (let i = 0; i < 1000; i++) sum += i;
      const result2: any = session.post("Profiler.stop");
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
      const result: any = session2.post("Profiler.setSamplingInterval", { interval: 500 });
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

  describe("HeapProfiler sampling", () => {
    type SamplingProfile = {
      head: SamplingNode;
      samples: { size: number; nodeId: number; ordinal: number }[];
    };
    type SamplingNode = {
      callFrame: { functionName: string; scriptId: string; url: string; lineNumber: number; columnNumber: number };
      selfSize: number;
      id: number;
      children: SamplingNode[];
    };

    function notStarted() {
      return expect.objectContaining({
        code: "ERR_INSPECTOR_COMMAND",
        message: "Inspector error -32000: V8 sampling heap profiler was not started.",
      });
    }

    // The sum of selfSize over the nodes named `name`, at any depth.
    function bytesOf(node: SamplingNode, name: string): number {
      let total = node.callFrame.functionName === name ? node.selfSize : 0;
      for (const child of node.children) total += bytesOf(child, name);
      return total;
    }

    function findNode(node: SamplingNode, name: string): SamplingNode | undefined {
      if (node.callFrame.functionName === name) return node;
      for (const child of node.children) {
        const found = findNode(child, name);
        if (found) return found;
      }
    }

    // The shape V8 gives: integer sizes, a tree whose selfSize totals match the samples, unique ids and ordinals.
    function validate(profile: SamplingProfile): number {
      const nodes = new Map<number, SamplingNode>();
      let treeBytes = 0;
      const walk = (node: SamplingNode) => {
        expect(nodes.has(node.id)).toBe(false);
        nodes.set(node.id, node);
        expect(Number.isInteger(node.selfSize) && node.selfSize >= 0).toBe(true);
        expect(node.callFrame).toEqual({
          functionName: expect.any(String),
          scriptId: expect.any(String),
          url: expect.any(String),
          lineNumber: expect.any(Number),
          columnNumber: expect.any(Number),
        });
        treeBytes += node.selfSize;
        node.children.forEach(walk);
      };
      walk(profile.head);
      expect(profile.head.callFrame).toEqual({
        functionName: "(root)",
        scriptId: "0",
        url: "",
        lineNumber: -1,
        columnNumber: -1,
      });
      expect(profile.head.id).toBe(1);
      // Stackless samples go under a pseudo child, so (root) never has bytes of its own, as in V8.
      expect(profile.head.selfSize).toBe(0);
      let sampleBytes = 0;
      let previousOrdinal = 0;
      for (const sample of profile.samples) {
        expect(nodes.has(sample.nodeId)).toBe(true);
        expect(Number.isInteger(sample.size) && sample.size > 0).toBe(true);
        expect(sample.ordinal).toBeGreaterThan(previousOrdinal);
        previousOrdinal = sample.ordinal;
        sampleBytes += sample.size;
      }
      expect(sampleBytes).toBe(treeBytes);
      return treeBytes;
    }

    let retained: unknown[] = [];
    function allocateObjects(count: number, into: unknown[]) {
      for (let i = 0; i < count; i++) into[i] = { index: i, a: i + 1, b: i + 2 };
    }
    function allocateMoreObjects(count: number, into: unknown[]) {
      for (let i = 0; i < count; i++) into[i] = { index: i, a: i + 1, b: i + 2 };
    }

    afterEach(() => {
      retained = [];
      // A test that failed mid-way must not leave the VM sampling for the next one.
      const session = new inspector.Session();
      session.connect();
      try {
        session.post("HeapProfiler.stopSampling");
      } catch {}
      session.disconnect();
    });

    test("stopSampling and getSamplingProfile before startSampling fail like V8", () => {
      const session = new inspector.Session();
      session.connect();
      expect(() => session.post("HeapProfiler.stopSampling")).toThrow(notStarted());
      expect(() => session.post("HeapProfiler.getSamplingProfile")).toThrow(notStarted());
      session.disconnect();
    });

    test("startSampling validates its parameters", () => {
      const session = new inspector.Session();
      session.connect();
      for (const params of [
        { samplingInterval: "32" },
        { samplingInterval: null },
        { samplingInterval: NaN },
        { samplingInterval: Infinity },
        { includeObjectsCollectedByMajorGC: 1 },
        { includeObjectsCollectedByMinorGC: null },
        { stackDepth: "2" },
        { stackDepth: null },
      ]) {
        expect(() => session.post("HeapProfiler.startSampling", params)).toThrow(
          expect.objectContaining({
            code: "ERR_INSPECTOR_COMMAND",
            message: "Inspector error -32602: Invalid parameters",
          }),
        );
      }
      for (const samplingInterval of [0, -1, 0.5]) {
        expect(() => session.post("HeapProfiler.startSampling", { samplingInterval })).toThrow(
          expect.objectContaining({
            code: "ERR_INSPECTOR_COMMAND",
            message: "Inspector error -32000: Invalid sampling interval",
          }),
        );
      }
      for (const stackDepth of [0, -1, 0.5]) {
        expect(() => session.post("HeapProfiler.startSampling", { stackDepth })).toThrow(
          expect.objectContaining({
            code: "ERR_INSPECTOR_COMMAND",
            message: "Inspector error -32000: Invalid stack depth",
          }),
        );
      }
      expect(() => session.post("HeapProfiler.stopSampling")).toThrow(notStarted());
      session.disconnect();
    });

    test("enable and disable succeed", () => {
      const session = new inspector.Session();
      session.connect();
      expect(session.post("HeapProfiler.enable")).toEqual({});
      expect(session.post("HeapProfiler.disable")).toEqual({});
      session.disconnect();
    });

    test("a profile attributes allocations to the function that made them", async () => {
      const session = new inspectorPromises.Session();
      session.connect();
      const holder = new Array(20000).fill(null);
      retained = holder;
      expect(await session.post("HeapProfiler.startSampling", { samplingInterval: 1024 })).toEqual({});
      allocateObjects(20000, holder);
      const { profile } = (await session.post("HeapProfiler.getSamplingProfile")) as { profile: SamplingProfile };
      const total = validate(profile);
      expect(profile.samples.length).toBeGreaterThan(100);
      // 20000 objects of at least 32 bytes each.
      expect(bytesOf(profile.head, "allocateObjects")).toBeGreaterThan(400_000);
      expect(bytesOf(profile.head, "allocateObjects")).toBeLessThanOrEqual(total);
      const node = findNode(profile.head, "allocateObjects")!;
      expect(node.callFrame.url).toBe(Bun.pathToFileURL(import.meta.path).href);
      expect(node.callFrame.scriptId).not.toBe("0");
      // The function's definition in this (transpiled) file, mapped back to the source, 0-based; the column is
      // the `(` of the parameter list, as the CPU profiler and V8 report it.
      const lines = readFileSync(import.meta.path, "utf8").split("\n");
      const definition = "function allocateObjects(";
      const definitionLine = lines.findIndex(line => line.includes(definition));
      expect(node.callFrame.lineNumber).toBe(definitionLine);
      expect(node.callFrame.columnNumber).toBe(lines[definitionLine].indexOf(definition) + definition.length - 1);
      // getSamplingProfile leaves sampling on: a second batch, kept as well, doubles the function's bytes.
      const holder2 = new Array(20000).fill(null);
      retained = [holder, holder2];
      allocateObjects(20000, holder2);
      const { profile: later } = (await session.post("HeapProfiler.getSamplingProfile")) as {
        profile: SamplingProfile;
      };
      expect(bytesOf(later.head, "allocateObjects")).toBeGreaterThan(bytesOf(profile.head, "allocateObjects") * 1.5);
      const { profile: last } = (await session.post("HeapProfiler.stopSampling")) as { profile: SamplingProfile };
      validate(last);
      await expect(session.post("HeapProfiler.getSamplingProfile")).rejects.toThrow(notStarted());
      session.disconnect();
    });

    test("two sites that allocate 1:3 get selfSize in that ratio", async () => {
      const session = new inspectorPromises.Session();
      session.connect();
      const small = new Array(10000).fill(null);
      const large = new Array(30000).fill(null);
      retained = [small, large];
      // 1 KiB gives about 1000 and 3000 samples: the 30% band is over 5 standard deviations wide.
      await session.post("HeapProfiler.startSampling", { samplingInterval: 1024 });
      allocateObjects(10000, small);
      allocateMoreObjects(30000, large);
      const { profile } = (await session.post("HeapProfiler.stopSampling")) as { profile: SamplingProfile };
      validate(profile);
      const ratio = bytesOf(profile.head, "allocateMoreObjects") / bytesOf(profile.head, "allocateObjects");
      expect(ratio).toBeGreaterThan(3 * 0.7);
      expect(ratio).toBeLessThan(3 * 1.3);
      session.disconnect();
    });

    test("samples of collected objects are dropped, or kept with includeObjectsCollectedByMajorGC", () => {
      const session = new inspector.Session();
      session.connect();
      // The objects of allocateObjects die when fill() returns; those of allocateMoreObjects stay in `kept`.
      function fill(kept: unknown[]) {
        const dropped = new Array(20000).fill(null);
        allocateObjects(20000, dropped);
        allocateMoreObjects(20000, kept);
      }
      for (const includeObjectsCollectedByMajorGC of [false, true]) {
        const kept = new Array(20000).fill(null);
        retained = kept;
        session.post("HeapProfiler.startSampling", { samplingInterval: 1024, includeObjectsCollectedByMajorGC });
        fill(kept);
        // The profile comes after a full collection, as V8 does it.
        const { profile } = session.post("HeapProfiler.stopSampling") as { profile: SamplingProfile };
        validate(profile);
        const keptBytes = bytesOf(profile.head, "allocateMoreObjects");
        const droppedBytes = bytesOf(profile.head, "allocateObjects");
        expect(keptBytes).toBeGreaterThan(400_000);
        if (includeObjectsCollectedByMajorGC) {
          // Kept as collected: the two sites allocated the same bytes.
          expect(droppedBytes).toBeGreaterThan(keptBytes / 2);
          expect(droppedBytes).toBeLessThan(keptBytes * 2);
        } else {
          expect(droppedBytes).toBeLessThan(keptBytes / 10);
        }
      }
      session.disconnect();
    });

    test("a second start keeps the running session, stop is VM-wide, and every starting session stops it on disable or disconnect", async () => {
      const starter = new inspectorPromises.Session();
      const other = new inspectorPromises.Session();
      const reader = new inspectorPromises.Session();
      starter.connect();
      other.connect();
      reader.connect();
      const holder = new Array(5000).fill(null);
      retained = holder;
      await starter.post("HeapProfiler.startSampling", { samplingInterval: 1024 });
      expect(await other.post("HeapProfiler.startSampling", { samplingInterval: 32768 })).toEqual({});
      allocateObjects(5000, holder);
      // Every session reads the one VM-wide profile.
      const fromOther = (await other.post("HeapProfiler.getSamplingProfile")) as { profile: SamplingProfile };
      expect(fromOther.profile.samples.length).toBeGreaterThan(0);
      // A session that only reads leaves sampling on when it goes.
      await reader.post("HeapProfiler.getSamplingProfile");
      await reader.post("HeapProfiler.disable");
      reader.disconnect();
      expect(((await starter.post("HeapProfiler.getSamplingProfile")) as any).profile.samples.length).toBeGreaterThan(
        0,
      );
      // A session that posted startSampling stops it on disable(), even when its start was the second one (V8).
      await other.post("HeapProfiler.disable");
      await expect(starter.post("HeapProfiler.getSamplingProfile")).rejects.toThrow(notStarted());
      other.disconnect();
      // A stop from any session stops it.
      await starter.post("HeapProfiler.startSampling");
      const third = new inspectorPromises.Session();
      third.connect();
      await third.post("HeapProfiler.stopSampling");
      third.disconnect();
      await expect(starter.post("HeapProfiler.getSamplingProfile")).rejects.toThrow(notStarted());
      // ... and on disconnect.
      await starter.post("HeapProfiler.startSampling");
      starter.disconnect();
      const fresh = new inspectorPromises.Session();
      fresh.connect();
      await expect(fresh.post("HeapProfiler.getSamplingProfile")).rejects.toThrow(notStarted());
      fresh.disconnect();
    });

    test("stackDepth caps the tree, and stackless samples land under a pseudo node", () => {
      const session = new inspector.Session();
      session.connect();
      function outer(count: number, into: unknown[]) {
        allocateObjects(count, into);
      }
      const depth = (node: SamplingNode): number => 1 + Math.max(0, ...node.children.map(depth));
      for (const stackDepth of [1, 2]) {
        const holder = new Array(5000).fill(null);
        retained = holder;
        session.post("HeapProfiler.startSampling", { samplingInterval: 1024, stackDepth });
        outer(5000, holder);
        const { profile } = session.post("HeapProfiler.stopSampling") as { profile: SamplingProfile };
        validate(profile);
        // (root) -> up to stackDepth frames.
        expect(depth(profile.head)).toBeLessThanOrEqual(1 + stackDepth);
        expect(bytesOf(profile.head, "allocateObjects")).toBeGreaterThan(100_000);
        if (stackDepth === 1) expect(findNode(profile.head, "outer")).toBeUndefined();
        else
          expect(findNode(profile.head, "outer")!.children.map(c => c.callFrame.functionName)).toContain(
            "allocateObjects",
          );
      }
      // A huge stackDepth is clamped to what a profile can hold (1024 frames), so deep recursion cannot overflow the
      // native stack when the profile is built.
      function recurse(depth: number, into: unknown[]): void {
        if (depth === 0) return allocateObjects(2000, into);
        recurse(depth - 1, into);
      }
      const holder = new Array(2000).fill(null);
      retained = holder;
      session.post("HeapProfiler.startSampling", { samplingInterval: 512, stackDepth: 1e6 });
      recurse(3000, holder);
      const { profile } = session.post("HeapProfiler.stopSampling") as { profile: SamplingProfile };
      validate(profile);
      expect(depth(profile.head)).toBeLessThanOrEqual(1 + 1024);
      expect(bytesOf(profile.head, "allocateObjects")).toBeGreaterThan(40_000);
      session.disconnect();
    });

    test("a worker's own Session samples the worker's VM", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const { Worker } = require("node:worker_threads");
          const worker = new Worker(\`
            const { Session } = require("node:inspector");
            const { parentPort } = require("node:worker_threads");
            function allocateInWorker(n) { const a = []; for (let i = 0; i < n; i++) a.push({ i }); return a; }
            const session = new Session();
            session.connect();
            session.post("HeapProfiler.startSampling", { samplingInterval: 1024 });
            globalThis.kept = allocateInWorker(20000);
            const { profile } = session.post("HeapProfiler.stopSampling");
            const names = [];
            (function walk(node) { names.push(node.callFrame.functionName); node.children.forEach(walk); })(profile.head);
            parentPort.postMessage({ hasWorkerFunction: names.includes("allocateInWorker"), rootSelfSize: profile.head.selfSize });
          \`, { eval: true });
          worker.on("message", m => { console.log(JSON.stringify(m)); worker.terminate(); });
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ hasWorkerFunction: true, rootSelfSize: 0 });
      expect(exitCode).toBe(0);
    });

    test("large array storage, its growth and strings are sampled and followed through GC", () => {
      const session = new inspector.Session();
      session.connect();
      function growArray(count: number) {
        const array: number[] = [];
        for (let i = 0; i < count; i++) array.push(i);
        return array;
      }
      function makeTypedArrays(count: number) {
        const arrays: Uint8Array[] = [];
        for (let i = 0; i < count; i++) arrays.push(new Uint8Array(100_000));
        return arrays;
      }
      function makeStrings(count: number) {
        const strings: string[] = [];
        const padding = Buffer.alloc(40, "x").toString();
        for (let i = 0; i < count; i++) strings.push("item-" + i + "-" + padding);
        return strings;
      }
      session.post("HeapProfiler.startSampling", { samplingInterval: 1024 });
      // The storage is a precise allocation that grows by reallocation, so its samples move with it.
      let grown: number[] | null = growArray(300_000);
      Bun.gc(true);
      let typed: Uint8Array[] | null = makeTypedArrays(50);
      const strings = makeStrings(20_000);
      retained = [grown, typed, strings];
      let { profile } = session.post("HeapProfiler.getSamplingProfile") as { profile: SamplingProfile };
      validate(profile);
      // 300k elements of 8 bytes, and the smaller storages it grew through.
      expect(bytesOf(profile.head, "growArray")).toBeGreaterThan(2_400_000);
      // A typed array's backing store is not GC heap memory, and, as in V8's profile, it is not counted: only the
      // view and buffer cells are.
      expect(bytesOf(profile.head, "makeTypedArrays")).toBeLessThan(500_000);
      // 20k strings of about 50 characters: the characters count, not only the 16-byte cells.
      expect(bytesOf(profile.head, "makeStrings")).toBeGreaterThan(20_000 * 40);
      // Dropped, the grown storage's samples go with it.
      grown = null;
      typed = null;
      retained = [strings];
      ({ profile } = session.post("HeapProfiler.stopSampling") as { profile: SamplingProfile });
      validate(profile);
      expect(bytesOf(profile.head, "growArray")).toBeLessThan(240_000);
      expect(bytesOf(profile.head, "makeStrings")).toBeGreaterThan(20_000 * 40);
      session.disconnect();
    });

    test("functions whose samples are all collected leave the tree", () => {
      const session = new inspector.Session();
      session.connect();
      session.post("HeapProfiler.startSampling", { samplingInterval: 1024 });
      // 500 functions compiled at runtime, each with its own source and node, each allocating garbage.
      const sink = { value: null as unknown };
      for (let i = 0; i < 500; i++) {
        const compiled = new Function("sink", `for (let j = 0; j < 100; j++) sink.value = { j, tag: ${i} };`);
        compiled(sink);
      }
      const { profile } = session.post("HeapProfiler.stopSampling") as { profile: SamplingProfile };
      validate(profile);
      let nodes = 0;
      (function count(node: SamplingNode) {
        nodes++;
        node.children.forEach(count);
      })(profile.head);
      // What survives is the harness and, at most, the last function's last object.
      expect(nodes).toBeLessThan(30);
      session.disconnect();
    });

    test("the callback API delivers the profile", async () => {
      const session = new inspector.Session();
      session.connect();
      const holder = new Array(5000).fill(null);
      retained = holder;
      await new Promise<void>((resolve, reject) =>
        session.post("HeapProfiler.startSampling", { samplingInterval: 1024 }, err => (err ? reject(err) : resolve())),
      );
      allocateObjects(5000, holder);
      const result = await new Promise<any>((resolve, reject) =>
        session.post("HeapProfiler.stopSampling", (err, result) => (err ? reject(err) : resolve(result))),
      );
      validate(result.profile);
      expect(result.profile.samples.length).toBeGreaterThan(0);
      session.disconnect();
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

    const result: Promise<unknown> = session.post("Profiler.enable");
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
