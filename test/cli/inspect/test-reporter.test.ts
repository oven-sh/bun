import { Subprocess, spawn, write } from "bun";
import { afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
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

  afterEach(() => {
    proc?.kill();
    proc = undefined;
    // @ts-ignore - close the socket if it exists
    socket?.end?.();
    socket = undefined as any;
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
    // Regression test for the TestReporter dual-ID-counter collision: the
    // live-registration path (`ScopeFunctions::call`) and the retroactive
    // path (`retroactively_report_discovered_tests`, invoked when
    // `TestReporter.enable` arrives after some tests are already
    // discovered) used to assign IDs from two independent counters.
    //
    // The "retroactively reports tests..." test above enables TestReporter
    // only *after* collection has fully finished (it waits for a test to
    // start executing first), so the live-registration path never runs
    // again within that test and the two counters never actually
    // interleave -- it cannot catch this bug.
    //
    // This test creates a genuine mid-collection window by pausing inside
    // an *async describe callback*. `bun:test` collection does not invoke
    // `describe()` callbacks inline: `describe()` only registers a scope
    // and enqueues its callback, and every enqueued callback across the
    // whole file -- including a sibling `describe()` called earlier at the
    // top level -- runs only once collection's own step loop gets to it,
    // which happens after the fixture module finishes evaluating. So a
    // *plain top-level* `await` between two `describe()` calls does not
    // create a useful pause: neither callback has run by then. Pausing
    // inside suite B's own (async) callback does: by the time that callback
    // starts, collection has already run suite A's (sync) callback to
    // completion -- registering `test A1`/`test A2` for real -- while suite
    // B's callback is paused before it calls `test()` for `test B1`.
    //
    // We enable TestReporter during that window. The retroactive walk
    // (triggered by `enable`) sees suite A fully populated (describe + 2
    // tests) *and* suite B's already-registered-but-still-empty describe
    // node -- both are entries in the root scope by the time `describe()`
    // was called for each, independent of whether their callbacks have run
    // -- so it assigns all 4 of those IDs. Only `test B1`, registered when
    // suite B's callback resumes after we release the gate, goes through
    // the live-registration path. That is enough to interleave the two
    // counters: pre-fix, the live path's counter is a `static AtomicI32`
    // that was never touched while the agent was disabled (every ID up to
    // this point came from the retroactive path's independent counter), so
    // it hands `test B1` an ID that collides with one the retroactive walk
    // already used.

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

    // Track every raw `found` id in emission order (not deduped) so a
    // collision shows up as a literal duplicate value, independent of the
    // `Map`-keyed `foundTests` bookkeeping in `TestReporterSession` (which
    // would silently coalesce two same-id `found` events into one entry).
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

    // Wait until suite A has fully registered and collection has paused
    // inside suite B's async describe callback (suite B's own `test()`
    // call not yet reached).
    await checkpointSeen;

    // Enable TestReporter now, genuinely mid-collection.
    session.enableTestReporter();

    // Suite A's describe + its 2 tests, plus suite B's (still test-less)
    // describe, are reported retroactively -- 4 found events.
    await session.waitForFoundTests(4, 15000);

    // Release the gate so suite B's callback resumes and registers test B1
    // via the live path while the agent is already enabled.
    await write(collectGatePath, "go");

    // test B1 brings the total to 5 found events (2 describes + 3 tests).
    // Pre-fix, test B1's id collides with one the retroactive walk already
    // used, so this collapses to 4 distinct keys and times out here.
    const foundTests = await session.waitForFoundTests(5, 15000);
    expect(foundTests.size).toBe(5);

    // This wait and the size assertion below are liveness/sanity checks,
    // not collision detectors: on unpatched bun, this test's deterministic
    // interleaving has the live-registered test B1 collide with a
    // retroactively-assigned *describe* id, so all 3 real tests still end
    // up with distinct `end` ids (3 distinct keys are seen either way).
    // The collision is caught below by the waitForFoundTests(5) gate and
    // the rawFoundIds uniqueness assertion, not by this wait.
    const endedTests = await session.waitForEndedTests(3, 15000);
    expect(endedTests.size).toBe(3);

    // All `end` events received; release the afterAll hold so the
    // subprocess can exit.
    await write(doneGatePath, "go");

    const exitCode = await proc.exited;

    // The core assertion: every `found` id handed out across the
    // retroactive path (suite A + suite B's describe) and the live path
    // (test B1) is unique.
    expect(rawFoundIds.length).toBe(5);
    expect(new Set(rawFoundIds).size).toBe(5);

    if (exitCode !== 0) {
      expect(await proc.stderr.text()).toBe("");
    }
    expect(exitCode).toBe(0);

    // Every `end` event's id must correspond to an actual `test` (not a
    // `describe`). Note: `foundTests` is a Map keyed by id, so it keeps
    // only the last claimant of a shared id and cannot itself reveal a
    // collision -- that's what the rawFoundIds uniqueness check above is
    // for.
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
  });
});
