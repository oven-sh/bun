import { Subprocess, spawn, write } from "bun";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { debuggerInternals } from "bun:internal-for-testing";
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
});

// The two describe blocks below replace a prior single regression test that
// spawned with `--inspect-wait=unix:` and asserted on backpressure-order
// behavior. That transport routes through Debugger#connectOverSocket, which
// talks to the backend through a plain `{ write, close }` object whose
// `write` always returns `true` (see src/js/internal/debugger.ts) -- it
// never goes anywhere near `webSocketWriter`/`bufferedWriter`, so that test
// provided zero coverage of the writer-layer fix despite its title. Only
// `--inspect`'s `ws:`/`ws+unix:` transport (Bun.serve's `#websocket` handler)
// constructs a `bufferedWriter(webSocketWriter(ws))` client. The blocks below
// cover the real implementations instead: scripted unit tests for the
// pacing/ordering/retry logic, plus a real `ws://` connection proving the
// production wiring delivers events correctly end to end.

// A local mirror of debugger.ts's private `WriteResult` union, purely for
// typing the scripts fed to `scriptedWriter` below -- there is nothing to
// import, since builtin modules only expose their single default export
// (see debugger.ts's `testHooks` and this file's use of it).
type WriteResult = "success" | "backpressure" | "dropped";

/**
 * A scripted stand-in for the raw `Writer` that `bufferedWriter()` wraps (in
 * production, `webSocketWriter(ws)`). `results` is consumed in FIFO order,
 * one entry per `write()` call. `calls` records every message actually
 * handed to the underlying writer, in the order it was handed over, so tests
 * can assert exactly what reached "the wire" and when -- which is precisely
 * what the ordering bug (a queued message getting overtaken by a later
 * direct write) would otherwise hide.
 */
function scriptedWriter(results: WriteResult[]) {
  const calls: string[] = [];
  let next = 0;
  const close = mock(() => {});
  return {
    calls,
    close,
    writer: {
      write: (message: string): WriteResult => {
        calls.push(message);
        const result = results[next++];
        if (result === undefined) {
          throw new Error(`scriptedWriter: no scripted result for call #${next} ("${message}")`);
        }
        return result;
      },
      close,
    },
  };
}

