import { Subprocess, spawn } from "bun";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, isDebug, isPosix, randomPort, tempDirWithFiles } from "harness";
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

// JSInjectedScriptHostPrototype / JSJavaScriptCallFramePrototype host functions declare a
// ThrowScope and then tail-call into an impl that declares its own; without a
// RELEASE_AND_RETURN the first Runtime.evaluate aborts under exception-check validation with
// "Unchecked JS exception ... jsInjectedScriptHostPrototypeFunctionEvaluateWithScopeExtension".
// validateExceptionChecks is compiled out of release builds, so this is debug-only.
test.skipIf(!isDebug)("Runtime.evaluate does not trip exception-check validation", async () => {
  await using child = spawn({
    cwd: import.meta.dir,
    cmd: [bunExe(), "--inspect-wait=127.0.0.1:0", "inspectee.js"],
    env: {
      ...bunEnv,
      BUN_JSC_validateExceptionChecks: "1",
      BUN_JSC_dumpSimulatedThrows: "1",
    },
    stdout: "ignore",
    stderr: "pipe",
  });

  let stderr = "";
  const decoder = new TextDecoder();
  const { promise: urlPromise, resolve: resolveUrl } = Promise.withResolvers<URL>();
  const drained = (async () => {
    for await (const chunk of child.stderr) {
      stderr += decoder.decode(chunk);
      for (const line of stderr.split("\n")) {
        try {
          const u = new URL(line.trim());
          if (u.protocol.includes("ws")) resolveUrl(u);
        } catch {}
      }
    }
  })();

  const url = await urlPromise;
  const ws = new WebSocket(url);
  try {
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", cause => reject(new Error("WebSocket error", { cause })));
    });

    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "1 + 1" } }));
    const reply = await new Promise<unknown>(resolve => {
      ws.addEventListener("message", ({ data }) => resolve(JSON.parse(String(data))));
      ws.addEventListener("close", ({ code, reason }) => resolve({ closed: { code, reason } }));
    });

    // Without the WebKit-side fix, the inspected process aborts with SIGABRT
    // ("Unchecked JS exception") before replying, so the socket closes 1006
    // and this assertion sees { closed: { code: 1006, ... } } instead.
    expect(reply).toMatchObject({
      id: 1,
      result: { result: { type: "number", value: 2 } },
    });
  } finally {
    ws.close();
    child.kill();
  }

  await Promise.all([child.exited, drained]);
  if (child.signalCode === "SIGABRT") {
    throw new Error("inspectee aborted under validateExceptionChecks:\n" + stderr);
  }
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
