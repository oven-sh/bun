import { Subprocess, spawn } from "bun";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, isPosix, randomPort, tempDir } from "harness";
import { join } from "node:path";
import stripAnsi from "strip-ansi";
import { WebSocket } from "ws";
import { listenForInspectee, spawnInspectee, valueOf } from "./inspector-client";
import { InspectorSession, JUnitReporter, connect } from "./junit-reporter";
import { SocketFramer } from "./socket-framer";
let inspectee: Subprocess;
const anyPort = expect.stringMatching(/^\d+$/);
const anyPathname = expect.stringMatching(/^\/[a-z0-9-]+$/);

/**
 * Get a function that creates a random `.sock` file in the specified temporary directory.
 */
const randomSocketPathFn = (tempdir: string) => (): string =>
  join(tempdir, Math.random().toString(36).substring(2, 15) + ".sock");

describe("websocket", () => {
  const tests = [
    {
      args: ["--inspect"],
      url: {
        protocol: "ws:",
        hostname: "localhost",
        port: "6499",
        pathname: anyPathname,
      },
    },
    {
      args: ["--inspect=0"],
      url: {
        protocol: "ws:",
        hostname: "localhost",
        port: anyPort,
        pathname: anyPathname,
      },
    },
    {
      args: [`--inspect=${randomPort()}`],
      url: {
        protocol: "ws:",
        hostname: "localhost",
        port: anyPort,
        pathname: anyPathname,
      },
    },
    {
      args: ["--inspect=localhost"],
      url: {
        protocol: "ws:",
        hostname: "localhost",
        port: "6499",
        pathname: anyPathname,
      },
    },
    {
      args: ["--inspect=localhost/"],
      url: {
        protocol: "ws:",
        hostname: "localhost",
        port: "6499",
        pathname: "/",
      },
    },
    {
      args: ["--inspect=localhost:0"],
      url: {
        protocol: "ws:",
        hostname: "localhost",
        port: anyPort,
        pathname: anyPathname,
      },
    },
    {
      args: ["--inspect=localhost:0/"],
      url: {
        protocol: "ws:",
        hostname: "localhost",
        port: anyPort,
        pathname: "/",
      },
    },
    {
      args: ["--inspect=localhost/foo/bar"],
      url: {
        protocol: "ws:",
        hostname: "localhost",
        port: "6499",
        pathname: "/foo/bar",
      },
    },
    {
      args: ["--inspect=127.0.0.1"],
      url: {
        protocol: "ws:",
        hostname: "127.0.0.1",
        port: "6499",
        pathname: anyPathname,
      },
    },
    {
      args: ["--inspect=127.0.0.1/"],
      url: {
        protocol: "ws:",
        hostname: "127.0.0.1",
        port: "6499",
        pathname: "/",
      },
    },
    {
      args: ["--inspect=127.0.0.1:0/"],
      url: {
        protocol: "ws:",
        hostname: "127.0.0.1",
        port: anyPort,
        pathname: "/",
      },
    },
    {
      args: ["--inspect=[::1]"],
      url: {
        protocol: "ws:",
        hostname: "[::1]",
        port: "6499",
        pathname: anyPathname,
      },
    },
    {
      args: ["--inspect=[::1]:0"],
      url: {
        protocol: "ws:",
        hostname: "[::1]",
        port: anyPort,
        pathname: anyPathname,
      },
    },
    {
      args: ["--inspect=[::1]:0/"],
      url: {
        protocol: "ws:",
        hostname: "[::1]",
        port: anyPort,
        pathname: "/",
      },
    },
    {
      args: ["--inspect=/"],
      url: {
        protocol: "ws:",
        hostname: "localhost",
        port: "6499",
        pathname: "/",
      },
    },
    {
      args: ["--inspect=/foo"],
      url: {
        protocol: "ws:",
        hostname: "localhost",
        port: "6499",
        pathname: "/foo",
      },
    },
    {
      args: ["--inspect=/foo/baz/"],
      url: {
        protocol: "ws:",
        hostname: "localhost",
        port: "6499",
        pathname: "/foo/baz/",
      },
    },
    {
      args: ["--inspect=:0"],
      url: {
        protocol: "ws:",
        hostname: "localhost",
        port: anyPort,
        pathname: anyPathname,
      },
    },
    {
      args: ["--inspect=:0/"],
      url: {
        protocol: "ws:",
        hostname: "localhost",
        port: anyPort,
        pathname: "/",
      },
    },
    {
      args: ["--inspect=ws://localhost/"],
      url: {
        protocol: "ws:",
        hostname: "localhost",
        port: anyPort,
        pathname: "/",
      },
    },
    {
      args: ["--inspect=ws://localhost:0/"],
      url: {
        protocol: "ws:",
        hostname: "localhost",
        port: anyPort,
        pathname: "/",
      },
    },
    {
      args: ["--inspect=ws://localhost:6499/foo/bar"],
      url: {
        protocol: "ws:",
        hostname: "localhost",
        port: "6499",
        pathname: "/foo/bar",
      },
    },
  ];

  for (const { args, url: expected } of tests) {
    test(`bun ${args.join(" ")}`, async () => {
      inspectee = spawn({
        cwd: import.meta.dir,
        cmd: [bunExe(), ...args, "inspectee.js"],
        env: bunEnv,
        stdout: "ignore",
        stderr: "pipe",
      });

      let url: URL | undefined;
      let stderr = "";
      const decoder = new TextDecoder();
      for await (const chunk of inspectee.stderr as ReadableStream) {
        stderr += decoder.decode(chunk);
        for (const line of stderr.split("\n")) {
          try {
            url = new URL(line);
          } catch {
            // Ignore
          }
          if (url?.protocol.includes("ws")) {
            break;
          }
        }
        if (stderr.includes("Listening:")) {
          break;
        }
      }

      if (!url) {
        process.stderr.write(stderr);
        throw new Error("Unable to find listening URL");
      }

      const { protocol, hostname, port, pathname } = url;
      expect({
        protocol,
        hostname,
        port,
        pathname,
      }).toMatchObject(expected);

      const webSocket = new WebSocket(url);
      await expect(
        new Promise<void>((resolve, reject) => {
          webSocket.addEventListener("open", () => resolve());
          webSocket.addEventListener("error", cause => reject(new Error("WebSocket error", { cause })));
          webSocket.addEventListener("close", cause => reject(new Error("WebSocket closed", { cause })));
        }),
      ).resolves.toBeUndefined();

      webSocket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "1 + 1" } }));
      await expect(
        new Promise(resolve => {
          webSocket.addEventListener("message", ({ data }) => {
            resolve(JSON.parse(data.toString()));
          });
        }),
      ).resolves.toMatchObject({
        id: 1,
        result: {
          result: {
            type: "number",
            value: 2,
          },
        },
      });

      webSocket.close();
    });
  }

  // FIXME: Depends on https://github.com/oven-sh/bun/pull/4649
  test.todo("bun --inspect=ws+unix:///tmp/inspect.sock");

  afterEach(() => {
    inspectee?.kill();
  });
});

