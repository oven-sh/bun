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

  test("delivers every TestReporter event exactly once, in order, when write() reports WebSocket backpressure", async () => {
    // Regression test for the "pace on backpressure" fix in bufferedWriter()/
    // webSocketWriter() (src/js/internal/debugger.ts).
    //
    // ws.sendText() returns a JS number with a three-way contract (see
    // packages/bun-uws/src/WebSocket.h, `WebSocket::send()`'s doc comment and
    // `SendStatus` enum): -1 (BACKPRESSURE, message WAS accepted into uWS's
    // outbound buffer but the buffer is running high), 0 (DROPPED, message
    // was NOT sent at all), or a positive byte count (SUCCESS).
    //
    // Previously `webSocketWriter` collapsed this with `!!`, coercing -1 to
    // `true` and making backpressure indistinguishable from success, so
    // bufferedWriter() -- which only requeues on a falsy return -- never
    // reacted to backpressure at all. The fix under test here distinguishes
    // all three cases and, on backpressure, PACES further writes (queues them
    // rather than sending immediately) until the next drain(), instead of
    // re-sending the message that reported backpressure. Re-sending that
    // specific message would duplicate it on the wire, since uWS's own
    // contract says BACKPRESSURE means the message was already accepted --
    // unlike DROPPED, which means it was discarded and must be retried.
    //
    // This test drives the debugger socket into genuine backpressure using
    // the same technique as the sibling backpressure test above (pause our
    // reads before the subprocess starts emitting), then asserts every
    // found/end event for every test arrives EXACTLY once (catching a naive
    // "resend the backpressured message" implementation, which would produce
    // duplicates) and that ids are observed in non-decreasing order (catching
    // paced messages being flushed out of order relative to ones already
    // sent). Tests run sequentially with no `describe` nesting, so found ids
    // are expected in declaration order (collected in one synchronous pass)
    // and end ids are expected in the same sequential execution order.

    const TEST_COUNT = 500;

    const testFileLines = [`import { test, expect } from "bun:test";`];
    for (let i = 0; i < TEST_COUNT; i++) {
      // A sizeable console.log per test increases the bytes queued on the
      // debugger socket while it is paused, helping push sendText() past
      // uWS's backpressure threshold.
      testFileLines.push(
        `test("backpressure order test ${i}", () => { console.log("x".repeat(2000)); expect(${i}).toBe(${i}); });`,
      );
    }

    using dir = tempDir("test-reporter-backpressure-order", {
      "backpressure-order.test.ts": testFileLines.join("\n"),
    });

    const socketPath = join(String(dir), `inspector-${Math.random().toString(36).substring(2)}.sock`);

    const session = new TestReporterSession();
    const framer = new SocketFramer((message: string) => {
      session.onMessage(message);
    });

    // Track raw arrival order/count independent of TestReporterSession's
    // internal Map (which is keyed by id and would silently absorb a
    // duplicate rather than surface it).
    const foundIds: number[] = [];
    const endedIds: number[] = [];
    session.addEventListener("TestReporter.found", (params: any) => foundIds.push(params.id));
    session.addEventListener("TestReporter.end", (params: any) => endedIds.push(params.id));

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
      cmd: [
        bunExe(),
        `--inspect-wait=unix:${socketPath}`,
        "test",
        "--timeout",
        "30000",
        "backpressure-order.test.ts",
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    await socketPromise;

    // Pause reading on our side immediately, before the subprocess even
    // starts emitting protocol messages, so its writes queue up and
    // back-pressure.
    socket!.pause();

    session.enableInspector();
    session.enableTestReporter();
    session.send("Console.enable");
    session.initialize();

    // Give the subprocess time to run all tests and attempt to emit every
    // found/start/end event and console message while our socket is paused
    // and not draining anything.
    await Bun.sleep(2000);

    // Now resume reading. Paced messages should flush in order, with no
    // duplicates, once the connection drains.
    socket!.resume();

    await session.waitForFoundTests(TEST_COUNT, 30000);
    await session.waitForEndedTests(TEST_COUNT, 30000);

    // Exactly one `found`/`end` per test -- no message was silently dropped,
    // and none was duplicated by a naive resend-on-backpressure.
    expect(foundIds.length).toBe(TEST_COUNT);
    expect(new Set(foundIds).size).toBe(TEST_COUNT);
    expect(endedIds.length).toBe(TEST_COUNT);
    expect(new Set(endedIds).size).toBe(TEST_COUNT);

    // Ids arrive in non-decreasing order: a paced (queued) message is never
    // flushed ahead of a message that was already sent before it.
    for (let i = 1; i < foundIds.length; i++) {
      expect(foundIds[i]).toBeGreaterThanOrEqual(foundIds[i - 1]);
    }
    for (let i = 1; i < endedIds.length; i++) {
      expect(endedIds[i]).toBeGreaterThanOrEqual(endedIds[i - 1]);
    }

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });
});
