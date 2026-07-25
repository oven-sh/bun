import { Subprocess, spawn } from "bun";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, isPosix, randomPort, tempDir, tempDirWithFiles } from "harness";
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

// `bun test --isolate` (and `bun build --compile` output) hands JSC a
// SourceProvider tagged BunTranspiledModule instead of Module so Bun's
// pre-computed module record is reused. That tag must behave like Module at
// every `sourceType()` switch in JSC's debugger/inspector; when it falls
// through, `Debugger.scriptParsed` reports `module: false` and
// `Debugger.setBreakpoint` replies "Could not resolve breakpoint".
// See oven-sh/WebKit#345.
describe("Debugger domain with BunTranspiledModule source providers", () => {
  async function runDebuggerProbe(extraArgs: readonly string[], expectedSourceType: string | null) {
    using dir = tempDir("inspect-buntranspiledmodule", {
      "mod.test.ts": `import { test, expect } from "bun:test";
import { isolatedModuleCacheSourceType } from "bun:internal-for-testing";
export const x = 1;
globalThis.__providerSourceType = isolatedModuleCacheSourceType(import.meta.path);
debugger;
test("t", () => { expect(x).toBe(1); });
`,
    });

    await using proc = spawn({
      cmd: [
        bunExe(),
        "--inspect-wait=ws://127.0.0.1:0/buntranspiledmodule",
        "test",
        ...extraArgs,
        join(String(dir), "mod.test.ts"),
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    // Scan complete stderr lines for the inspector WebSocket URL while
    // draining the stream so the child never back-pressures.
    let stderrBuf = "";
    let stderrLineBuf = "";
    const { promise: urlPromise, resolve: urlResolve, reject: urlReject } = Promise.withResolvers<URL>();
    let urlFound = false;
    (async () => {
      const decoder = new TextDecoder();
      for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
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
          } catch {}
        }
      }
      if (!urlFound) urlReject(new Error(`Inspector URL not found: ${JSON.stringify(stderrBuf)}`));
    })().catch(err => {
      if (!urlFound) urlReject(err);
    });
    (async () => {
      for await (const _ of proc.stdout as ReadableStream<Uint8Array>) {
      }
    })().catch(() => {});

    const url = await urlPromise;
    const ws = new WebSocket(url);
    try {
      await new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => resolve(), { once: true });
        ws.addEventListener("error", e => reject(new Error("WebSocket error", { cause: e })), { once: true });
        ws.addEventListener("close", e => reject(new Error("WebSocket closed", { cause: e })), { once: true });
      });

      type Waiter = { resolve: (value: any) => void; reject: (error: Error) => void };
      let nextId = 1;
      const pending = new Map<number, Waiter>();
      const eventWaiters = new Map<string, Waiter>();
      let closeError: Error | undefined;
      let userScript: { scriptId: string; module: boolean; url: string } | undefined;

      const failAll = (err: Error) => {
        if (closeError) return;
        closeError = err;
        for (const w of pending.values()) w.reject(err);
        pending.clear();
        for (const w of eventWaiters.values()) w.reject(err);
        eventWaiters.clear();
      };
      ws.addEventListener("error", e => failAll(new Error("WebSocket error", { cause: e })));
      ws.addEventListener("close", e => failAll(new Error(`WebSocket closed (${e.code})`, { cause: e })));
      ws.addEventListener("message", ev => {
        const msg = JSON.parse(String(ev.data));
        if (typeof msg.id === "number") {
          const w = pending.get(msg.id);
          if (w) {
            pending.delete(msg.id);
            w.resolve(msg);
          }
        } else if (typeof msg.method === "string") {
          if (msg.method === "Debugger.scriptParsed") {
            const p = msg.params;
            if (String(p.url).endsWith("mod.test.ts") || String(p.sourceURL).endsWith("mod.test.ts")) {
              userScript = { scriptId: String(p.scriptId), module: p.module === true, url: String(p.url) };
            }
          }
          const w = eventWaiters.get(msg.method);
          if (w) {
            eventWaiters.delete(msg.method);
            w.resolve(msg.params);
          }
        }
      });

      const send = (method: string, params: Record<string, unknown> = {}) =>
        new Promise<any>((resolve, reject) => {
          if (closeError) return reject(closeError);
          const id = nextId++;
          pending.set(id, { resolve, reject });
          ws.send(JSON.stringify({ id, method, params }));
        });
      const waitForEvent = (method: string) =>
        new Promise<any>((resolve, reject) => {
          if (closeError) return reject(closeError);
          eventWaiters.set(method, { resolve, reject });
        });

      await Promise.all([
        send("Inspector.enable"),
        send("Debugger.enable"),
        send("Debugger.setBreakpointsActive", { active: true }),
        send("Debugger.setPauseOnDebuggerStatements", { enabled: true }),
      ]);

      const pausedPromise = waitForEvent("Debugger.paused");
      send("Inspector.initialized").catch(() => {});
      const paused = await pausedPromise;
      expect(paused.reason).toBe("DebuggerStatement");

      if (!userScript) {
        throw new Error(`No Debugger.scriptParsed for mod.test.ts; stderr=${JSON.stringify(stderrBuf)}`);
      }

      // Self-check the premise: the --isolate run must actually be exercising
      // a BunTranspiledModule provider. Without this, a refactor that stops
      // attaching module_info to the entrypoint would leave both cases as
      // Module-vs-Module and the regression guard would evaporate. The fixture
      // stashed the value on globalThis because evaluateOnCallFrame parses its
      // expression as a Program (no `import.meta`) and module scope has no
      // `require`.
      const sourceTypeEval = await send("Debugger.evaluateOnCallFrame", {
        callFrameId: paused.callFrames?.[0]?.callFrameId,
        expression: `globalThis.__providerSourceType`,
        returnByValue: true,
      });

      const setBreakpoint = await send("Debugger.setBreakpoint", {
        location: { scriptId: userScript.scriptId, lineNumber: 5, columnNumber: 0 },
      });
      // Assert the inspector-visible shape (breakpoint + module flag + the
      // provider-type self-check) together so a failure shows the full
      // picture.
      expect({
        providerSourceType: sourceTypeEval?.result?.result?.value ?? null,
        setBreakpoint,
        scriptParsedModule: userScript.module,
      }).toEqual({
        providerSourceType: expectedSourceType,
        setBreakpoint: {
          id: expect.any(Number),
          result: {
            breakpointId: expect.any(String),
            actualLocation: {
              scriptId: userScript.scriptId,
              lineNumber: 5,
              columnNumber: expect.any(Number),
            },
          },
        },
        scriptParsedModule: true,
      });

      // Use the URL the inspector reported (bun realpaths the script path
      // before reporting it) and a different line so the scriptId breakpoint
      // above doesn't collide.
      const setBreakpointByUrl = await send("Debugger.setBreakpointByUrl", {
        url: userScript.url,
        lineNumber: 2,
        columnNumber: 0,
      });
      expect(setBreakpointByUrl?.result?.locations).toEqual([
        { scriptId: userScript.scriptId, lineNumber: 2, columnNumber: expect.any(Number) },
      ]);

      await send("Debugger.resume").catch(() => {});
    } finally {
      try {
        ws.close();
      } catch {}
    }
  }

  test("bun test --isolate: Debugger.scriptParsed reports module and breakpoints resolve", async () => {
    await runDebuggerProbe(["--isolate"], "BunTranspiledModule");
  });

  // Sanity: without --isolate the provider is plain Module, the isolation
  // cache is empty (hence null), and this has always worked; pinning it
  // alongside ensures the --isolate case is being compared against the
  // correct baseline.
  test("bun test (no --isolate): Debugger.scriptParsed reports module and breakpoints resolve", async () => {
    await runDebuggerProbe([], null);
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

  const tempdir = tempDirWithFiles("junit-reporter", {
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