// Each attached client is one frontend, and each numbers its commands from 1. The response
// to a command belongs to the client that sent it, and to no other client.
describe("more than one client", () => {
  test("each client gets the response to its own command, and an idle client gets none", async () => {
    await using inspectee = await spawnInspectee("jsc");
    const a = await inspectee.attach("A");
    const b = await inspectee.attach("B");
    const idle = await inspectee.attach("idle");

    const [answerForA, answerForB] = await Promise.all([a.evaluate("'answer-for-A'"), b.evaluate("'answer-for-B'")]);
    await Promise.all([a.settle(), b.settle(), idle.settle()]);

    expect({ answerForA, answerForB, a: a.responses(), b: b.responses(), idle: idle.responses() }).toEqual({
      answerForA: "answer-for-A",
      answerForB: "answer-for-B",
      a: ["1:answer-for-A"],
      b: ["1:answer-for-B"],
      idle: [],
    });
  });

  test("the response to Runtime.awaitPromise goes to the client that awaited", async () => {
    await using inspectee = await spawnInspectee("jsc");
    const a = await inspectee.attach("A");
    const b = await inspectee.attach("B");

    const promise = await a.call("Runtime.evaluate", {
      expression: "new Promise(resolve => (globalThis.resolveIt = resolve))",
    });
    const awaited = a.call("Runtime.awaitPromise", { promiseObjectId: promise.result.result.objectId });
    await a.settle();

    // The promise settles while B's second command runs. That command has the id of A's pending one.
    const first = await b.evaluate("'first-for-B'");
    const second = await b.evaluate("resolveIt('awaited-by-A'), 'second-for-B'");
    const awaitedByA = valueOf(await awaited);
    await Promise.all([a.settle(), b.settle()]);

    expect({ awaitedByA, first, second, a: a.responses(), b: b.responses() }).toEqual({
      awaitedByA: "awaited-by-A",
      first: "first-for-B",
      second: "second-for-B",
      a: ["1:Promise", "2:awaited-by-A"],
      b: ["1:first-for-B", "2:second-for-B"],
    });
  });

  test("the response for a client that closed is not sent to the client that remains", async () => {
    await using inspectee = await spawnInspectee("jsc");
    const a = await inspectee.attach("A");
    const b = await inspectee.attach("B");

    const promise = await a.call("Runtime.evaluate", {
      expression: "new Promise(resolve => (globalThis.resolveIt = resolve))",
    });
    a.send("Runtime.awaitPromise", { promiseObjectId: promise.result.result.objectId });
    await a.settle();
    await a.close();

    const first = await b.evaluate("'first-for-B'");
    const second = await b.evaluate("resolveIt('awaited-by-A'), 'second-for-B'");
    await b.settle();

    expect({ first, second, b: b.responses() }).toEqual({
      first: "first-for-B",
      second: "second-for-B",
      b: ["1:first-for-B", "2:second-for-B"],
    });
  });

  test("a second client's command is answered to it while the first client's command is paused", async () => {
    await using inspectee = await spawnInspectee("jsc");
    const a = await inspectee.attach("A");
    const b = await inspectee.attach("B");

    await a.call("Debugger.enable");
    await a.call("Debugger.setBreakpointsActive", { active: true });
    await a.call("Debugger.setPauseOnDebuggerStatements", { enabled: true });
    // The process has one Debugger for all clients. B asks for it too, and gets its events like A.
    await b.call("Debugger.enable");
    const paused = a.evaluate("debugger; 'A-after-the-pause'");
    await a.waitFor(message => message.method === "Debugger.paused");

    // B's commands run inside the dispatch of A's paused command.
    const duringThePause = await b.evaluate("'B-during-the-pause'");
    await b.call("Debugger.resume");
    const afterThePause = await paused;
    await Promise.all([a.settle(), b.settle()]);

    expect({
      duringThePause,
      afterThePause,
      a: a.responses(),
      b: b.responses(),
      aEvents: a.events("Debugger.paused", "Debugger.resumed"),
      bEvents: b.events("Debugger.paused", "Debugger.resumed"),
    }).toEqual({
      duringThePause: "B-during-the-pause",
      afterThePause: "A-after-the-pause",
      a: ["1:{}", "2:{}", "3:{}", "4:A-after-the-pause"],
      b: [expect.stringMatching(/^1:/), "2:B-during-the-pause", "3:{}"],
      aEvents: ["Debugger.paused", "Debugger.resumed"],
      bEvents: ["Debugger.paused", "Debugger.resumed"],
    });
  });

  test("the error of a command that fails goes to the client that sent it", async () => {
    await using inspectee = await spawnInspectee("jsc");
    const a = await inspectee.attach("A");
    const b = await inspectee.attach("B");

    const failed = await b.call("Runtime.awaitPromise", { promiseObjectId: '{"injectedScriptId":1,"id":999999}' });
    await Promise.all([a.settle(), b.settle()]);

    expect({ failed: valueOf(failed), a: a.responses(), b: b.responses() }).toEqual({
      failed: "error -32000",
      a: [],
      b: ["1:error -32000"],
    });
  });

  test("the error of an awaited promise that fails later goes to the client that awaited", async () => {
    await using inspectee = await spawnInspectee("jsc");
    const a = await inspectee.attach("A");
    const b = await inspectee.attach("B");

    const promise = await a.call("Runtime.evaluate", {
      expression: "new Promise(resolve => (globalThis.resolveIt = resolve))",
    });
    // A value that refers to itself cannot be returned by value. The backend finds that out when the promise settles.
    a.send("Runtime.awaitPromise", { promiseObjectId: promise.result.result.objectId, returnByValue: true });
    await a.settle();

    const first = await b.evaluate("'first-for-B'");
    const second = await b.evaluate(
      "(() => { const cyclic = {}; cyclic.self = cyclic; resolveIt(cyclic); })(), 'second-for-B'",
    );
    await Promise.all([a.settle(), b.settle()]);

    expect({ first, second, a: a.responses(), b: b.responses() }).toEqual({
      first: "first-for-B",
      second: "second-for-B",
      a: ["1:Promise", "2:error -32000"],
      b: ["1:first-for-B", "2:second-for-B"],
    });
  });

  test("the error for a message that is not JSON goes to its sender", async () => {
    await using inspectee = await spawnInspectee("jsc");
    const a = await inspectee.attach("A");
    const b = await inspectee.attach("B");

    a.sendRaw("{this is not JSON");
    await a.waitFor(message => message.id === null);
    await Promise.all([a.settle(), b.settle()]);

    expect({ a: a.responses(), b: b.responses() }).toEqual({ a: ["null:error -32700"], b: [] });
  });

  test("a command from a client that closes before the inspected thread sees it is answered to no client", async () => {
    await using inspectee = await spawnInspectee("jsc");
    const a = await inspectee.attach("A");
    const held = a.evaluate("hold()");
    await inspectee.stderr(/HOLDING/);

    // The inspected thread is busy, so it registers this client only after the client is gone.
    const late = await inspectee.attach("late");
    late.send("Runtime.evaluate", { expression: "'answer-for-late'" });
    await late.close();
    inspectee.release();

    expect(await held).toBe("released");
    await a.settle();
    expect(a.responses()).toEqual(["1:released"]);
  });
});

