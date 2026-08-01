import { Subprocess, spawn, write } from "bun";
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
   * Wait for a Console.messageAdded event whose text contains the given substring.
   */
  waitForConsoleMessage(substring: string, timeout = 10000): Promise<any> {
    this.ref();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for console message containing: ${substring}`));
      }, timeout);

      this.addEventListener("Console.messageAdded", (params: any) => {
        if (params?.message?.text?.includes?.(substring)) {
          clearTimeout(timer);
          resolve(params);
        }
      });
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

// Every test spawns `bun test` under --inspect-wait; the drain test below
// spawns a batch of them, and ASAN/debug startup alone is several seconds.
// Note setDefaultTimeout() overrides the CI runner's own --timeout (per-test
// option > setDefaultTimeout > CLI flag), so scale for slow builds here
// instead of using a flat value that would undercut the runner's ASAN
// allowance.
setDefaultTimeout(isASAN || isDebug ? 120_000 : 60_000);

describe.if(isPosix)("TestReporter inspector protocol", () => {
  let proc: Subprocess | undefined;
  let socket: ReturnType<typeof connect> extends Promise<infer T> ? T : never;
  // The drain test below spawns several subprocesses in parallel; force-kill
  // any that are still alive if the test times out or fails partway through.
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
    // 1. Connect to inspector and enable Inspector + Console (NOT TestReporter)
    // 2. Send Inspector.initialized to allow test collection and execution to proceed
    // 3. Wait for test A1 to signal it has started via a Console.messageAdded event,
    //    which guarantees collection is finished and execution has begun
    // 4. THEN send TestReporter.enable - this should trigger retroactive reporting
    //    of tests that were discovered but not yet reported
    // 5. Once we receive the retroactive `found` events (proving enable was processed
    //    on the JS thread), write a gate file that releases A1. This guarantees A1's
    //    `end` event fires with the agent enabled rather than racing with the
    //    cross-thread dispatch of TestReporter.enable.
    // 6. An afterAll hook polls for a second gate file that we only write after all
    //    three `end` events have been received. Inspector events are written to the
    //    socket from the detached debugger thread, and the test runner calls exit()
    //    immediately after the last test without draining that queue, so without the
    //    hold the final end(s) can be lost. The afterAll keeps the process alive
    //    (and the JS thread yielding) until delivery is confirmed.

    using dir = tempDir("test-reporter-delayed-enable", {
      "delayed.test.ts": `
import { afterAll, describe, test, expect } from "bun:test";
import { existsSync } from "node:fs";

describe("suite A", () => {
  test("test A1", async () => {
    console.log("__A1_RUNNING__");
    while (!existsSync("a1-gate")) await Bun.sleep(10);
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

afterAll(async () => {
  while (!existsSync("done-gate")) await Bun.sleep(10);
});
`,
    });

    const socketPath = join(String(dir), `inspector-${Math.random().toString(36).substring(2)}.sock`);
    const gatePath = join(String(dir), "a1-gate");
    const doneGatePath = join(String(dir), "done-gate");

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
      // --timeout keeps the inner test's budget above the 15000ms outer waits
      // so A1 cannot time out before the gate file is written under heavy load.
      cmd: [bunExe(), `--inspect-wait=unix:${socketPath}`, "test", "--timeout", "30000", "delayed.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    await socketPromise;

    // Enable Inspector and Console (NOT TestReporter). Console lets us observe when
    // A1 has actually started executing without relying on wall-clock sleeps.
    session.enableInspector();
    session.send("Console.enable");

    // Register the listener before allowing execution to proceed so we cannot miss the message.
    const a1Started = session.waitForConsoleMessage("__A1_RUNNING__", 15000);

    // Signal ready - this allows test collection and execution to proceed
    session.initialize();

    // Wait until test A1 is actually running (collection is done, execution has begun).
    await a1Started;

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

    // Receiving the retroactive `found` events proves TestReporter.enable has been
    // processed on the JS thread. Release A1 so its `end` event fires with the agent
    // enabled, then wait for all three tests to report completion.
    await write(gatePath, "go");

    const endedTests = await session.waitForEndedTests(3, 15000);
    expect(endedTests.size).toBe(3);

    // All `end` events received; release the afterAll hold so the subprocess can exit.
    await write(doneGatePath, "go");

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });

  test("flushes pending inspector messages to the frontend before process exit", async () => {
    // Regression test for the exit-race this PR fixes: the main thread
    // queues the final TestReporter events for the detached debugger thread
    // to deliver, then calls exit() -- and without draining first, exit()
    // can kill that thread mid-delivery.
    //
    // The fixture uses fast SYNCHRONOUS tests on purpose: synchronous tests
    // let the runner fall straight through from the last test's `end` event
    // into process exit within the same tick, which maximizes the race
    // window (an async test would yield the event loop at least once,
    // giving the debugger thread a natural opportunity to catch up).
    //
    // A single lone run of this on an idle many-core machine may well pass
    // even without the fix -- the debugger thread usually gets scheduled
    // quickly enough. What makes the race bite reliably is CPU contention:
    // running a batch of these subprocesses in parallel starves the
    // debugger thread of scheduler time relative to each subprocess's own
    // main thread, which is what actually reproduces the loss. This test is
    // reliably-failing-under-parallel-load pre-fix, not deterministic on a
    // single idle run.
    //
    // COVERAGE SCOPE: this uses `--inspect-wait=unix:...`, which routes
    // through debugger.ts's #connectOverSocket() / SocketFramer path, NOT the
    // ws:/ws+unix: server path that uses webSocketWriter/bufferedWriter. So it
    // exercises the layer-(a) main->debugger-thread drain only; it does NOT
    // cover WebSocket-level backpressure delivery, which is a separate bug
    // with its own fix and test in a separate PR.
    const testCount = 5;
    const body = Array.from(
      { length: testCount },
      (_, i) => `test("t${i}", () => { expect(${i}).toBe(${i}); });`,
    ).join("\n");

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
        // "ignore" (not "pipe") for stdout: we only read stderr below, and an
        // undrained "pipe" can deadlock the child once the OS pipe buffer fills.
        stdout: "ignore",
        stderr: "pipe",
      });
      spawnedProcs.add(localProc);

      await socketPromise;

      // Enable TestReporter *before* Inspector.initialized so every test is
      // reported via the normal (non-retroactive) live-collection path --
      // this test is isolating the exit-drain bug, not the ID-collision bug
      // covered by the previous test.
      session.enableInspector();
      session.enableTestReporter();
      session.initialize();

      const [stderr, exitCode] = await Promise.all([localProc.stderr.text(), localProc.exited]);
      spawnedProcs.delete(localProc);

      // Wait for the socket's FIN, not just process exit. On a Unix stream
      // socket, FIN is ordered after data: once `close` fires, every byte
      // the subprocess wrote has already been delivered through `onData` and
      // into `session.onMessage`, so this is what actually guarantees the
      // snapshot below reflects everything the subprocess sent (process exit
      // alone would not -- the kernel can still be delivering already-queued
      // bytes after the process is gone).
      // @ts-ignore - close the socket if it exists
      localSocket?.end?.();
      await socketClosed.promise;

      return {
        stderr,
        exitCode,
        found: session.getFoundTests(),
        started: session.getStartedTests(),
        ended: session.getEndedTests(),
      };
    }

    // Run a batch of subprocesses in parallel (see comment above for why
    // that matters for reproducing the race) and check every one delivered
    // everything. Under ASAN/debug builds subprocess startup itself is slow
    // enough that this loses its ability to reproduce the pre-fix race
    // within a reasonable timeout, so dial down the batch size there --
    // the test still verifies correctness, just with less contention.
    const slow = isASAN || isDebug;
    const width = slow ? 4 : 8;
    const rounds = slow ? 1 : 2;

    const results: Awaited<ReturnType<typeof once>>[] = [];
    for (let round = 0; round < rounds; round++) {
      results.push(...(await Promise.all(Array.from({ length: width }, () => once()))));
    }

    for (const { stderr, exitCode, found, started, ended } of results) {
      expect(stderr).toContain(`${testCount} pass`);
      // Every test must have a `found`, a `start`, and an `end` event, and
      // every `end` event must report a pass -- zero trailing loss across
      // exit at any of the three reporting stages.
      expect(found.size).toBe(testCount);
      expect(started.size).toBe(testCount);
      expect(ended.size).toBe(testCount);
      expect([...ended.values()].map(e => e.status)).toEqual(Array(testCount).fill("pass"));
      expect(exitCode).toBe(0);
    }
  });
});
