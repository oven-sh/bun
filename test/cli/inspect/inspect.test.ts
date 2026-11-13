import { Subprocess, spawn } from "bun";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, isPosix, randomPort, tempDir } from "harness";
import { join } from "node:path";
import stripAnsi from "strip-ansi";
import { WebSocket } from "ws";
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

// A scope object of a paused call frame answers for the scope behind it, and all the scope objects of a realm have
// one structure. The engine's caches went by that structure: they kept where the global object has a property as a
// place in the scope object, what one scope holds as what every scope holds, and that a name is missing after the
// scope had got it (oven-sh/WebKit#1048).
describe("a scope object of a paused call frame", () => {
  // Runs `source` to its `debugger` statement. `call` runs a function with the object of the global scope as `this`.
  // After `parameters` the function gets the object of another scope of the paused frame.
  async function pause(source: string) {
    const child = spawn({
      cmd: [bunExe(), "--inspect-wait=ws://127.0.0.1:0/", "-e", source],
      // A function is compiled where it reaches the threshold, and not later on another thread.
      env: { ...bunEnv, BUN_JSC_useConcurrentJIT: "0" },
      stdout: "pipe",
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
    const paused = Promise.withResolvers<{ callFrames: { scopeChain: { type: string; object: any }[] }[] }>();
    // A crash closes the socket. Resolve instead of rejecting so the failure shows up in the test's assertion.
    const closed = Promise.withResolvers<Reply>();
    const opened = Promise.withResolvers<Reply>();
    const webSocket = new WebSocket(url);
    webSocket.addEventListener("open", () => opened.resolve({}));
    webSocket.addEventListener("close", () =>
      closed.resolve({ error: { message: "the inspector closed the socket" } }),
    );
    webSocket.addEventListener("error", () => closed.resolve({ error: { message: "the inspector socket failed" } }));
    webSocket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data.toString());
      if (message.method === "Debugger.paused") paused.resolve(message.params);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
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
    await Promise.all([
      send("Inspector.enable"),
      send("Debugger.enable"),
      send("Debugger.setBreakpointsActive", { active: true }),
      send("Debugger.setPauseOnDebuggerStatements", { enabled: true }),
    ]);
    send("Inspector.initialized");
    const { callFrames } = await Promise.race([paused.promise, closed.promise.then(() => ({ callFrames: [] }))]);
    const scopes = callFrames[0]?.scopeChain ?? [];
    const globalScope = scopes.find(scope => scope.type === "global")?.object;
    const anotherScope = scopes.find(scope => scope.type !== "global")?.object;
    expect({ globalScope, anotherScope }).toEqual({
      globalScope: expect.objectContaining({ objectId: expect.any(String) }),
      anotherScope: expect.objectContaining({ objectId: expect.any(String) }),
    });

    return {
      // What the function returned, or what went wrong.
      async call(functionDeclaration: string, ...parameters: unknown[]) {
        const reply = await send("Runtime.callFunctionOn", {
          objectId: globalScope.objectId,
          functionDeclaration,
          arguments: [...parameters.map(value => ({ value })), { objectId: anotherScope.objectId }],
          returnByValue: true,
        });
        if (reply.error || reply.result.wasThrown) return reply;
        return reply.result.result.value;
      },
      // Lets the program run to its end.
      async resume() {
        await send("Debugger.resume");
        const [stdout, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
        return { stdout, exitCode, signalCode: child.signalCode };
      },
      async [Symbol.asyncDispose]() {
        webSocket.close();
        child.kill();
        await child.exited;
      },
    };
  }

  // console.write keeps its writer on `this` and reads it back as an own property.
  const writesWithTheScopeAsThis = `function (count) {
    const before = writersMade();
    for (let i = 0; i < count; i++) console.write.call(this, i % 500 === 499 ? "x" : "");
    return writersMade() - before;
  }`;

  test.concurrent.each([
    ["console.write has not run before", ""],
    [
      "console.write is compiled already",
      `const other = {}; for (let i = 0; i < 3000; i++) console.write.call(other, "");`,
    ],
  ])("is the `this` of console.write: %s", async (_, warmUp) => {
    await using session = await pause(`
      let writers = 0;
      const { writer } = Bun.stdout;
      Bun.stdout.writer = function () {
        writers++;
        return writer.apply(this, arguments);
      };
      globalThis.writersMade = () => writers;
      ${warmUp}
      debugger;
      process.exit(0);
    `);

    // Not more than one, and not exactly one: the writer is console.write's to keep where it likes.
    expect(await session.call(writesWithTheScopeAsThis, 2000)).toBeOneOf([0, 1]);
    expect(await session.resume()).toEqual({ stdout: "xxxx", exitCode: 0, signalCode: null });
  });

  // The names are missing while these functions are compiled. Then the global object gets them.
  const asksForNamesThatComeLater = `function (count, anotherScope) {
    const hasOwn = Object.prototype.hasOwnProperty;
    const read = scope => scope.later1;
    const has = scope => "later2" in scope;
    const readKey = (scope, key) => scope[key];
    const hasKey = (scope, key) => key in scope;
    const remove = scope => delete scope.later5;
    let missing = 0;
    for (; missing < count; missing++) {
      if (read(this) !== undefined || has(this) || readKey(this, "later3") !== undefined || hasKey(this, "later4")) break;
      if (!remove(this) || hasOwn.call(this, "later6")) break;
    }
    Object.assign(globalThis, { later1: 1, later2: 2, later3: 3, later4: 4, later5: 5, later6: 6 });
    return {
      missing,
      read: read(this),
      has: has(this),
      readKey: readKey(this, "later3"),
      hasKey: hasKey(this, "later4"),
      removed: remove(this) && !("later5" in globalThis),
      hasOwn: hasOwn.call(this, "later6"),
      hasOwnOfAnotherScope: hasOwn.call(anotherScope, "later6"),
    };
  }`;

  // The scope may hold a "then": a promise that is resolved with the scope object has to ask.
  const countsReadsOfThen = `function () {
    let reads = 0;
    Object.defineProperty(globalThis, "then", { get() { reads++; }, configurable: true });
    Promise.resolve(this);
    delete globalThis.then;
    return reads;
  }`;

  test.concurrent("answers with what its scope holds at the time", async () => {
    await using session = await pause(`
      function pausesHere() {
        debugger;
      }
      pausesHere();
      process.exit(0);
    `);

    expect(await session.call(asksForNamesThatComeLater, 2000)).toEqual({
      missing: 2000,
      read: 1,
      has: true,
      readKey: 3,
      hasKey: true,
      removed: true,
      hasOwn: true,
      hasOwnOfAnotherScope: false,
    });
    expect(await session.call(countsReadsOfThen)).toBe(1);
    expect(await session.resume()).toEqual({ stdout: "", exitCode: 0, signalCode: null });
  });
});