describe("http metadata endpoint", () => {
  let metadataInspectee: Subprocess | undefined;

  async function spawnInspectee(): Promise<URL> {
    metadataInspectee = spawn({
      cwd: import.meta.dir,
      cmd: [bunExe(), "--inspect=127.0.0.1:0", "inspectee.js"],
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });

    let url: URL | undefined;
    let stderr = "";
    const decoder = new TextDecoder();
    for await (const chunk of metadataInspectee.stderr as ReadableStream) {
      stderr += decoder.decode(chunk);
      for (const line of stderr.split("\n")) {
        try {
          url = new URL(line);
        } catch {}
        if (url?.protocol.includes("ws")) {
          break;
        }
      }
      if (stderr.includes("Listening:")) {
        break;
      }
    }

    if (!url) {
      process.stderr.write(stderr);
      throw new Error("Unable to find listening URL");
    }
    return url;
  }

  afterEach(() => {
    metadataInspectee?.kill();
  });

  test("serves /json/version only for a Host of the bound hostname, localhost, or an IP literal", async () => {
    const { port } = await spawnInspectee();
    const endpoint = `http://127.0.0.1:${port}/json/version`;

    const allowed = await fetch(endpoint);
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({
      "Protocol-Version": "1.3",
      "Browser": "Bun",
      "User-Agent": expect.any(String),
      "WebKit-Version": expect.any(String),
      "Bun-Version": expect.any(String),
      "Bun-Revision": expect.any(String),
    });

    const localhost = await fetch(endpoint, { headers: { "Host": `localhost:${port}` } });
    expect(localhost.status).toBe(200);

    const named = await fetch(endpoint, { headers: { "Host": `inspector.example:${port}` } });
    expect(await named.text()).toBe("");
    expect(named.status).toBe(400);
  });

  test("serves /json/version only to allowed web origins", async () => {
    const { port } = await spawnInspectee();
    const endpoint = `http://127.0.0.1:${port}/json/version`;

    const loopback = await fetch(endpoint, { headers: { "Origin": "http://127.0.0.1:8080" } });
    expect(loopback.status).toBe(200);

    const web = await fetch(endpoint, { headers: { "Origin": "http://inspector.example" } });
    expect(await web.text()).toBe("");
    expect(web.status).toBe(403);
  });
});

