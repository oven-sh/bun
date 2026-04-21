import { Subprocess, spawn } from "bun";
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isPosix, tempDir } from "harness";
import { join } from "node:path";
import { InspectorSession, connect } from "./junit-reporter";
import { SocketFramer } from "./socket-framer";

/**
 * Extended InspectorSession with helper methods for TestReporter testing
 */
class TestReporterSession extends InspectorSession {
  private foundTests: Map<number, any> = new Map();
  private startedTests: Set<number> = new Set();
  private endedTests: Map<number, any> = new Map();

  constructor() {
    super();
    this.setupTestEventListeners();
  }

  private setupTestEventListeners() {
    this.addEventListener("TestReporter.found", (params: any) => {
      this.foundTests.set(params.id, params);
    });
    this.addEventListener("TestReporter.start", (params: any) => {
      this.startedTests.add(params.id);
    });
    this.addEventListener("TestReporter.end", (params: any) => {
      this.endedTests.set(params.id, params);
    });
  }

  enableInspector() {
    this.send("Inspector.enable");
  }

  enableTestReporter() {
    this.send("TestReporter.enable");
  }

  /** Send a command and resolve with its result once the ack arrives. */
  sendAndWait(method: string, params: any = {}): Promise<any> {
    if (!this.framer) throw new Error("Socket not connected");
    this.ref();
    const id = this.nextId++;
    return new Promise(resolve => {
      this.messageCallbacks.set(id, resolve);
      this.framer!.send(this.socket as any, JSON.stringify({ id, method, params }));
    });
  }

  enableAll() {
    this.send("Inspector.enable");
    this.send("TestReporter.enable");
    this.send("LifecycleReporter.enable");
    this.send("Console.enable");
    this.send("Runtime.enable");
  }

  initialize() {
    this.send("Inspector.initialized");
  }

  unref() {
    this.socket?.unref();
  }

  ref() {
    this.socket?.ref();
  }

  getFoundTests() {
    return this.foundTests;
  }

  getStartedTests() {
    return this.startedTests;
  }

  getEndedTests() {
    return this.endedTests;
  }

  clearFoundTests() {
    this.foundTests.clear();
  }

  waitForEvent(eventName: string, timeout = 10000): Promise<any> {
    this.ref();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for event: ${eventName}`));
      }, timeout);

      const listener = (params: any) => {
        clearTimeout(timer);
        resolve(params);
      };

      this.addEventListener(eventName, listener);
    });
  }

  /**
   * Wait for a specific number of TestReporter.found events
   */
  waitForFoundTests(count: number, timeout = 10000): Promise<Map<number, any>> {
    this.ref();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `Timeout waiting for ${count} found tests, got ${this.foundTests.size}: ${JSON.stringify([...this.foundTests.values()])}`,
          ),
        );
      }, timeout);

      const check = () => {
        if (this.foundTests.size >= count) {
          clearTimeout(timer);
          resolve(this.foundTests);
        }
      };

      // Check immediately in case we already have enough
      check();

      // Also listen for new events
      this.addEventListener("TestReporter.found", check);
    });
  }

  /**
   * Wait for a specific number of TestReporter.end events
   */
  waitForEndedTests(count: number, timeout = 10000): Promise<Map<number, any>> {
    this.ref();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for ${count} ended tests, got ${this.endedTests.size}`));
      }, timeout);

      const check = () => {
        if (this.endedTests.size >= count) {
          clearTimeout(timer);
          resolve(this.endedTests);
        }
      };

      check();
      this.addEventListener("TestReporter.end", check);
    });
  }
}

// Every test spawns `bun test` under --inspect-wait; ASAN/debug startup alone
// is several seconds and the drain test runs a batch of them.
setDefaultTimeout(60_000);

