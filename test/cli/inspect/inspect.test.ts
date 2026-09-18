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
      expect(
        new Promise<void>((resolve, reject) => {
          webSocket.addEventListener("open", () => resolve());
          webSocket.addEventListener("error", cause => reject(new Error("WebSocket error", { cause })));
          webSocket.addEventListener("close", cause => reject(new Error("WebSocket closed", { cause })));
        }),
      ).resolves.toBeUndefined();

      webSocket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "1 + 1" } }));
      expect(
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

// The backend uses the ids a client sends (a scriptId, a sourceID, the injectedScriptId in an objectId) as
// keys of WTF HashMaps with integer keys. Such a map reserves two keys (0 and -1) for its empty and deleted
// buckets, and a lookup of a reserved key matches an empty bucket. Without a check before the lookup, a
// release build uses that bucket's default value as an entry and a build with assertions aborts. A map has
// no table, and nothing to match, until its first entry, so each test makes the backend fill the map first.
describe.concurrent("an id from the client that names nothing", () => {
  async function openSession() {
    const debuggee = spawn({
      cmd: [bunExe(), "--inspect=127.0.0.1:0", "-e", "setInterval(() => {}, 1 << 30)"],
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });
    const { promise: listening, resolve: foundUrl, reject: noUrl } = Promise.withResolvers<string>();
    (async () => {
      let stderr = "";
      const decoder = new TextDecoder();
      for await (const chunk of debuggee.stderr) {
        stderr += decoder.decode(chunk, { stream: true });
        const line = stderr
          .split("\n")
          .slice(0, -1)
          .find(line => line.trim().startsWith("ws://"));
        if (line) foundUrl(line.trim());
      }
      noUrl(new Error(`No inspector URL in stderr:\n${stderr}`));
    })();

    const pending = new Map<number, (reply: object) => void>();
    const events: { method: string; params: any }[] = [];
    let exited: { exitCode: number | null; signalCode: string | null } | undefined;
    let wake = () => {};
    let webSocket: WebSocket;
    try {
      webSocket = new WebSocket(await listening);
      const { promise: open, resolve: opened, reject: failed } = Promise.withResolvers<void>();
      webSocket.addEventListener("open", () => opened());
      webSocket.addEventListener("error", cause => failed(new Error("WebSocket error", { cause })));
      await open;
    } catch (error) {
      debuggee.kill();
      throw error;
    }
    webSocket.addEventListener("message", ({ data }) => {
      const { id, method, params, ...reply } = JSON.parse(data.toString());
      if (method) events.push({ method, params });
      else pending.get(id)?.(reply);
      wake();
    });
    // If the debuggee dies, every pending command and event resolves to how it died.
    webSocket.addEventListener("close", async () => {
      await debuggee.exited;
      exited = { exitCode: debuggee.exitCode, signalCode: debuggee.signalCode };
      for (const resolve of pending.values()) resolve({ exited });
      wake();
    });

    let nextId = 1;
    return {
      send(method: string, params: object = {}): Promise<any> {
        const id = nextId++;
        const { promise, resolve } = Promise.withResolvers<object>();
        pending.set(id, resolve);
        webSocket.send(JSON.stringify({ id, method, params }));
        return promise;
      },
      /** The params of the first event of this kind that no earlier call took. */
      async event(method: string, matches: (params: any) => boolean = () => true): Promise<any> {
        while (true) {
          const index = events.findIndex(event => event.method === method && matches(event.params));
          if (index !== -1) return events.splice(index, 1)[0].params ?? {};
          if (exited) return { exited };
          await new Promise<void>(resolve => (wake = resolve));
        }
      },
      async [Symbol.asyncDispose]() {
        webSocket.close();
        debuggee.kill();
        await debuggee.exited;
      },
    };
  }

  test("injectedScriptId in an objectId or a callFrameId", async () => {
    await using session = await openSession();
    const evaluated = await session.send("Runtime.evaluate", { expression: "({ a: 1 })" });
    expect(evaluated).toMatchObject({ result: { result: { type: "object", className: "Object" } } });
    const objectId = JSON.parse(evaluated.result.result.objectId);
    expect(objectId.injectedScriptId).toBe(1);

    // 0.5 and -1.5 are 0 and -1 after the backend converts them to int.
    for (const injectedScriptId of [0, -1, 0.5, -1.5]) {
      const reserved = JSON.stringify({ ...objectId, injectedScriptId });
      expect({
        injectedScriptId,
        reply: await session.send("Runtime.getProperties", { objectId: reserved }),
      }).toMatchObject({
        injectedScriptId,
        reply: { error: { message: "Missing injected script for given objectId" } },
      });
    }
    expect(
      await session.send("Debugger.evaluateOnCallFrame", {
        callFrameId: JSON.stringify({ ordinal: 0, injectedScriptId: 0 }),
        expression: "1",
      }),
    ).toMatchObject({ error: { message: "Missing injected script for given callFrameId" } });

    // The real objectId still resolves in the same session.
    expect(
      await session.send("Runtime.getProperties", { objectId: JSON.stringify(objectId), ownProperties: true }),
    ).toMatchObject({
      result: { properties: [{ name: "a", value: { type: "number", value: 1 } }, { name: "__proto__" }] },
    });
  });

  test("scriptId", async () => {
    await using session = await openSession();
    expect(await session.send("Debugger.enable")).toEqual({ result: {} });
    expect(await session.send("Debugger.setBreakpointsActive", { active: true })).toEqual({ result: {} });
    expect(await session.send("Debugger.setPauseOnDebuggerStatements", { enabled: true })).toEqual({ result: {} });

    // "-1", the overflow and "x" do not parse, and the backend uses 0 for them. 4294967295 is -1 as a SourceID.
    const commands: [method: string, params: (scriptId: string) => object, message: string][] = [
      ["Debugger.getScriptSource", scriptId => ({ scriptId }), "Missing script for given scriptId"],
      ["Debugger.searchInContent", scriptId => ({ scriptId, query: "a" }), "Missing script for given scriptId"],
      [
        "Debugger.setBreakpoint",
        scriptId => ({ location: { scriptId, lineNumber: 0 } }),
        "Missing script for scriptId in given location",
      ],
      [
        "Debugger.getBreakpointLocations",
        scriptId => ({ start: { scriptId, lineNumber: 0 }, end: { scriptId, lineNumber: 0 } }),
        "Missing script for scriptId in given start",
      ],
    ];
    for (const scriptId of ["0", "4294967295", "-1", "99999999999999999999", "x"]) {
      for (const [method, params, message] of commands) {
        expect({ method, scriptId, reply: await session.send(method, params(scriptId)) }).toMatchObject({
          method,
          scriptId,
          reply: { error: { message } },
        });
      }
    }

    // Debugger.continueToLocation needs a paused debuggee. It resumes when it does not find the script.
    let paused: any;
    for (const scriptId of ["0", "4294967295"]) {
      const timer = await session.send("Runtime.evaluate", { expression: "setTimeout(() => { debugger; }, 0); 1" });
      expect(timer).toMatchObject({ result: { result: { value: 1 } } });
      paused = await session.event("Debugger.paused");
      expect(paused).toMatchObject({ reason: "DebuggerStatement" });
      expect({
        scriptId,
        reply: await session.send("Debugger.continueToLocation", { location: { scriptId, lineNumber: 0 } }),
      }).toMatchObject({ scriptId, reply: { error: { message: "Missing script for scriptId in given location" } } });
      expect(await session.event("Debugger.resumed")).toEqual({});
    }

    // The scriptId of a real script still resolves in the same session.
    const { scriptId } = paused.callFrames[0].location;
    expect(await session.send("Debugger.getScriptSource", { scriptId })).toEqual({
      result: { scriptSource: "setTimeout(() => { debugger; }, 0); 1" },
    });
  });

  test("sourceID", async () => {
    await using session = await openSession();
    expect(await session.send("Debugger.enable")).toEqual({ result: {} });
    expect(await session.send("Runtime.enableTypeProfiler")).toEqual({ result: {} });
    expect(await session.send("Runtime.enableControlFlowProfiler")).toEqual({ result: {} });

    const expression = "function typed(x) { return x; }\ntyped(1);\n//# sourceURL=typed.js";
    expect(await session.send("Runtime.evaluate", { expression })).toMatchObject({ result: { result: { value: 1 } } });
    const { scriptId } = await session.event("Debugger.scriptParsed", params => params.sourceURL === "typed.js");

    // The first query that finds types gives the type profiler's query cache its table.
    const divot = expression.indexOf("x)");
    expect(
      await session.send("Runtime.getRuntimeTypesForVariablesAtOffsets", {
        locations: [{ typeInformationDescriptor: 1, sourceID: scriptId, divot }],
      }),
    ).toMatchObject({ result: { types: [{ isValid: true, typeSet: { isInteger: true } }] } });
    expect(await session.send("Runtime.getBasicBlocks", { sourceID: scriptId })).toMatchObject({
      result: { basicBlocks: expect.arrayContaining([expect.objectContaining({ hasExecuted: true })]) },
    });

    for (const sourceID of ["0", "4294967295", "x", ""]) {
      expect({ sourceID, reply: await session.send("Runtime.getBasicBlocks", { sourceID }) }).toEqual({
        sourceID,
        reply: { result: { basicBlocks: [] } },
      });
    }
    // The first two are the empty and the deleted key of the query cache. "x" and "" do not parse.
    expect(
      await session.send("Runtime.getRuntimeTypesForVariablesAtOffsets", {
        locations: [
          { typeInformationDescriptor: 2, sourceID: "0", divot: 0 },
          { typeInformationDescriptor: 2, sourceID: "4294967295", divot: -1 },
          { typeInformationDescriptor: 1, sourceID: "x", divot },
          { typeInformationDescriptor: 1, sourceID: "", divot },
        ],
      }),
    ).toEqual({ result: { types: [{ isValid: false }, { isValid: false }, { isValid: false }, { isValid: false }] } });
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