describe("unix domain socket without websocket", () => {
  let tempdir: string;
  let randomSocketPath: () => string;

  beforeAll(() => {
    // Create .tmp in root repo directory to avoid long paths on Windows
    tempdir = ".tmp";
    fs.mkdirSync(tempdir, { recursive: true });
    randomSocketPath = randomSocketPathFn(tempdir);
  });

  afterAll(() => {
    fs.rmSync(tempdir, { recursive: true, force: true });
  });

  if (isPosix) {
    async function runTest(path: string, args: string[], env = bunEnv) {
      let { promise, resolve, reject } = Promise.withResolvers();

      const framer = new SocketFramer(message => {
        resolve(JSON.parse(message));
      });

      let sock;

      using listener = Bun.listen({
        unix: path,
        socket: {
          open: socket => {
            sock = socket;
            framer.send(socket, JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "1 + 1" } }));
          },
          data: (socket, bytes) => {
            framer.onData(socket, bytes);
          },
          error: reject,
        },
      });

      const inspectee = spawn({
        cmd: [bunExe(), ...args, join(import.meta.dir, "inspectee.js")],
        env,
        stdout: "inherit",
        stderr: "inherit",
        stdin: "inherit",
      });
      const message = await promise;
      expect(message).toMatchObject({
        id: 1,
        result: {
          result: { type: "number", value: 2 },
        },
      });
      inspectee.kill();
      sock?.end?.();
    }

    test("bun --inspect=unix://", async () => {
      const path = randomSocketPath();
      const url = new URL(`unix://${path}`);
      await runTest(path, ["--inspect=" + url.href]);
    });

    test("bun --inspect=unix:", async () => {
      const path = randomSocketPath();
      await runTest(path, ["--inspect=unix:" + path]);
    });

    test("BUN_INSPECT=' unix://' bun --inspect", async () => {
      const path = randomSocketPath();
      await runTest(path, [], { ...bunEnv, BUN_INSPECT: "unix://" + path });
    });

    test("BUN_INSPECT='unix:' bun --inspect", async () => {
      const path = randomSocketPath();
      await runTest(path, [], { ...bunEnv, BUN_INSPECT: "unix:" + path });
    });

    // BUN_INSPECT and --inspect together put a unix socket client and a WebSocket client on one process.
    test("a unix socket client and a WebSocket client each get the response to their own command", async () => {
      const path = randomSocketPath();
      using listener = listenForInspectee(path, "unix");
      await using inspectee = await spawnInspectee("jsc", { env: { BUN_INSPECT: "unix://" + path } });
      const unix = await listener.client;
      const webSocket = await inspectee.attach("WebSocket");

      const [answerForUnix, answerForWebSocket] = await Promise.all([
        unix.evaluate("'answer-for-unix'"),
        webSocket.evaluate("'answer-for-WebSocket'"),
      ]);
      await Promise.all([unix.settle(), webSocket.settle()]);

      expect({ answerForUnix, answerForWebSocket, unix: unix.responses(), webSocket: webSocket.responses() }).toEqual({
        answerForUnix: "answer-for-unix",
        answerForWebSocket: "answer-for-WebSocket",
        unix: ["1:answer-for-unix"],
        webSocket: ["1:answer-for-WebSocket"],
      });
    });
  }
});