describe.if(isPosix)("TestReporter inspector protocol", () => {
  let proc: Subprocess | undefined;
  let socket: Awaited<ReturnType<typeof connect>>;
  // Force-kill any leftover --inspect-wait children on timeout.
  const spawnedProcs = new Set<Subprocess>();

  afterEach(() => {
    proc?.kill();
    proc = undefined;
    // @ts-ignore - close the socket if it exists
    socket?.end?.();
    socket = undefined as any;
    for (const p of spawnedProcs) p.kill("SIGKILL");
    spawnedProcs.clear();
  });

  test("retroactively reports tests when TestReporter.enable is called after tests are discovered", async () => {
    // This test specifically verifies that when TestReporter.enable is called AFTER
    // test collection has started, the already-discovered tests are retroactively reported.
    //
    // The flow is:
    // 1. Connect to inspector and enable only Inspector domain (NOT TestReporter)
    // 2. Send Inspector.initialized to allow test collection and execution to proceed
    // 3. Wait briefly for test collection to complete
    // 4. THEN send TestReporter.enable - this should trigger retroactive reporting
    //    of tests that were discovered but not yet reported

    using dir = tempDir("test-reporter-delayed-enable", {
      "delayed.test.ts": `
import { describe, test, expect } from "bun:test";

describe("suite A", () => {
  test("test A1", async () => {
    // Add delay to ensure we have time to enable TestReporter during execution
    await Bun.sleep(500);
    expect(1).toBe(1);
  });
  test("test A2", () => {
    expect(2).toBe(2);
  });
});

describe("suite B", () => {
  test("test B1", () => {
    expect(3).toBe(3);
  });
});
`,
    });

    const socketPath = join(String(dir), `inspector-${Math.random().toString(36).substring(2)}.sock`);

    const session = new TestReporterSession();
    const framer = new SocketFramer((message: string) => {
      session.onMessage(message);
    });

    const socketPromise = connect(`unix://${socketPath}`).then(s => {
      socket = s;
      session.socket = s;
      session.framer = framer;
      s.data = {
        onData: framer.onData.bind(framer),
      };
      return s;
    });

    proc = spawn({
      cmd: [bunExe(), `--inspect-wait=unix:${socketPath}`, "test", "delayed.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    await socketPromise;

    // Enable Inspector only (NOT TestReporter)
    session.enableInspector();

    // Signal ready - this allows test collection and execution to proceed
    session.initialize();

    // Wait for test collection and first test to start running
    // The first test has a 500ms sleep, so waiting 200ms ensures we're in execution phase
    await Bun.sleep(200);

    // Now enable TestReporter - this should trigger retroactive reporting
    // of all tests that were discovered while TestReporter was disabled
    session.enableTestReporter();

    // We should receive found events for all tests retroactively
    // Structure: 2 describes + 3 tests = 5 items
    const foundTests = await session.waitForFoundTests(5, 15000);
    expect(foundTests.size).toBe(5);

    const testsArray = [...foundTests.values()];
    const describes = testsArray.filter(t => t.type === "describe");
    const tests = testsArray.filter(t => t.type === "test");

    expect(describes.length).toBe(2);
    expect(tests.length).toBe(3);

    // Verify the test names
    const testNames = tests.map(t => t.name).sort();
    expect(testNames).toEqual(["test A1", "test A2", "test B1"]);

    // Verify describe names
    const describeNames = describes.map(d => d.name).sort();
    expect(describeNames).toEqual(["suite A", "suite B"]);

    // Wait for tests to complete
    const endedTests = await session.waitForEndedTests(3, 15000);
    expect(endedTests.size).toBe(3);

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });

  test("assigns non-colliding IDs when TestReporter.enable lands mid-collection", async () => {
    // Regression: the retroactive and live reporting paths used independent
    // ID counters, so enabling mid-collection handed out colliding IDs.
    //
    // To hit that window deterministically the fixture hits a `debugger;`
    // statement after the top-level describe() calls. With the Debugger
    // domain enabled the main thread parks in runWhilePaused, which keeps
    // dispatching inspector commands, so we can send TestReporter.enable
    // (retroactive reporting runs against a tree with the two describes but
    // no tests yet) and then Debugger.resume — all as explicit
    // request/response pairs, no timing assumptions.

    using dir = tempDir("test-reporter-mid-collection", {
      "mid.test.ts": `
import { describe, test, expect } from "bun:test";

describe("suite A", () => {
  test("test A1", () => { expect(1).toBe(1); });
  test("test A2", () => { expect(2).toBe(2); });
});
describe("suite B", () => {
  test("test B1", () => { expect(3).toBe(3); });
});

// At this point both describes are in root_scope.entries with
// test_id_for_debugger == 0, but their callbacks (which register the inner
// test() calls) have not run yet. Pause here so the harness can enable
// TestReporter against exactly this partially-collected tree.
debugger;
`,
    });

    const socketPath = join(String(dir), `inspector-${Math.random().toString(36).substring(2)}.sock`);

    const session = new TestReporterSession();
    const framer = new SocketFramer((message: string) => {
      session.onMessage(message);
    });

    const socketClosed = Promise.withResolvers<void>();
    const socketPromise = connect(`unix://${socketPath}`, () => socketClosed.resolve()).then(s => {
      socket = s;
      session.socket = s;
      session.framer = framer;
      s.data = {
        onData: framer.onData.bind(framer),
      };
      return s;
    });

    proc = spawn({
      cmd: [bunExe(), `--inspect-wait=unix:${socketPath}`, "test", "mid.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    await socketPromise;

    // Enable Inspector + Debugger (so `debugger;` actually pauses), but not
    // TestReporter yet. JSC's debugger starts with breakpoints inactive and
    // doesn't pause on `debugger;` unless both are opted in. Arm the paused
    // listener before initialized so we can't miss the event; no internal
    // timer here — the file-level setDefaultTimeout is the single bound.
    const paused = new Promise<void>(resolve => session.addEventListener("Debugger.paused", () => resolve()));
    session.enableInspector();
    session.send("Debugger.enable");
    session.send("Debugger.setBreakpointsActive", { active: true });
    session.send("Debugger.setPauseOnDebuggerStatements", { enabled: true });
    session.initialize();

    await paused;

    // Main thread is parked in runWhilePaused with phase == .collection and
    // root_scope == [suite A, suite B]. runWhilePaused dispatches inspector
    // commands on the main thread, so this enable runs retroactive reporting
    // right here and the ack tells us it's done.
    await session.sendAndWait("TestReporter.enable");

    // The two describes should already have been reported retroactively.
    const afterRetro = [...session.getFoundTests().values()].map(t => ({ type: t.type, name: t.name }));
    expect(afterRetro).toEqual([
      { type: "describe", name: "suite A" },
      { type: "describe", name: "suite B" },
    ]);

    await session.sendAndWait("Debugger.resume");

    // Wait for exit *and* socket close — FIN is ordered after data on a
    // unix stream socket, so close guarantees every frame has been through
    // onMessage before we snapshot the maps. (No waitForFoundTests: when
    // IDs collide the map never reaches 5 and that just burns the timeout.)
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    await socketClosed.promise;

    const foundTests = session.getFoundTests();
    const testsArray = [...foundTests.values()];
    const describes = testsArray.filter(t => t.type === "describe");
    const tests = testsArray.filter(t => t.type === "test");

    // Two describes + three tests, all with distinct IDs. Before the fix the
    // tests overwrote the describes' IDs in this map and .size was 3.
    expect({
      size: foundTests.size,
      describeNames: describes.map(d => d.name).sort(),
      testNames: tests.map(t => t.name).sort(),
    }).toEqual({
      size: 5,
      describeNames: ["suite A", "suite B"],
      testNames: ["test A1", "test A2", "test B1"],
    });

    expect(session.getEndedTests().size).toBe(3);

    expect(stderr).toContain("3 pass");
    expect(exitCode).toBe(0);
  });

  test("flushes pending inspector messages to the frontend before process exit", async () => {
    // Regression: the main thread queued the final TestReporter events for
    // the detached debugger thread and then called exit() in the same tick,
    // killing it mid-delivery. Fixture: fast synchronous tests so all their
    // events land back-to-back right before exit.

    const testCount = 3;
    const body = Array.from({ length: testCount }, (_, i) => `test("t${i}", () => { expect(${i}).toBe(${i}); });`).join(
      "\n",
    );

    using dir = tempDir("test-reporter-drain", {
      "drain.test.ts": `
import { test, expect } from "bun:test";
${body}
`,
    });

    async function once() {
      const socketPath = join(String(dir), `inspector-${Math.random().toString(36).substring(2)}.sock`);

      const session = new TestReporterSession();
      const framer = new SocketFramer((message: string) => {
        session.onMessage(message);
      });

      let localSocket: Awaited<ReturnType<typeof connect>>;
      const socketClosed = Promise.withResolvers<void>();
      const socketPromise = connect(`unix://${socketPath}`, () => socketClosed.resolve()).then(s => {
        localSocket = s;
        session.socket = s;
        session.framer = framer;
        s.data = {
          onData: framer.onData.bind(framer),
        };
        return s;
      });

      const localProc = spawn({
        cmd: [bunExe(), `--inspect-wait=unix:${socketPath}`, "test", "drain.test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      spawnedProcs.add(localProc);

      await socketPromise;

      // Enable TestReporter *before* initialized so every test is reported via
      // the normal (non-retroactive) path — we're isolating the exit-drain bug.
      session.enableInspector();
      session.enableTestReporter();
      session.initialize();

      const [stderr, exitCode] = await Promise.all([localProc.stderr.text(), localProc.exited]);
      spawnedProcs.delete(localProc);
      // Await FIN so every frame has been through onMessage before we snapshot.
      // @ts-ignore
      localSocket?.end?.();
      await socketClosed.promise;

      return {
        stderr,
        exitCode,
        ended: session.getEndedTests(),
        found: session.getFoundTests(),
      };
    }

    // The race is scheduler-dependent; run several attempts in parallel so
    // any one dropping events fails the test. Under ASAN/debug the
    // subprocess is slow enough that the bug never reproduces anyway, so
    // dial it down there to keep within the timeout.
    const slow = isASAN || isDebug;
    const width = slow ? 4 : 8;
    const rounds = slow ? 1 : 2;
    const results: Awaited<ReturnType<typeof once>>[] = [];
    for (let r = 0; r < rounds; r++) {
      results.push(...(await Promise.all(Array.from({ length: width }, () => once()))));
    }

    for (const { stderr, exitCode, found, ended } of results) {
      expect(stderr).toContain(`${testCount} pass`);
      expect(found.size).toBe(testCount);
      expect([...ended.values()].map(e => e.status)).toEqual(Array(testCount).fill("pass"));
      expect(ended.size).toBe(testCount);
      expect(exitCode).toBe(0);
    }
  });
});