describe("writer layer: bufferedWriter / webSocketWriter (unit)", () => {
  // These drive the REAL implementations from src/js/internal/debugger.ts
  // (via `bun:internal-for-testing`'s `debuggerInternals`), not a
  // reimplementation in this file -- a regression in the shipped code is
  // what makes these fail, not drift between two copies of the same logic.
  const { webSocketWriter, bufferedWriter } = debuggerInternals;

  describe("webSocketWriter", () => {
    test("maps ws.sendText()'s tri-state contract to WriteResult", () => {
      const sendText = mock((_message: string) => 0);
      const close = mock(() => {});
      const fakeWs = { sendText, close } as unknown as Parameters<typeof webSocketWriter>[0];
      const writer = webSocketWriter(fakeWs);

      sendText.mockReturnValueOnce(-1);
      expect(writer.write("m")).toBe("backpressure");

      sendText.mockReturnValueOnce(0);
      expect(writer.write("m")).toBe("dropped");

      sendText.mockReturnValueOnce(17);
      expect(writer.write("m")).toBe("success");

      expect(sendText).toHaveBeenCalledTimes(3);

      writer.close();
      expect(close).toHaveBeenCalledTimes(1);
    });
  });

  describe("bufferedWriter", () => {
    test("paces (queues) subsequent writes after backpressure, without resending the backpressured message", () => {
      const { calls, writer } = scriptedWriter(["backpressure", "success"]);
      const client = bufferedWriter(writer);

      // Queued/paced writes always report "success" to the caller -- the
      // caller (the debugger's message-fan-out loop) has no retry logic of
      // its own; bufferedWriter owns delivery from here.
      expect(client.write("m1")).toBe("success");
      expect(calls).toEqual(["m1"]); // attempted once

      expect(client.write("m2")).toBe("success");
      expect(calls).toEqual(["m1"]); // m2 paced behind m1, not sent yet

      client.drain!();
      // m1 is never resent (it was already accepted by uWS -- resending
      // would duplicate it on the wire); m2 flushes once, in order.
      expect(calls).toEqual(["m1", "m2"]);
    });

    test("requeues a dropped write, and blocks a later write from overtaking it on the wire (ordering fix)", () => {
      const { calls, writer } = scriptedWriter(["dropped", "success", "success"]);
      const client = bufferedWriter(writer);

      expect(client.write("m1")).toBe("success");
      expect(calls).toEqual(["m1"]); // dropped -- queued for retry

      // Regression coverage for the ordering bug: a "dropped" result queues
      // the message but does not set the `paced` flag. Without also gating
      // direct writes on `pendingMessages.length > 0`, this write would go
      // straight to the underlying writer and land on the wire BEFORE m1's
      // still-queued retry.
      expect(client.write("m2")).toBe("success");
      expect(calls).toEqual(["m1"]); // m2 must be queued too, not written directly

      client.drain!();
      // m1's retry flushes first, then m2 -- m2 can never overtake m1.
      expect(calls).toEqual(["m1", "m1", "m2"]);
    });

    test("clears pendingMessages after a fully successful drain (no stale resend)", () => {
      const { calls, writer } = scriptedWriter(["dropped", "success"]);
      const client = bufferedWriter(writer);

      client.write("m1");
      client.drain!();
      expect(calls).toEqual(["m1", "m1"]);

      // A second drain with nothing pending must not touch the underlying
      // writer at all -- if pendingMessages weren't cleared after the first
      // drain, this would resend "m1" a third time.
      client.drain!();
      expect(calls).toEqual(["m1", "m1"]);
    });

    test("drain() preserves order across repeated drops/backpressure partway through the queue", () => {
      const { calls, writer } = scriptedWriter([
        "dropped", // a (initial write)
        "dropped", // a (drain #1)
        "backpressure", // a (drain #2)
        "success", // b (drain #3)
        "success", // c (drain #3)
      ]);
      const client = bufferedWriter(writer);

      client.write("a"); // dropped -> queued: [a]
      client.write("b"); // queued behind a (pendingMessages.length > 0): [a, b]
      client.write("c"); // queued behind a, b: [a, b, c]
      expect(calls).toEqual(["a"]);

      client.drain!(); // a: dropped again -> stop, keep [a, b, c] for next drain
      expect(calls).toEqual(["a", "a"]);

      client.drain!(); // a: backpressure -> pace, keep [b, c] for next drain
      expect(calls).toEqual(["a", "a", "a"]);

      client.drain!(); // b: success, c: success -> fully flushed, queue cleared
      expect(calls).toEqual(["a", "a", "a", "b", "c"]);

      client.drain!(); // nothing pending -- no-op
      expect(calls).toEqual(["a", "a", "a", "b", "c"]);
    });

    test("close() clears the pending queue and delegates to the underlying writer's close()", () => {
      const { calls, close, writer } = scriptedWriter(["dropped"]);
      const client = bufferedWriter(writer);

      client.write("a");
      expect(calls).toEqual(["a"]);

      client.close();
      expect(close).toHaveBeenCalledTimes(1);

      // Nothing left to flush -- drain() (if it were ever called on a
      // closing connection) must not resend "a".
      client.drain!();
      expect(calls).toEqual(["a"]);
    });
  });

  describe("webSocketWriter + bufferedWriter together", () => {
    test("end-to-end: a dropped CDP message can never be overtaken by the next one, through the real ws.sendText() mapping", () => {
      const sendText = mock((_message: string) => 0);
      sendText.mockReturnValueOnce(0); // DROPPED for "m1"
      sendText.mockReturnValueOnce(20); // SUCCESS retrying "m1"
      sendText.mockReturnValueOnce(20); // SUCCESS for "m2"
      const fakeWs = { sendText, close: mock(() => {}) } as unknown as Parameters<typeof webSocketWriter>[0];

      const client = bufferedWriter(webSocketWriter(fakeWs));

      client.write("m1");
      client.write("m2");
      expect(sendText).toHaveBeenCalledTimes(1); // only m1 attempted so far
      expect(sendText).toHaveBeenNthCalledWith(1, "m1");

      client.drain!();
      expect(sendText).toHaveBeenCalledTimes(3);
      expect(sendText).toHaveBeenNthCalledWith(2, "m1");
      expect(sendText).toHaveBeenNthCalledWith(3, "m2");
    });
  });
});