/// TODO: this test is flaky because the inspect may not send all messages before the process exit
/// we need to implement a way/option so we wait every message from the inspector before exiting
test.todo("junit reporter", async () => {
  let reporter: JUnitReporter;
  let session: InspectorSession;

  await using tempdir = tempDir("junit-reporter", {
    "package.json": `
      {
        "type": "module",
        "scripts": {
          "test": "bun a.test.js"
        }
      }
    `,
    "a.test.js": `
      import { test, expect } from "bun:test";
      test("fail", () => {
        expect(1).toBe(2);
      });

      test("success", () => {
        expect(1).toBe(1);
      });
    `,
  });
  const path = randomSocketPathFn(tempdir)();
  let { resolve, reject, promise } = Promise.withResolvers();
  const [socket, subprocess] = await Promise.all([
    connect(`unix://${path}`, resolve),
    spawn({
      cmd: [bunExe(), "--inspect-wait=unix:" + path, "test", join(tempdir, "a.test.js")],
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    }),
  ]);

  const framer = new SocketFramer((message: string) => {
    session.onMessage(message);
  });

  session = new InspectorSession();
  session.socket = socket;
  session.framer = framer;
  socket.data = {
    onData: framer.onData.bind(framer),
  };

  reporter = new JUnitReporter(session);

  await Promise.all([subprocess.exited, promise]);

  for (const [file, suite] of reporter.testSuites.entries()) {
    suite.time = 1000 * 5;
    suite.timestamp = new Date(2024, 11, 17, 15, 37, 38, 935).toISOString();
  }

  const report = reporter
    .generateReport()
    .replaceAll("\r\n", "\n")
    .replaceAll("\\", "/")
    .replaceAll(tempdir.replaceAll("\\", "/"), "<dir>")
    .replaceAll(process.cwd().replaceAll("\\", "/"), "<cwd>")
    .trim();
  expect(stripAnsi(report)).toMatchSnapshot();
});

