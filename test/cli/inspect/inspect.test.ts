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

describe.concurrent("event loop keep-alive", () => {
  async function spawnWithInspector(args: string[], cwd: string) {
    const inspectee = spawn({
      cmd: [bunExe(), ...args],
      cwd,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    let url: URL | undefined;
    let stderr = "";
    const decoder = new TextDecoder();
    for await (const chunk of inspectee.stderr) {
      stderr += decoder.decode(chunk);
      for (const line of stderr.split("\n")) {
        try {
          url = new URL(line.trim());
        } catch {}
        if (url?.protocol === "ws:") break;
      }
      if (url) break;
    }
    if (!url) throw new Error(`no inspector URL in:\n${stderr}`);

    const reader = inspectee.stdout.getReader();
    let stdout = "";
    const readStdoutUntil = async (marker: string) => {
      while (!stdout.includes(marker)) {
        const { value, done } = await reader.read();
        if (done) break;
        stdout += decoder.decode(value);
      }
      return stdout;
    };
    return { inspectee, url, readStdoutUntil };
  }

  // A client whose pending promises reject when the socket drops, so a dead
  // inspectee fails the test with a reason instead of a timeout.
  function open(url: URL) {
    const ws = new WebSocket(url);
    const pending = new Set<(error: Error) => void>();
    const fail = (message: string) => {
      const error = new Error(message);
      for (const reject of pending) reject(error);
      pending.clear();
    };
    const track = <T>(executor: (resolve: (value: T) => void) => void) =>
      new Promise<T>((resolve, reject) => {
        pending.add(reject);
        executor(value => {
          pending.delete(reject);
          resolve(value);
        });
      });
    let closing = false;
    ws.addEventListener("error", () => fail("WebSocket error"));
    ws.addEventListener("close", () => {
      if (!closing) fail("WebSocket closed");
    });
    const opened = track<void>(resolve => ws.addEventListener("open", () => resolve()));
    let nextId = 1;
    const replies = new Map<number, (reply: any) => void>();
    ws.addEventListener("message", ({ data }) => {
      const reply = JSON.parse(data.toString());
      replies.get(reply.id)?.(reply);
    });
    const send = (method: string, params?: object) =>
      track<any>(resolve => {
        const id = nextId++;
        replies.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    const close = () => {
      closing = true;
      const closed = new Promise<void>(resolve => ws.addEventListener("close", () => resolve()));
      ws.close();
      return closed;
    };
    return { opened, send, close };
  }

  test("a client that closes before the connect task runs does not unref the inspectee's loop", async () => {
    using dir = tempDir("inspect-early-close", {
      "server.js": `
        globalThis.server = Bun.serve({ port: 0, fetch: () => new Response() });
        process.on("beforeExit", () => console.log("beforeExit"));
        console.log("ready");
        // Block the JS thread so that every client the test opens closes
        // before the connect task for it runs.
        require("fs").readSync(0, Buffer.alloc(1));
        // The loop decides whether to exit before this timer is due. It only
        // fires when the server still keeps the loop alive.
        setTimeout(() => console.log("alive"), 200);
      `,
    });
    const { inspectee, url, readStdoutUntil } = await spawnWithInspector(
      ["--inspect=ws://localhost:0/x", "server.js"],
      String(dir),
    );
    await using _ = inspectee;
    await readStdoutUntil("ready\n");

    // Each early close must not cost the loop a ref. The server and the timer
    // hold two refs, so five unpaired releases would end the process.
    for (let i = 0; i < 5; i++) {
      const client = open(url);
      await client.opened;
      await client.close();
    }

    inspectee.stdin.write("\n");
    await inspectee.stdin.end();
    expect(await readStdoutUntil("alive\n")).toBe("ready\nalive\n");
    expect(inspectee.exitCode).toBeNull();

    // A client that does connect keeps the loop alive on its own, and its
    // close releases exactly that ref: the process exits once it is gone.
    const client = open(url);
    await client.opened;
    const reply = await client.send("Runtime.evaluate", { expression: "server.stop(true), 1 + 1" });
    expect(reply).toMatchObject({ id: 1, result: { result: { type: "number", value: 2 } } });
    expect(inspectee.exitCode).toBeNull();
    await client.close();
    expect(await inspectee.exited).toBe(0);
    expect(await readStdoutUntil("beforeExit\n")).toBe("ready\nalive\nbeforeExit\n");
  });

  test("a connected client keeps an idle inspectee alive until it disconnects", async () => {
    using dir = tempDir("inspect-idle-attached", {
      "idle.js": `
        process.on("beforeExit", () => console.log("beforeExit"));
        console.log("done");
      `,
    });
    const { inspectee, url, readStdoutUntil } = await spawnWithInspector(
      ["--inspect-wait=ws://localhost:0/x", "idle.js"],
      String(dir),
    );
    await using _ = inspectee;

    const client = open(url);
    await client.opened;
    await client.send("Inspector.enable");
    await client.send("Inspector.initialized");
    expect(await readStdoutUntil("done\n")).toBe("done\n");

    // The script is done. Only the attached client keeps the loop alive.
    const reply = await client.send("Runtime.evaluate", { expression: "1 + 1" });
    expect(reply).toMatchObject({ result: { result: { type: "number", value: 2 } } });
    expect(inspectee.exitCode).toBeNull();

    await client.close();
    expect(await inspectee.exited).toBe(0);
    expect(await readStdoutUntil("beforeExit\n")).toBe("done\nbeforeExit\n");
  });

  test("an inspector target that refuses the connection does not unref the inspectee's loop", async () => {
    // The debugger thread creates a connection and closes it at once when the
    // dial fails, before the inspectee can run the connect task.
    using dir = tempDir("inspect-refused", {
      "timer.js": `
        process.on("beforeExit", () => console.log("beforeExit"));
        console.log("ready");
        setTimeout(() => console.log("alive"), 200);
      `,
    });
    let target: string;
    if (isPosix) {
      target = `unix://${join(String(dir), "nobody.sock")}`;
    } else {
      // Windows dials unix: targets over TCP. Take a free port and release it.
      const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
      target = `tcp://127.0.0.1:${listener.port}`;
      listener.stop(true);
    }
    await using inspectee = spawn({
      cmd: [bunExe(), `--inspect=${target}`, "timer.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    // Drain stderr too. The inspector banner on it races the exit, so it is not asserted.
    const [stdout, , exitCode] = await Promise.all([
      inspectee.stdout.text(),
      inspectee.stderr.text(),
      inspectee.exited,
    ]);
    expect({ stdout, exitCode }).toEqual({ stdout: "ready\nalive\nbeforeExit\n", exitCode: 0 });
  });
});