describe("writer layer: ws:// integration", () => {
  let proc: Subprocess | undefined;
  let ws: WebSocket | undefined;

  afterEach(() => {
    ws?.close();
    ws = undefined;
    proc?.kill();
    proc = undefined;
  });

  test(
    "delivers every TestReporter event exactly once, in order, over a real ws:// connection",
    async () => {
      // Unlike the unix-socket test above, `--inspect-wait=ws://` serves over
      // a real Bun.serve WebSocket (Debugger#websocket), which IS backed by
      // `bufferedWriter(webSocketWriter(ws))` -- this exercises that real
      // pipeline end to end over an actual socket, rather than the scripted
      // mocks above.
      //
      // This does NOT force genuine backpressure or a genuine drop: the
      // global `WebSocket` client used here (matching the rest of this
      // suite's ws:// tests, e.g. test/regression/issue/21654) has no public
      // API to pause reading the underlying socket the way a raw
      // `Bun.connect()` client can, so uWS's outbound buffer never has a
      // reason to back up. Forcing a genuine DROPPED additionally needs
      // upward of 16MB of unacknowledged backlog -- the debugger's
      // `#websocket` handler sets no `backpressureLimit`, so uWS falls back
      // to its 16MB default (see WebSocketServerContext.rs's
      // `backpressure_limit` default). Neither is a clean, fast, reliable
      // hook to build a test around, so both scenarios are instead covered
      // deterministically by the scripted-writer unit tests above; this
      // test's job is just to prove the real production wiring delivers
      // every event exactly once, in order, over an actual connection.

      const TEST_COUNT = 200;
      const testFileLines = [`import { test, expect } from "bun:test";`];
      for (let i = 0; i < TEST_COUNT; i++) {
        testFileLines.push(`test("ws order test ${i}", () => { expect(${i}).toBe(${i}); });`);
      }

      using dir = tempDir("test-reporter-ws-order", {
        "ws-order.test.ts": testFileLines.join("\n"),
      });

      proc = spawn({
        cmd: [bunExe(), "--inspect-wait=ws://127.0.0.1:0/", "test", "ws-order.test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "ignore",
        stderr: "pipe",
      });

      // Scan complete stderr lines for the inspector URL banner instead of a
      // fixed sleep -- an observable handshake, not a wall-clock guess.
      let stderrBuf = "";
      let stderrLineBuf = "";
      const { promise: urlPromise, resolve: urlResolve, reject: urlReject } = Promise.withResolvers<URL>();
      let urlFound = false;
      (async () => {
        const decoder = new TextDecoder();
        for await (const chunk of proc!.stderr as ReadableStream<Uint8Array>) {
          const text = decoder.decode(chunk);
          stderrBuf += text;
          if (urlFound) continue;
          stderrLineBuf += text;
          const lines = stderrLineBuf.split("\n");
          stderrLineBuf = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const u = new URL(trimmed);
              if (u.protocol === "ws:" || u.protocol === "wss:") {
                urlFound = true;
                urlResolve(u);
                break;
              }
            } catch {
              // Not a URL -- ignore.
            }
          }
        }
        if (!urlFound) {
          urlReject(new Error(`Inspector URL not found before child stderr closed: ${JSON.stringify(stderrBuf)}`));
        }
      })().catch(err => {
        if (!urlFound) urlReject(err);
      });

      const url = await urlPromise;
      ws = new WebSocket(url);
      await new Promise<void>((resolve, reject) => {
        ws!.addEventListener("open", () => resolve(), { once: true });
        ws!.addEventListener("error", e => reject(new Error("WebSocket error", { cause: e })), { once: true });
        ws!.addEventListener("close", e => reject(new Error("WebSocket closed", { cause: e })), { once: true });
      });

      const BARRIER_ID = 1;
      let barrierSent = false;
      const foundIds: number[] = [];
      const endedIds: number[] = [];
      const { promise: donePromise, resolve: doneResolve, reject: doneReject } = Promise.withResolvers<void>();

      const send = (method: string, params: Record<string, unknown> = {}, id = 0) =>
        ws!.send(JSON.stringify({ id, method, params }));

      ws.addEventListener("message", ev => {
        const msg = JSON.parse(String(ev.data));
        if (msg.method === "TestReporter.found") {
          foundIds.push(msg.params.id);
        } else if (msg.method === "TestReporter.end") {
          endedIds.push(msg.params.id);
          // Don't resolve directly on the 200th end event -- send a barrier
          // command and wait for its response instead, so any duplicate
          // event still queued behind it is observed before we assert.
          if (endedIds.length === TEST_COUNT && !barrierSent) {
            barrierSent = true;
            send("Runtime.enable", {}, BARRIER_ID);
          }
        } else if (msg.method === undefined && msg.id === BARRIER_ID) {
          doneResolve();
        }
      });
      // The child exits as soon as the last test ends, so the socket can
      // close before the barrier response round-trips. Either signal proves
      // the full stream was observed: the barrier RESPONSE (nothing else was
      // queued behind the final end), or socket close/error after the final
      // end (the stream is definitively over -- every message the child sent,
      // including any duplicate delivery, is dispatched before the close
      // event fires). A close/error while events are still missing instead
      // fails fast with a descriptive error rather than an opaque per-test
      // timeout. Both are no-ops once donePromise has settled.
      const onSocketDown = () => {
        if (endedIds.length >= TEST_COUNT) {
          doneResolve();
        } else {
          doneReject(
            new Error(`socket closed before barrier response: found=${foundIds.length} ended=${endedIds.length} of ${TEST_COUNT}`),
          );
        }
      };
      ws.addEventListener("close", onSocketDown);
      ws.addEventListener("error", onSocketDown);

      send("Inspector.enable");
      send("TestReporter.enable");
      send("Inspector.initialized");

      await donePromise;

      // Exactly one `found`/`end` per test -- no message was silently
      // dropped, and none was duplicated by a resend of an already-accepted
      // (backpressured) write.
      expect(foundIds.length).toBe(TEST_COUNT);
      expect(new Set(foundIds).size).toBe(TEST_COUNT);
      expect(endedIds.length).toBe(TEST_COUNT);
      expect(new Set(endedIds).size).toBe(TEST_COUNT);

      // Ids arrive in non-decreasing order: a paced/queued message is never
      // flushed ahead of a message that was already sent before it.
      for (let i = 1; i < foundIds.length; i++) {
        expect(foundIds[i]).toBeGreaterThanOrEqual(foundIds[i - 1]);
      }
      for (let i = 1; i < endedIds.length; i++) {
        expect(endedIds[i]).toBeGreaterThanOrEqual(endedIds[i - 1]);
      }

      ws.close();
      ws = undefined;

      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        // Surface the captured child stderr (the URL-scanning loop above
        // drains the stream into stderrBuf for the child's whole lifetime)
        // so a nonzero exit fails with the child's own error output.
        expect(stderrBuf).toBe("");
      }
      expect(exitCode).toBe(0);
    },
    30000,
  );
});