// This test is checking that Bun.inspect || console.log on an Error instance is
// ~the same whether you did `error.stack` or not.
//
// Since the 2nd time around, we parse the error.stack getter, we need to make sure
// it doesn't lose frames.
test("error.stack doesnt lose frames", () => {
  function top() {
    function middle() {
      function bottom() {
        throw new Error("test");
      }
      bottom();
    }
    middle();
  }
  function accessErrorStackProperty(yes: boolean): Error {
    try {
      top();
      expect.unreachable();
    } catch (e: any) {
      if (yes) {
        e.stack;
      }

      return e as Error;
    }
  }

  function bottom(yes: boolean) {
    return accessErrorStackProperty(yes);
  }

  Object.defineProperty(top, "name", { value: "IGNORE_ME_BEFORE_THIS_LINE" });
  Object.defineProperty(bottom, "name", { value: "IGNORE_ME_AFTER_THIS_LINE" });

  let yes = Bun.inspect(bottom(true));
  yes = yes.slice(yes.indexOf("^") + 1);
  yes = yes.slice(yes.indexOf("\n"));
  yes = yes
    .replaceAll(import.meta.dirname, "<dir>")
    .replaceAll("\\", "/")
    .replace(/\d+/gim, "<num>");

  let no = Bun.inspect(bottom(false));
  no = no.slice(no.indexOf("^") + 1);
  no = no.slice(no.indexOf("\n"));
  no = no
    .replaceAll(import.meta.dirname, "<dir>")
    .replaceAll("\\", "/")
    .replace(/\d+/gim, "<num>");

  expect(no).toMatchInlineSnapshot(`
    "
    error: test
          at bottom (<dir>/inspect.test.ts:<num>:<num>)
          at middle (<dir>/inspect.test.ts:<num>:<num>)
          at IGNORE_ME_BEFORE_THIS_LINE (<dir>/inspect.test.ts:<num>:<num>)
          at accessErrorStackProperty (<dir>/inspect.test.ts:<num>:<num>)
          at <anonymous> (<dir>/inspect.test.ts:<num>:<num>)
    "
  `);

  // In Bun v1.2.20 and lower, we would only have the first frame here.
  expect(yes).toMatchInlineSnapshot(`
    "
    error: test
          at bottom (<dir>/inspect.test.ts:<num>:<num>)
          at middle (<dir>/inspect.test.ts:<num>:<num>)
          at IGNORE_ME_BEFORE_THIS_LINE (<dir>/inspect.test.ts:<num>:<num>)
          at accessErrorStackProperty (<dir>/inspect.test.ts:<num>:<num>)
          at <dir>/inspect.test.ts:<num>:<num>
    "
  `);

  // We allow it to differ by the existence of <anonymous> as a string. But that's it.
  expect(no.split("\n").slice(0, -2).join("\n").trim()).toBe(yes.split("\n").slice(0, -2).join("\n").trim());
});

