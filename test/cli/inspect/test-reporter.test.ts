import { spawn, type Subprocess } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "node:path";
import type { JSC } from "../../../packages/bun-inspector-protocol/src/protocol/jsc";
import { InspectorSession, connect } from "./junit-reporter";
import { SocketFramer } from "./socket-framer";

/**
 * Drives one `bun --inspect-wait test <file>` child over the inspector protocol.
 *
 * Every TestReporter event is recorded in arrival order and never deduplicated,
 * so a repeated id shows up as a repeated entry.
 *
 * The fixtures hold at "gates", each an `await stdin.read()`. The parent opens
 * the first gate with a write to the child's stdin and the last one by closing
 * it. A parent that dies closes stdin too, so the child never outlives it.
 */
class TestReporterSession extends InspectorSession implements AsyncDisposable {
  readonly found: JSC.TestReporter.FoundEvent[] = [];
  readonly started: number[] = [];
  readonly ended: JSC.TestReporter.EndEvent[] = [];
  readonly consoleMessages: string[] = [];
  readonly stdout: Promise<string>;
  readonly stderr: Promise<string>;
  /** Rejects once the child exits. Every wait races against it. */
  readonly exited: Promise<never>;
  readonly #checks = new Set<() => void>();

  private constructor(readonly proc: Subprocess<"pipe", "pipe", "pipe">) {
    super();
    this.stdout = proc.stdout.text();
    this.stderr = proc.stderr.text();
    this.exited = proc.exited.then(code => this.#fail(`The child exited with code ${code} while a wait was pending`));
    this.exited.catch(() => {});
    this.addEventListener("TestReporter.found", params => this.#record(this.found, params));
    this.addEventListener("TestReporter.start", params => this.#record(this.started, params.id));
    this.addEventListener("TestReporter.end", params => this.#record(this.ended, params));
    this.addEventListener("Console.messageAdded", params => this.#record(this.consoleMessages, params.message.text));
  }

  /**
   * Listens on a unix socket inside `dir`, spawns `bun --inspect-wait test <testFile>`
   * with `dir` as cwd, and resolves once the child has connected. The child then
   * blocks until it receives `Inspector.initialized`.
   */
  static async start(dir: string, testFile: string): Promise<TestReporterSession> {
    const socketPath = join(dir, "inspector.sock");
    const connected = connect(`unix://${socketPath}`);
    const proc = spawn({
      // --timeout keeps the fixture tests' budget above the 30s waits in this file, so
      // a test that is held at a gate cannot time out before the gate opens under load.
      cmd: [bunExe(), `--inspect-wait=unix:${socketPath}`, "test", "--timeout", "60000", testFile],
      env: bunEnv,
      cwd: dir,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const session = new TestReporterSession(proc);
    const socket = await Promise.race([connected, session.exited]);
    const framer = new SocketFramer(message => session.onMessage(message));
    session.socket = socket;
    session.framer = framer;
    socket.data = { onData: framer.onData.bind(framer) };
    return session;
  }

  /**
   * Resolves once `condition()` holds. Rejects with the events received so far
   * and the child's output if the child exits first or `what` takes over 30s.
   */
  waitFor(what: string, condition: () => boolean): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const check = () => {
      if (condition()) resolve();
    };
    const timer = setTimeout(() => this.#fail(`Timed out waiting for ${what}`).catch(reject), 30_000);
    this.#checks.add(check);
    check();
    return Promise.race([promise, this.exited]).finally(() => {
      clearTimeout(timer);
      this.#checks.delete(check);
    });
  }

  /** Opens the fixture's first gate. */
  async openGate() {
    this.proc.stdin.write("go");
    await this.proc.stdin.flush();
  }

  /** Opens the fixture's last gate: its pending read sees EOF. */
  async openLastGate() {
    await this.proc.stdin.end();
  }

  async [Symbol.asyncDispose]() {
    this.socket?.end();
    await this.proc[Symbol.asyncDispose]();
  }

  #record<T>(list: T[], item: T) {
    list.push(item);
    for (const check of this.#checks) check();
  }

  /** Throws `why`, followed by the events received so far and the child's whole output. */
  async #fail(why: string): Promise<never> {
    // A no-op if the child has exited. Otherwise its output would never end.
    this.proc.kill();
    const [stdout, stderr] = await Promise.all([this.stdout, this.stderr]);
    const seen = { found: this.found, started: this.started, ended: this.ended, console: this.consoleMessages };
    throw new Error(`${why}\n${JSON.stringify(seen, null, 2)}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
}

/** Replaces the temp dir in each event's `url` so the tree compares with `toEqual`. */
function normalizeFound(found: JSC.TestReporter.FoundEvent[], dir: string): JSC.TestReporter.FoundEvent[] {
  return found.map(event => ({ ...event, url: event.url && normalizeBunSnapshot(event.url, dir) }));
}

/** The child's stderr, normalized, for a fixture whose three tests all pass. */
function expectedStderr(testFile: string) {
  return [
    `${testFile}:`,
    "--------------------- Bun Inspector ---------------------",
    "Listening on unix:<dir>/inspector.sock",
    "--------------------- Bun Inspector ---------------------",
    "(pass) suite A > test A1",
    "(pass) suite A > test A2",
    "(pass) suite B > test B1",
    "",
    " 3 pass",
    " 0 fail",
    " 3 expect() calls",
    "Ran 3 tests across 1 file.",
  ].join("\n");
}

describe.if(isPosix)("TestReporter inspector protocol", () => {
  test.concurrent(
    "retroactively reports tests when TestReporter.enable is called after tests are discovered",
    async () => {
      // TestReporter.enable is sent only after test A1 has started (observed through
      // Console.messageAdded), so every `found` event comes from the retroactive walk
      // over the already-discovered tree.
      //
      // A1 holds at a gate until those `found` events have arrived. That proves the
      // enable was processed on the JS thread before A1's `end` event, instead of
      // racing with the cross-thread dispatch of the command.
      //
      // The afterAll hook holds at a second gate until every `end` event has arrived.
      // Inspector events are written to the socket from the debugger thread, and the
      // runner exits right after the last test without draining that queue, so
      // without the hold the final `end` events can be lost.
      using dir = tempDir("test-reporter-delayed-enable", {
        "delayed.test.ts": `
import { afterAll, describe, test, expect } from "bun:test";
const stdin = Bun.stdin.stream().getReader();

describe("suite A", () => {
  test("test A1", async () => {
    console.log("__A1_RUNNING__");
    await stdin.read();
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
  await stdin.read();
});
`,
      });
      await using session = await TestReporterSession.start(String(dir), "delayed.test.ts");

      session.send("Inspector.enable");
      session.send("Console.enable");
      session.send("Inspector.initialized");
      await session.waitFor("test A1 to start", () => session.consoleMessages.includes("__A1_RUNNING__"));

      session.send("TestReporter.enable");
      await session.waitFor("5 found events", () => session.found.length >= 5);

      // The retroactive path does not capture source lines, so `line` is 0 here.
      const url = "<dir>/delayed.test.ts";
      expect(normalizeFound(session.found, String(dir))).toEqual([
        { id: 1, url, line: 0, name: "suite A", type: "describe" },
        { id: 2, url, line: 0, name: "test A1", type: "test", parentId: 1 },
        { id: 3, url, line: 0, name: "test A2", type: "test", parentId: 1 },
        { id: 4, url, line: 0, name: "suite B", type: "describe" },
        { id: 5, url, line: 0, name: "test B1", type: "test", parentId: 4 },
      ]);

      await session.openGate();
      await session.waitFor("3 end events", () => session.ended.length >= 3);

      // A1 started before the agent was enabled, so only A2 and B1 report a start.
      expect(session.started).toEqual([3, 5]);
      expect(session.ended).toEqual([
        { id: 2, status: "pass", elapsed: expect.any(Number) },
        { id: 3, status: "pass", elapsed: expect.any(Number) },
        { id: 5, status: "pass", elapsed: expect.any(Number) },
      ]);
      for (const { elapsed } of session.ended) expect(elapsed).toBeGreaterThanOrEqual(0);

      await session.openLastGate();
      const [stdout, stderr, exitCode] = await Promise.all([session.stdout, session.stderr, session.proc.exited]);
      expect(normalizeBunSnapshot(stdout, String(dir))).toBe("bun test <version> (<revision>)\n__A1_RUNNING__");
      expect(normalizeBunSnapshot(stderr, String(dir))).toBe(expectedStderr("delayed.test.ts"));
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent("assigns unique test IDs when TestReporter.enable lands mid-collection", async () => {
    // The live registration path (ScopeFunctions) and the retroactive walk used to
    // draw ids from two independent counters. The test above enables TestReporter
    // only after collection finishes, so the two paths never interleave there.
    //
    // Here collection pauses inside suite B's async describe callback. Suite A's
    // callback has already run to completion (registering A1 and A2), while suite
    // B's own test() has not been called yet. Enabling TestReporter in that window
    // reports suite A, A1, A2 and suite B through the retroactive walk. Test B1 is
    // registered live once the gate opens.
    using dir = tempDir("test-reporter-mid-collection", {
      "mid-collection.test.ts": `
import { afterAll, describe, test, expect } from "bun:test";
const stdin = Bun.stdin.stream().getReader();

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
  await stdin.read();
  test("test B1", () => {
    expect(3).toBe(3);
  });
});

afterAll(async () => {
  await stdin.read();
});
`,
    });
    await using session = await TestReporterSession.start(String(dir), "mid-collection.test.ts");

    session.send("Inspector.enable");
    session.send("Console.enable");
    session.send("Inspector.initialized");
    await session.waitFor("the collection checkpoint", () =>
      session.consoleMessages.includes("__COLLECTION_CHECKPOINT__"),
    );

    session.send("TestReporter.enable");
    await session.waitFor("4 found events", () => session.found.length >= 4);

    const url = "<dir>/mid-collection.test.ts";
    const retroactive: JSC.TestReporter.FoundEvent[] = [
      { id: 1, url, line: 0, name: "suite A", type: "describe" },
      { id: 2, url, line: 0, name: "test A1", type: "test", parentId: 1 },
      { id: 3, url, line: 0, name: "test A2", type: "test", parentId: 1 },
      { id: 4, url, line: 0, name: "suite B", type: "describe" },
    ];
    expect(normalizeFound(session.found, String(dir))).toEqual(retroactive);

    // Test B1 is registered live while the agent is enabled. Its id must continue
    // the sequence the retroactive walk used, and the live path reports its line.
    await session.openGate();
    await session.waitFor("5 found events", () => session.found.length >= 5);
    expect(normalizeFound(session.found, String(dir))).toEqual([
      ...retroactive,
      { id: 5, url, line: 17, name: "test B1", type: "test", parentId: 4 },
    ]);

    await session.waitFor("3 end events", () => session.ended.length >= 3);
    expect(session.started).toEqual([2, 3, 5]);
    expect(session.ended).toEqual([
      { id: 2, status: "pass", elapsed: expect.any(Number) },
      { id: 3, status: "pass", elapsed: expect.any(Number) },
      { id: 5, status: "pass", elapsed: expect.any(Number) },
    ]);
    for (const { elapsed } of session.ended) expect(elapsed).toBeGreaterThanOrEqual(0);

    await session.openLastGate();
    const [stdout, stderr, exitCode] = await Promise.all([session.stdout, session.stderr, session.proc.exited]);
    expect(normalizeBunSnapshot(stdout, String(dir))).toBe(
      "bun test <version> (<revision>)\n__COLLECTION_CHECKPOINT__",
    );
    expect(normalizeBunSnapshot(stderr, String(dir))).toBe(expectedStderr("mid-collection.test.ts"));
    expect(exitCode).toBe(0);
  });
});
