import { Subprocess, listen, spawn, write } from "bun";
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

// Where `TestReporter.found` says a test is. A client can enable the domain before a test is registered or after, and the
// JUnit reporter writes the same place.
describe("TestReporter.found location", () => {
  const files = (name: string) => ({
    // This file has ended when a client enables TestReporter at a gate of the next one.
    "first.test.cjs": `const { test } = require("bun:test");

test("in the first file", () => {});
`,
    [name]: `import { describe, test } from "bun:test";
import { test as nodeTest } from "node:test";
import { defineTest, sharedSuite } from "./helper";
import "./imported";

const stdin = Bun.stdin.stream().getReader();
async function gate(marker: string) {
  console.log(marker);
  await stdin.read();
}

test("gate", () => gate("__EXECUTION__"));

describe("suite", () => {
  const named = "named by a constant";

  test("plain", () => {});
  test(named, () => {});
  test( // on several lines
    "call on several lines",
    () => {},
  );
  test.each([[1], [2]])("row %d", () => {});
  test.each\`
    n
    \${3}
    \${4}
  \`("tagged $n", () => {});
  defineTest("from helper");
  nodeTest("node:test", () => {});
  [5].forEach(n => test("forEach " + n, () => {}));
});

describe("tail call", () => test("in a tail call", () => {}));

describe("shared", sharedSuite);

describe("after the gate", async () => {
  await gate("__COLLECTION__");
  test("registered last", () => {});
});
`,
    "helper.ts": `import { test } from "bun:test";

export function defineTest(name: string) {
  test(name, () => {});
}

export function sharedSuite() {
  test("in shared suite", () => {});
}
`,
    "imported.ts": `import { test } from "bun:test";

test("in an imported module", () => {});
`,
  });
  // The line of the test file that has `text`.
  const lineOf = (text: string) =>
    files("a.test.ts")
      ["a.test.ts"].split("\n")
      .findIndex(line => line.includes(text)) + 1;
  const locations = [
    { type: "test", name: "gate", line: lineOf(`test("gate"`) },
    { type: "describe", name: "suite", line: lineOf(`describe("suite"`) },
    { type: "test", name: "plain", line: lineOf(`test("plain"`) },
    { type: "test", name: "named by a constant", line: lineOf(`test(named`) },
    { type: "test", name: "call on several lines", line: lineOf(`test( // on several lines`) },
    { type: "test", name: "row 1", line: lineOf(`("row %d"`) },
    { type: "test", name: "row 2", line: lineOf(`("row %d"`) },
    // Not a row of the table.
    { type: "test", name: "tagged 3", line: lineOf(`("tagged $n"`) },
    { type: "test", name: "tagged 4", line: lineOf(`("tagged $n"`) },
    // The url is the test file, so the line is that of the call that the test file makes.
    { type: "test", name: "from helper", line: lineOf(`defineTest("from helper")`) },
    { type: "test", name: "node:test", line: lineOf(`nodeTest("node:test"`) },
    { type: "test", name: "forEach 5", line: lineOf(`[5].forEach(`) },
    // The test file has no frame on the stack when these two are registered. They are in a block that it opened.
    { type: "describe", name: "tail call", line: lineOf(`describe("tail call"`) },
    { type: "test", name: "in a tail call", line: lineOf(`describe("tail call"`) },
    { type: "describe", name: "shared", line: lineOf(`describe("shared"`) },
    { type: "test", name: "in shared suite", line: lineOf(`describe("shared"`) },
    { type: "describe", name: "after the gate", line: lineOf(`describe("after the gate"`) },
    { type: "test", name: "registered last", line: lineOf(`test("registered last"`) },
    // Nothing in the test file leads to this call, and it is in no block. The line of "imported.ts" is not a line of the url.
    { type: "test", name: "in an imported module", line: 0 },
  ];
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

  type Enable = "before collection" | "during collection" | "during execution";
  type Debugger = "--inspect-wait" | "--inspect" | "BUN_INSPECT" | "BUN_INSPECT_CONNECT_TO";

  async function run(enable: Enable, debug: Debugger, { file = "location.test.ts", junit = false } = {}) {
    using dir = tempDir("test-reporter-location", files(file));
    const session = new TestReporterSession();
    const framer = new SocketFramer((message: string) => session.onMessage(message));
    const connected = Promise.withResolvers<void>();
    using server = listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          session.socket = socket as any;
          session.framer = framer;
          connected.resolve();
        },
        data: (socket, data) => framer.onData(socket, data),
      },
    });
    const url = `tcp://127.0.0.1:${server.port}`;

    await using proc = spawn({
      cmd: [
        bunExe(),
        ...(debug.startsWith("--") ? [`${debug}=${url}`] : []),
        "test",
        "--timeout",
        "30000",
        ...(junit ? ["--reporter=junit", "--reporter-outfile=junit.xml"] : []),
        "first.test.cjs",
        file,
      ],
      env: debug.startsWith("--") ? bunEnv : { ...bunEnv, [debug]: url },
      cwd: String(dir),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = proc.stderr.text();
    let stdout = "";
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    async function printed(marker: string) {
      while (!stdout.includes(marker)) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`The tests ended before they printed ${marker}:\n${stdout}\n${await stderr}`);
        stdout += decoder.decode(value, { stream: true });
      }
    }

    const exitedFirst = await Promise.race([connected.promise, proc.exited]);
    if (exitedFirst !== undefined) {
      throw new Error(`bun test exited with ${exitedFirst} before it reached the inspector client:\n${await stderr}`);
    }
    session.enableInspector();
    if (enable === "before collection") session.enableTestReporter();
    session.initialize();

    await printed("__COLLECTION__");
    if (enable === "during collection") {
      session.enableTestReporter();
      // Everything but the test that the gate holds back.
      await session.waitForFoundTests(locations.length - 1);
    }
    proc.stdin.write("collect\n");
    await proc.stdin.flush();

    await printed("__EXECUTION__");
    if (enable === "during execution") session.enableTestReporter();
    const first = { type: "test", name: "in the first file", url: join(String(dir), "first.test.cjs"), line: 3 };
    const ofFirstFile = enable === "before collection" ? [first] : [];
    const found = await session.waitForFoundTests(locations.length + ofFirstFile.length);
    await proc.stdin.end();

    const exitCode = await proc.exited;
    const elements = junit
      ? (await Bun.file(join(String(dir), "junit.xml")).text()).matchAll(/<test(?:case|suite) [^>]*>/g)
      : [];
    return {
      found: [...found.values()].map(({ type, name, url, line }) => ({ type, name, url, line })).sort(byName),
      expected: (line = (location: (typeof locations)[number]) => location.line) =>
        locations
          .map(location => ({ ...location, url: join(String(dir), file), line: line(location) }))
          .concat(ofFirstFile)
          .sort(byName),
      // The name of each element that has a line, and the line.
      junit: Object.fromEntries(
        Array.from(elements, ([element]) => [element.match(/ name="([^"]*)"/)![1], element.match(/ line="(\d+)"/)?.[1]])
          .filter(([, line]) => line)
          .map(([name, line]) => [name, Number(line)]),
      ),
      stderr: await stderr,
      exitCode,
    };
  }

  test.concurrent.each([
    ["before collection", "--inspect-wait"],
    ["during collection", "BUN_INSPECT"],
    ["during execution", "--inspect"],
  ] as const)("is the same when TestReporter.enable arrives %s (%s)", async (enable, debug) => {
    const { found, expected, stderr, exitCode } = await run(enable, debug);
    expect(found).toEqual(expected());
    expect(stderr).toContain(` ${locations.filter(location => location.type === "test").length + 1} pass`);
    expect(exitCode).toBe(0);
  });

  // The debugger ends each module with a `//# sourceURL=` comment, which is not the path of this file.
  test.concurrent("is the same in the JUnit report, in a file with a name that is not ASCII", async () => {
    const { found, expected, junit, exitCode } = await run("during collection", "--inspect-wait", {
      file: "位置.test.ts",
      junit: true,
    });
    expect(found).toEqual(expected());
    expect(junit).toEqual({
      "in the first file": 3,
      ...Object.fromEntries(locations.filter(({ line }) => line).map(({ name, line }) => [name, line])),
    });
    expect(exitCode).toBe(0);
  });

  // An editor puts BUN_INSPECT_CONNECT_TO in the environment of every process that it starts. That does not say that a
  // client will enable TestReporter, so `test()` does not look for its line until a client has.
  test.concurrent("is line 0 for a test from before TestReporter.enable over BUN_INSPECT_CONNECT_TO", async () => {
    const { found, expected, exitCode } = await run("during collection", "BUN_INSPECT_CONNECT_TO");
    expect(found).toEqual(expected(location => (location.name === "registered last" ? location.line : 0)));
    expect(exitCode).toBe(0);
  });
});