test("LifecycleReporter.getModuleGraph reports an empty argv when process.argv isn't an array", async () => {
  await using child = spawn({
    cmd: [bunExe(), "--inspect=ws://127.0.0.1:0/", "-e", "setInterval(() => {}, 1000);"],
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });

  let stderr = "";
  let url: string | undefined;
  const decoder = new TextDecoder();
  for await (const chunk of child.stderr as ReadableStream) {
    stderr += decoder.decode(chunk);
    url = stderr.match(/(ws:\/\/[^\s]+)/)?.[1];
    if (url) break;
  }
  if (!url) throw new Error(`Unable to find the inspector URL in:\n${stderr}`);

  type Reply = { result?: any; error?: { message: string } };
  const pending = new Map<number, (reply: Reply) => void>();
  // A crash closes the socket. Resolve instead of rejecting so the failure shows up in the snapshot below.
  const closed = Promise.withResolvers<Reply>();
  const opened = Promise.withResolvers<Reply>();
  const webSocket = new WebSocket(url);
  webSocket.addEventListener("open", () => opened.resolve({}));
  webSocket.addEventListener("close", () => closed.resolve({ error: { message: "the inspector closed the socket" } }));
  webSocket.addEventListener("error", () => closed.resolve({ error: { message: "the inspector socket failed" } }));
  webSocket.addEventListener("message", ({ data }) => {
    const reply: Reply & { id: number } = JSON.parse(data.toString());
    pending.get(reply.id)?.(reply);
    pending.delete(reply.id);
  });

  let nextId = 1;
  function send(method: string, params: object = {}): Promise<Reply> {
    const id = nextId++;
    const { promise, resolve } = Promise.withResolvers<Reply>();
    pending.set(id, resolve);
    webSocket.send(JSON.stringify({ id, method, params }));
    return Promise.race([promise, closed.promise]);
  }

  expect(await Promise.race([opened.promise, closed.promise])).toEqual({});

  const argv: Record<string, unknown> = {};
  for (const expression of ["undefined", "0", `"abc"`, "{}", `["a", "b"]`]) {
    const assigned = await send("Runtime.evaluate", { expression: `process.argv = ${expression}` });
    const graph = assigned.error ? assigned : await send("LifecycleReporter.getModuleGraph");
    argv[expression] = graph.error?.message ?? graph.result.argv;
  }

  expect(argv).toMatchInlineSnapshot(`
    {
      "\\"abc\\"": [],
      "0": [],
      "[\\"a\\", \\"b\\"]": [
        "a",
        "b",
      ],
      "undefined": [],
      "{}": [],
    }
  `);

  expect(child.exitCode).toBe(null);
  webSocket.close();
});
