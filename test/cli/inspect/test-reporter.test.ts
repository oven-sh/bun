import { Subprocess, spawn, write } from "bun";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
import net from "node:net";
import { join } from "node:path";
import { OP, RawClient } from "../../js/web/websocket/raw-peer";
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
  let proc: Subprocess<"ignore", "pipe", "pipe"> | undefined;
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
});

// https://github.com/oven-sh/bun/issues/34218
describe.concurrent("inspector events written before the process exits", () => {
  type Frontend = "ws" | "unix";

  // The runner does not unwind a test it times out; killing that test's child ends every wait it is still in.
  const children = new Set<Subprocess>();
  afterAll(() => children.forEach(child => child.kill()));

  // Collects the child's stderr and resolves each `waitFor` once a match appears; rejects it once stderr has ended
  // or failed without one, including a `waitFor` that starts after that.
  function watchStderr(child: Subprocess<"ignore" | "pipe", "ignore", "pipe">) {
    let text = "";
    let end: { error?: unknown } | undefined;
    const waiters: { pattern: RegExp; resolve: (match: RegExpMatchArray) => void; reject: (error: Error) => void }[] =
      [];
    const check = () => {
      for (let i = waiters.length - 1; i >= 0; i--) {
        const { pattern, resolve, reject } = waiters[i];
        const match = text.match(pattern);
        if (match) resolve(match);
        else if (end)
          reject(new Error(`stderr ${end.error ? `failed (${end.error})` : "ended"} without ${pattern}:\n${text}`));
        else continue;
        waiters.splice(i, 1);
      }
    };
    const ended = (async () => {
      const decoder = new TextDecoder();
      try {
        for await (const chunk of child.stderr) {
          text += decoder.decode(chunk, { stream: true });
          check();
        }
        text += decoder.decode();
        end = {};
      } catch (error) {
        end = { error };
      }
      check();
      if (end.error) throw end.error;
    })();
    // Awaited at the end of a run; a run that fails before then must not leave an unhandled rejection.
    ended.catch(() => {});
    return {
      ended,
      get text() {
        return text;
      },
      waitFor(pattern: RegExp) {
        const { promise, resolve, reject } = Promise.withResolvers<RegExpMatchArray>();
        promise.catch(() => {});
        waiters.push({ pattern, resolve, reject });
        check();
        return promise;
      },
    };
  }
  type Stderr = ReturnType<typeof watchStderr>;

  // The runner prints it just before it exits.
  const summary = /Ran \d+ tests across 1 file\./;

  /** Rejects `failed` once anything ends the run early; every wait in the run goes through `unlessFailed`. */
  function failurePath() {
    const failed = Promise.withResolvers<never>();
    failed.promise.catch(() => {});
    return {
      fail: (error: unknown) => failed.reject(error),
      unlessFailed: <T>(promise: Promise<T>) => Promise.race([promise, failed.promise]),
    };
  }
  type FailurePath = ReturnType<typeof failurePath>;

  function spawnInspected(dir: string, inspect: string, testFile: string, stdin: "ignore" | "pipe") {
    return spawn({
      cmd: [bunExe(), `--inspect-wait=${inspect}`, "test", testFile],
      env: { ...bunEnv, BUN_TEST_DRAIN_EVENT_LOOP: undefined },
      cwd: dir,
      stdin,
      stdout: "ignore",
      stderr: "pipe",
    });
  }

  /** Watches `child`'s stderr, and fails the run if the child exits before the summary. */
  function observe(child: Subprocess<"ignore" | "pipe", "ignore", "pipe">, { fail }: FailurePath) {
    children.add(child);
    const stderr = watchStderr(child);
    child.exited
      .then(async code => {
        children.delete(child);
        await stderr.ended.catch(() => {});
        if (!summary.test(stderr.text)) fail(new Error(`exited with ${code} before the summary:\n${stderr.text}`));
      })
      .catch(fail);
    return stderr;
  }

  /** A RawClient that hands each frame to `onFrame` as soon as it is complete, and keeps none of them. */
  class FrameCountingClient extends RawClient {
    onFrame = (_head: number, _payload: Buffer) => {};
    #chunks: Buffer[] = [];
    #size = 0;
    #needed = 2;

    override push(chunk: Buffer) {
      this.#chunks.push(chunk);
      this.#size += chunk.length;
      if (this.#size < this.#needed) return;
      let buffer = this.#chunks.length === 1 ? chunk : Buffer.concat(this.#chunks);
      for (;;) {
        this.#needed = 2;
        if (buffer.length < 2) break;
        let length = buffer[1] & 127;
        let offset = 2;
        if (length === 126) {
          if (buffer.length < 4) break;
          length = buffer.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (buffer.length < 10) break;
          length = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }
        this.#needed = offset + length;
        if (buffer.length < this.#needed) break;
        this.onFrame(buffer[0], buffer.subarray(offset, offset + length));
        buffer = buffer.subarray(offset + length);
      }
      this.#chunks = buffer.length ? [buffer] : [];
      this.#size = buffer.length;
    }
  }

  /** Connects to the WebSocket URL the child prints, with `onFrame` set before any frame can arrive. */
  async function connectWs(
    stderr: Stderr,
    { fail, unlessFailed }: FailurePath,
    onFrame: (head: number, payload: Buffer) => void,
  ) {
    // The URL ends at whitespace or an escape: a chunk boundary must not cut it short.
    const [, url] = await unlessFailed(stderr.waitFor(/(ws:\/\/[^\s\x1b]+)[\s\x1b]/));
    const { port, pathname } = new URL(url);
    const client = new FrameCountingClient(Number(port), { path: pathname });
    client.onFrame = onFrame;
    client.socket.on("error", fail);
    try {
      const { status } = await unlessFailed(client.response);
      if (!status.startsWith("HTTP/1.1 101 ")) throw new Error(`upgrade failed: ${status}\n${stderr.text}`);
      return client;
    } catch (error) {
      client.destroy();
      throw error;
    }
  }

  /** Records the TestReporter and Console events it is handed, as messages or as WebSocket frames. */
  function eventRecorder({ fail, unlessFailed }: FailurePath) {
    const found: number[] = [];
    const ended: number[] = [];
    let consoleMessages = 0;
    const onMessage = (message: string) => {
      let method, params;
      try {
        ({ method, params } = JSON.parse(message));
      } catch (error) {
        return fail(error);
      }
      if (method === "TestReporter.found" && params.type === "test") found.push(params.id);
      else if (method === "TestReporter.end") ended.push(params.id);
      else if (method === "Console.messageAdded") consoleMessages++;
    };
    return {
      onMessage,
      onFrame(head: number, payload: Buffer) {
        if (head === (0x80 | OP.text)) onMessage(payload.toString());
      },
      async result(child: Subprocess, stderr: Stderr) {
        await unlessFailed(stderr.ended);
        const exitCode = await unlessFailed(child.exited);
        return {
          found,
          ended,
          consoleMessages,
          summary: stderr.text.match(summary)?.[0],
          exitCode,
          signalCode: child.signalCode,
        };
      },
    };
  }

  /**
   * Runs `count` synchronous tests that each log `payloadSize` bytes, under `--inspect-wait` with a raw frontend
   * that enables TestReporter and Console, then reads nothing until the run summary is on stderr, which the runner
   * prints just before it exits.
   */
  async function run(frontend: Frontend, { count, payloadSize }: Flood) {
    using dir = tempDir("inspector-exit-flush", {
      "flood.test.ts": `
import { test } from "bun:test";
const payload = Buffer.alloc(${payloadSize}, "x").toString();
for (let i = 0; i < ${count}; i++) test("t" + i, () => { console.log(i, payload); });
`,
    });
    const failure = failurePath();
    const { fail, unlessFailed } = failure;

    const socketPath = join(String(dir), "inspector.sock");
    const accepted = Promise.withResolvers<{ socket: net.Socket; closed: Promise<unknown> }>();
    const sockets: net.Socket[] = [];
    await using server =
      frontend === "unix"
        ? net.createServer(socket => {
            sockets.push(socket);
            const closed = new Promise(resolve => socket.on("error", fail).once("close", resolve).pause());
            accepted.resolve({ socket, closed });
          })
        : undefined;
    // Before the server's dispose, which waits for its connections to end.
    using _ = { [Symbol.dispose]: () => sockets.forEach(socket => socket.destroy()) };
    if (server) {
      server.on("error", fail);
      await unlessFailed(new Promise<void>(resolve => server.listen(socketPath, resolve)));
    }

    const inspect = frontend === "unix" ? `unix:${socketPath}` : "ws://127.0.0.1:0/exit-flush";
    await using child = spawnInspected(String(dir), inspect, "flood.test.ts", "ignore");
    const stderr = observe(child, failure);
    const recorder = eventRecorder(failure);
    const handshake = ["Inspector.enable", "TestReporter.enable", "Console.enable", "Inspector.initialized"].map(
      (method, id) => JSON.stringify({ id, method }),
    );

    if (frontend === "unix") {
      const { socket, closed } = await unlessFailed(accepted.promise);
      const framer = new SocketFramer(recorder.onMessage);
      for (const message of handshake) framer.send(socket, message);
      await unlessFailed(stderr.waitFor(summary));
      socket.on("data", data => framer.onData(socket, data)).resume();
      await unlessFailed(closed);
    } else {
      using client = await connectWs(stderr, failure, recorder.onFrame);
      client.socket.pause();
      for (const message of handshake) client.text(message);
      await unlessFailed(stderr.waitFor(summary));
      client.socket.resume();
      await unlessFailed(client.closed);
    }
    return recorder.result(child, stderr);
  }

  type Flood = { count: number; payloadSize: number };

  // Far more than the kernel buffers for a peer that is not reading, so most of it is still in the debugger thread's
  // user-space buffers when the runner exits. Loopback TCP holds at most a few MiB (Linux's tcp_wmem plus tcp_rmem
  // maxima, 4 + 6 MiB by default; macOS caps each socket buffer at 4 MiB). The ws flood is also over uWS's 16 MiB
  // backpressure limit, so a debugger thread that keeps up with the run queues frames itself. A unix socket holds far
  // less (Linux's wmem_default is 208 KiB, macOS's net.local.stream buffers 8 KiB).
  const floods: Record<Frontend, Flood> = {
    ws: { count: 160, payloadSize: 256 * 1024 },
    unix: { count: 64, payloadSize: 32 * 1024 },
  };

  async function expectEveryEvent(frontend: Frontend) {
    const flood = floods[frontend];
    const result = await run(frontend, flood);
    expect(result).toEqual({
      found: expect.any(Array),
      ended: result.found,
      consoleMessages: flood.count,
      summary: `Ran ${flood.count} tests across 1 file.`,
      exitCode: 0,
      signalCode: null,
    });
    expect(result.found).toHaveLength(flood.count);
  }

  test("a frontend that reads only after the run gets every event (ws)", () => expectEveryEvent("ws"));

  // On Windows a node:net path names a named pipe (https://nodejs.org/api/net.html#identifying-paths-for-ipc-connections).
  test.skipIf(!isPosix)("a frontend that reads only after the run gets every event (unix)", () =>
    expectEveryEvent("unix"),
  );

  // The run's last events are still waiting for the debugger thread when the runner exits: the frontend sends all but
  // the last fragment of a large message, waits for the Pong that shows the debugger thread has taken it, then sends
  // that fragment just as it lets the tests start, and the debugger thread is busy with the message until they end.
  test("a frontend gets the events of tests that end while the debugger thread is busy", async () => {
    using dir = tempDir("inspector-exit-flush", {
      "quick.test.ts": `
import { beforeAll, test } from "bun:test";
beforeAll(() => Bun.stdin.text());
for (let i = 0; i < 5; i++) test("t" + i, () => {});
`,
    });
    const failure = failurePath();
    const { unlessFailed } = failure;
    await using child = spawnInspected(String(dir), "ws://127.0.0.1:0/exit-flush", "quick.test.ts", "pipe");
    const stderr = observe(child, failure);
    const recorder = eventRecorder(failure);
    const pong = Promise.withResolvers<void>();
    pong.promise.catch(() => {});
    using client = await connectWs(stderr, failure, (head, payload) => {
      if (head === (0x80 | OP.pong)) pong.resolve();
      else recorder.onFrame(head, payload);
    });
    client.closed.then(() =>
      pong.reject(new Error(`the inspector connection closed before the Pong:\n${stderr.text}`)),
    );
    for (const [id, method] of ["Inspector.enable", "TestReporter.enable", "Inspector.initialized"].entries())
      client.text(JSON.stringify({ id, method }));
    // Milliseconds of work for the debugger thread, within its WebSocket server's 16 MiB maxPayloadLength. A method that
    // does not exist only gets an error reply.
    const pad = Buffer.alloc(4 * 1024 * 1024, "x").toString();
    client.text(`{"id":3,"method":"Inspector.pad","params":{"pad":"${pad}"}`, { fin: false });
    client.ping();
    await unlessFailed(pong.promise);
    client.send(OP.continuation, "}");
    child.stdin.end();
    await unlessFailed(client.closed);
    const result = await recorder.result(child, stderr);
    expect(result).toEqual({
      found: expect.any(Array),
      ended: result.found,
      consoleMessages: 0,
      summary: "Ran 5 tests across 1 file.",
      exitCode: 0,
      signalCode: null,
    });
    expect(result.found).toHaveLength(5);
  });
});
