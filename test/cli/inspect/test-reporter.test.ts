import { Subprocess, spawn, write } from "bun";
import { afterEach, describe, expect, test } from "bun:test";
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

  test("assigns unique test IDs when TestReporter.enable lands mid-collection", async () => {
    // Regression: the live-registration path (ScopeFunctions::call) and the
    // retroactive path (retroactively_report_discovered_tests) used to draw
    // IDs from two independent counters. The existing test above enables
    // TestReporter only after collection finishes, so the two paths never
    // interleave there.
    //
    // Here we pause inside suite B's *async describe callback*. By that point
    // collection has already run suite A's (sync) callback to completion
    // (registering test A1/A2), while suite B's own test() has not yet been
    // called. Enabling TestReporter in that window sends suite A + suite B's
    // describe through the retroactive walk; test B1 is registered live once
    // we release the gate.

    using dir = tempDir("test-reporter-mid-collection", {
      "mid-collection.test.ts": `
import { afterAll, describe, test, expect } from "bun:test";
import { existsSync } from "node:fs";

describe("suite A", () => {
  test("test A1", () => {
    expect(1).toBe(1);
  });
  test("test A2", () => {
    expect(2).toBe(2);
  });
});

describe("suite B", async () => {
  console.log("__COLLECTION_CHECKPOINT__");
  while (!existsSync("collect-gate")) {
    await Bun.sleep(5);
  }
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
    const collectGatePath = join(String(dir), "collect-gate");
    const doneGatePath = join(String(dir), "done-gate");

    const session = new TestReporterSession();
    const framer = new SocketFramer((message: string) => {
      session.onMessage(message);
    });

    // Track every raw `found` id in arrival order (no dedupe) so a collision
    // shows up as a literal duplicate independent of the Map-keyed bookkeeping
    // in TestReporterSession (which would silently coalesce same-id events).
    const rawFoundIds: number[] = [];
    session.addEventListener("TestReporter.found", (params: any) => {
      rawFoundIds.push(params.id);
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
      cmd: [bunExe(), `--inspect-wait=unix:${socketPath}`, "test", "--timeout", "30000", "mid-collection.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    await socketPromise;

    // Enable Inspector and Console (NOT TestReporter). Console lets us observe
    // the collection checkpoint without disturbing collection itself.
    session.enableInspector();
    session.send("Console.enable");

    const checkpointSeen = session.waitForConsoleMessage("__COLLECTION_CHECKPOINT__", 15000);

    // Signal ready - this allows test collection to proceed.
    session.initialize();

    // Wait until suite A has fully registered and collection is paused inside
    // suite B's async describe callback (test B1 not yet registered).
    await checkpointSeen;

    // Enable TestReporter now, genuinely mid-collection.
    session.enableTestReporter();

    // suite A's describe + 2 tests, plus suite B's (empty) describe: 4 events
    // via the retroactive walk.
    await session.waitForFoundTests(4, 15000);

    // Release the gate so suite B's callback registers test B1 via the live
    // path while the agent is enabled.
    await write(collectGatePath, "go");

    // test B1 brings the total to 5. Pre-fix its id collides with one the
    // retroactive walk already used, so the Map stays at 4 keys and this
    // wait times out.
    const foundTests = await session.waitForFoundTests(5, 15000);
    expect(foundTests.size).toBe(5);

    const endedTests = await session.waitForEndedTests(3, 15000);
    expect(endedTests.size).toBe(3);

    // All `end` events received; release the afterAll hold so the subprocess
    // can exit.
    await write(doneGatePath, "go");

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    void stdout;

    // Core assertion: every `found` id across both paths is unique.
    expect(rawFoundIds.length).toBe(5);
    expect(new Set(rawFoundIds).size).toBe(5);

    // Every `end` event's id must correspond to an actual `test`.
    for (const id of endedTests.keys()) {
      const found = foundTests.get(id);
      expect(found).toBeDefined();
      expect(found.type).toBe("test");
    }

    const testNames = [...foundTests.values()]
      .filter(t => t.type === "test")
      .map(t => t.name)
      .sort();
    expect(testNames).toEqual(["test A1", "test A2", "test B1"]);

    if (exitCode !== 0) {
      expect(stderr).toBe("");
    }
    expect(exitCode).toBe(0);
  });

  test(
    "flushes pending inspector messages to the frontend before process exit",
    async () => {
      // Regression for the exit-race fixed by Bun__debugger__drain: the main
      // thread queues the final TestReporter events for the detached debugger
      // thread, then falls through to exit() which can kill that thread
      // mid-delivery.
      //
      // Fast SYNCHRONOUS fixture tests on purpose: they let the runner reach
      // exit() in the same tick as the last `end` event. A lone run on an idle
      // machine may pass even without the fix; parallel spawns supply the CPU
      // contention that makes the race bite reliably.
      //
      // Uses --inspect-wait=unix:... (SocketFramer path), not ws:, so this
      // exercises the main->debugger-thread drain, not WebSocket backpressure.
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

        // Enable TestReporter before Inspector.initialized so every test is
        // reported via the normal live-collection path, not retroactively.
        session.enableInspector();
        session.enableTestReporter();
        session.initialize();

        const [stderr, exitCode] = await Promise.all([localProc.stderr.text(), localProc.exited]);
        spawnedProcs.delete(localProc);

        // Wait for the socket's FIN, not just process exit: FIN is ordered
        // after data, so once `close` fires every byte the subprocess wrote has
        // been delivered. Process exit alone wouldn't guarantee this.
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

      // Parallel batch for contention (see above). ASAN/debug subprocess
      // startup is slow enough that a smaller batch still fits the timeout.
      const slow = isASAN || isDebug;
      const width = slow ? 4 : 8;
      const rounds = slow ? 1 : 2;

      const results: Awaited<ReturnType<typeof once>>[] = [];
      for (let round = 0; round < rounds; round++) {
        results.push(...(await Promise.all(Array.from({ length: width }, () => once()))));
      }

      for (const { stderr, exitCode, found, started, ended } of results) {
        expect(stderr).toContain(`${testCount} pass`);
        // Zero trailing loss at any of the three reporting stages.
        expect(found.size).toBe(testCount);
        expect(started.size).toBe(testCount);
        expect(ended.size).toBe(testCount);
        expect([...ended.values()].map(e => e.status)).toEqual(Array(testCount).fill("pass"));
        expect(exitCode).toBe(0);
      }
    },
    // Spawns a batch of --inspect-wait subprocesses; ASAN/debug startup is slow.
    (isASAN || isDebug ? 120 : 60) * 1000,
  );
});
