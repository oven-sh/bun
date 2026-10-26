import { Subprocess, spawn } from "bun";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isPosix, randomPort, tempDir } from "harness";
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

/** One WebSocket client of the inspector. Every wait rejects when the socket closes. */
class InspectorClient {
  #socket: WebSocket;
  #nextId = 1;
  #pending = new Map<number, PromiseWithResolvers<any>>();
  #events = new Map<string, any[]>();
  #consumed = new Map<string, number>();
  #arrived = Promise.withResolvers<void>();
  #closed = Promise.withResolvers<void>();
  #failure: Error | undefined;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data.toString());
      if (message.method === undefined) {
        const reply = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        if (message.error) reply?.reject(new Error(message.error.message));
        else reply?.resolve(message.result);
        return;
      }
      if (!this.#events.has(message.method)) this.#events.set(message.method, []);
      this.#events.get(message.method)!.push(message.params);
      this.#wake();
    });
    socket.addEventListener("close", () => {
      this.#failure ??= new Error("the inspector closed the socket");
      for (const reply of this.#pending.values()) reply.reject(this.#failure);
      this.#pending.clear();
      this.#wake();
      this.#closed.resolve();
    });
  }

  #wake() {
    const arrived = this.#arrived;
    this.#arrived = Promise.withResolvers<void>();
    arrived.resolve();
  }

  static async connect(url: string): Promise<InspectorClient> {
    const socket = new WebSocket(url);
    const client = new InspectorClient(socket);
    const opened = Promise.withResolvers<void>();
    socket.addEventListener("open", () => opened.resolve());
    socket.addEventListener("error", () => opened.reject(new Error(`cannot connect to the inspector at ${url}`)));
    await Promise.race([opened.promise, client.#closed.promise.then(() => Promise.reject(client.#failure))]);
    return client;
  }

  /** Resolves with the result of the command. Rejects with the error that the inspector answered. */
  send(method: string, params: object = {}): Promise<any> {
    if (this.#failure) return Promise.reject(this.#failure);
    const id = this.#nextId++;
    const reply = Promise.withResolvers<any>();
    this.#pending.set(id, reply);
    this.#socket.send(JSON.stringify({ id, method, params }));
    return reply.promise;
  }

  /**
   * Sends a command that lets the inspected process continue. The test does not wait for the
   * reply: a process that continues to its exit can end before it delivers the reply.
   */
  post(method: string, params: object = {}): void {
    this.send(method, params).catch(() => {});
  }

  async evaluate(expression: string): Promise<any> {
    const { result, wasThrown } = await this.send("Runtime.evaluate", { expression, returnByValue: true });
    if (wasThrown) throw new Error(`${expression} threw ${result.description}`);
    return result.value;
  }

  /** The params of the next `method` event that matches and that no earlier call returned. */
  async next(method: string, matches: (params: any) => boolean = () => true): Promise<any> {
    for (;;) {
      const events = this.#events.get(method) ?? [];
      for (let i = this.#consumed.get(method) ?? 0; i < events.length; i++) {
        this.#consumed.set(method, i + 1);
        if (matches(events[i])) return events[i];
      }
      if (this.#failure) throw this.#failure;
      await this.#arrived.promise;
    }
  }

  /** The params of every `method` event received so far. */
  all(method: string): any[] {
    return [...(this.#events.get(method) ?? [])];
  }

  async close(): Promise<void> {
    this.#failure ??= new Error("the test closed the socket");
    this.#socket.close();
    await this.#closed.promise;
  }

  [Symbol.dispose]() {
    this.#failure ??= new Error("the test closed the socket");
    this.#socket.close();
  }
}

/** `bun test` with an inspector. Its test files report on stderr and wait for the test to let them continue. */
class InspectedTestRun {
  readonly process: Subprocess<"ignore", "pipe", "pipe">;
  #stderr = "";
  #stderrEnded = false;
  #grew = Promise.withResolvers<void>();

  constructor(cwd: string, args: string[], env: NodeJS.Dict<string> = bunEnv) {
    this.process = spawn({
      cmd: [bunExe(), "test", ...args],
      cwd,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    (async () => {
      const decoder = new TextDecoder();
      for await (const chunk of this.process.stderr) {
        this.#stderr += decoder.decode(chunk, { stream: true });
        this.#wake();
      }
      this.#stderrEnded = true;
      this.#wake();
    })();
    // console.log of the test files. Read it so that the pipe never fills.
    this.process.stdout.text();
  }

  #wake() {
    const grew = this.#grew;
    this.#grew = Promise.withResolvers<void>();
    grew.resolve();
  }

  get stderr(): string {
    return this.#stderr;
  }

  /** The first match of `pattern` in stderr. Rejects when the process ends without one. */
  async stderrMatch(pattern: RegExp): Promise<RegExpMatchArray> {
    for (;;) {
      const match = this.#stderr.match(pattern);
      if (match) return match;
      if (this.#stderrEnded) throw new Error(`the process ended before ${pattern} in stderr:\n${this.#stderr}`);
      await this.#grew.promise;
    }
  }

  /** The WebSocket URL of the inspector. */
  async inspectorUrl(): Promise<string> {
    return (await this.stderrMatch(/^\s*(ws:\/\/\S+)$/m))[1];
  }

  async connect(): Promise<InspectorClient> {
    return InspectorClient.connect(await this.inspectorUrl());
  }

  /** Resolves when the test named `name` runs and waits. */
  async reached(name: string): Promise<void> {
    await this.stderrMatch(new RegExp(`^READY ${name}$`, "m"));
  }

  /** The result of the run. It has stderr only when the run did not end with exit code 0. */
  async finished() {
    const exitCode = await this.process.exited;
    await this.stderrMatch(/^Ran \d+ tests? across \d+ files?/m).catch(() => {});
    return {
      pass: Number(this.#stderr.match(/^\s*(\d+) pass$/m)?.[1]),
      fail: Number(this.#stderr.match(/^\s*(\d+) fail$/m)?.[1]),
      exitCode,
      signalCode: this.process.signalCode,
      ...(exitCode !== 0 && { stderr: this.#stderr }),
    };
  }

  async [Symbol.asyncDispose]() {
    this.process.kill();
    await this.process.exited;
  }
}

/**
 * A test file that puts `name` on its global, reports `READY <name>` on stderr, and waits until
 * an inspector client calls `release()`.
 */
function waitingTestFile(name: string, { imports = "", before = "", after = "" } = {}): string {
  return `
    import { test } from "bun:test";
    ${imports}
    test(${JSON.stringify(name)}, async () => {
      globalThis.marker = ${JSON.stringify(name)};
      ${before}
      process.stderr.write("READY ${name}\\n");
      await new Promise(resolve => (globalThis.release = resolve));
      ${after}
    }, 300_000);
  `;
}

function release(client: InspectorClient) {
  client.post("Runtime.evaluate", { expression: "globalThis.release()" });
}

// `bun test --isolate` gives each test file a new global object. The inspector session of the
// process must move to that global with its state.
describe.concurrent("bun test --isolate", () => {
  // A debug build takes seconds to start each `bun test` child and its debugger thread.
  const timeout = isASAN || isDebug ? 90_000 : 20_000;
  const isolated = ["--isolate", "--inspect=127.0.0.1:0"];
  const passed = (pass: number) => ({ pass, fail: 0, exitCode: 0, signalCode: null });

  test(
    "a client that attached in the first file is answered in the global of each later file",
    async () => {
      using dir = tempDir("inspect-isolate-commands", {
        "a.test.ts": waitingTestFile("A"),
        "b.test.ts": waitingTestFile("B"),
        "c.test.ts": waitingTestFile("C"),
      });
      await using run = new InspectedTestRun(String(dir), [...isolated, "./a.test.ts", "./b.test.ts", "./c.test.ts"]);
      await run.reached("A");
      using client = await run.connect();

      const markers: string[] = [];
      for (const name of ["A", "B", "C"]) {
        await run.reached(name);
        markers.push(await client.evaluate("globalThis.marker"));
        release(client);
      }
      expect(markers).toEqual(["A", "B", "C"]);
      expect(await run.finished()).toEqual(passed(3));
    },
    timeout,
  );

  test(
    "the domains that a client enabled in the first file report the later files",
    async () => {
      const logs = (name: string) => ({ before: `console.log("log from ${name}");` });
      using dir = tempDir("inspect-isolate-events", {
        "a.test.ts": waitingTestFile("A", logs("A")),
        "b.test.ts": waitingTestFile("B", logs("B")),
        "c.test.ts": waitingTestFile("C", logs("C")),
      });
      await using run = new InspectedTestRun(String(dir), [...isolated, "./a.test.ts", "./b.test.ts", "./c.test.ts"]);
      await run.reached("A");
      using client = await run.connect();
      for (const domain of ["Inspector", "Console", "Debugger", "TestReporter", "LifecycleReporter"]) {
        expect(await client.send(`${domain}.enable`)).toEqual({});
      }
      release(client);

      const seen: Record<string, object> = {};
      for (const name of ["B", "C"]) {
        await run.reached(name);
        const script = await client.next("Debugger.scriptParsed", p => p.url.endsWith(`${name.toLowerCase()}.test.ts`));
        const log = await client.next("Console.messageAdded", p => p.message.text === `log from ${name}`);
        const found = await client.next("TestReporter.found", p => p.name === name);
        seen[name] = {
          // One for each global object that replaced the one before.
          cleared: client.all("Debugger.globalObjectCleared").length,
          script: script.url.slice(-"x.test.ts".length),
          log: log.message.text,
          testId: found.id,
          started: (await client.next("TestReporter.start")).id,
          previousEnded: (await client.next("TestReporter.end")).id,
        };
        release(client);
      }
      expect(seen).toEqual({
        B: { cleared: 1, script: "b.test.ts", log: "log from B", testId: 2, started: 2, previousEnded: 1 },
        C: { cleared: 2, script: "c.test.ts", log: "log from C", testId: 3, started: 3, previousEnded: 2 },
      });
      // Each test is reported once: a new global does not report the tests of the earlier files again.
      expect(client.all("TestReporter.found").map(found => found.name)).toEqual(["A", "B", "C"]);
      expect(await run.finished()).toEqual(passed(3));
    },
    timeout,
  );

  test(
    "a breakpoint by URL and the pause on debugger statements from the first file pause in the next file",
    async () => {
      // The read makes the function object of `add`: the debugger reports to a client that
      // attaches the scripts that have one.
      const imports = `import { add } from "./helper.ts"; globalThis.add = add;`;
      using dir = tempDir("inspect-isolate-breakpoint", {
        "helper.ts": `export function add(a: number, b: number) {\n  const sum = a + b;\n  return sum;\n}\n`,
        "a.test.ts": waitingTestFile("A", { imports, after: `globalThis.sum = add(1, 2);` }),
        "b.test.ts": waitingTestFile("B", { imports, after: `globalThis.sum = add(1, 2);\ndebugger;` }),
      });
      await using run = new InspectedTestRun(String(dir), [...isolated, "./a.test.ts", "./b.test.ts"]);
      await run.reached("A");
      using client = await run.connect();
      await client.send("Debugger.enable");
      await client.send("Debugger.setBreakpointsActive", { active: true });
      await client.send("Debugger.setPauseOnDebuggerStatements", { enabled: true });
      // The debugger sees the transpiled source, so take the line of the statement from there.
      const helper = await client.next("Debugger.scriptParsed", p => p.url.endsWith("helper.ts"));
      const { scriptSource } = await client.send("Debugger.getScriptSource", { scriptId: helper.scriptId });
      const lineNumber = scriptSource.split("\n").findIndex((line: string) => line.includes("a + b"));
      expect(lineNumber).toBeGreaterThan(-1);
      const { breakpointId } = await client.send("Debugger.setBreakpointByUrl", { url: helper.url, lineNumber });

      const describe = (paused: any) => ({
        reason: paused.reason,
        breakpointId: paused.data?.breakpointId,
        functionName: paused.callFrames[0].functionName,
      });
      const atBreakpoint = { reason: "Breakpoint", breakpointId, functionName: "add" };

      release(client);
      expect(describe(await client.next("Debugger.paused"))).toEqual(atBreakpoint);
      client.post("Debugger.resume");

      await run.reached("B");
      release(client);
      expect(describe(await client.next("Debugger.paused"))).toEqual(atBreakpoint);
      client.post("Debugger.resume");
      const atStatement = await client.next("Debugger.paused");
      const { result } = await client.send("Debugger.evaluateOnCallFrame", {
        callFrameId: atStatement.callFrames[0].callFrameId,
        expression: "globalThis.marker + globalThis.sum",
        returnByValue: true,
      });
      expect({ reason: atStatement.reason, markerAndSum: result.value }).toEqual({
        reason: "DebuggerStatement",
        markerAndSum: "B3",
      });
      client.post("Debugger.resume");
      expect(await run.finished()).toEqual(passed(2));
    },
    timeout,
  );

  test(
    "a client that attaches in a later file gets the domains that Bun adds",
    async () => {
      using dir = tempDir("inspect-isolate-late", {
        "a.test.ts": waitingTestFile("A"),
        "b.test.ts": waitingTestFile("B"),
        "c.test.ts": waitingTestFile("C"),
      });
      await using run = new InspectedTestRun(String(dir), [...isolated, "./a.test.ts", "./b.test.ts", "./c.test.ts"]);
      await run.reached("A");
      using first = await run.connect();
      expect(await first.send("TestReporter.enable")).toEqual({});
      release(first);

      await run.reached("B");
      using late = await run.connect();
      const enabled: Record<string, object> = {};
      for (const domain of ["TestReporter", "LifecycleReporter", "HTTPServer", "BunFrontendDevServer"]) {
        enabled[domain] = await late.send(`${domain}.enable`).catch(error => ({ error: error.message }));
      }
      expect(enabled).toEqual({ TestReporter: {}, LifecycleReporter: {}, HTTPServer: {}, BunFrontendDevServer: {} });

      const markers = [await late.evaluate("globalThis.marker")];
      release(late);
      await run.reached("C");
      markers.push(await late.evaluate("globalThis.marker"));
      release(late);
      expect(markers).toEqual(["B", "C"]);
      expect(await run.finished()).toEqual(passed(3));
    },
    timeout,
  );

  test(
    "--inspect-wait: the client that the first file waited for is answered in the next file",
    async () => {
      using dir = tempDir("inspect-isolate-wait", {
        "a.test.ts": waitingTestFile("A"),
        "b.test.ts": waitingTestFile("B"),
      });
      await using run = new InspectedTestRun(String(dir), [
        "--isolate",
        "--inspect-wait=127.0.0.1:0",
        "./a.test.ts",
        "./b.test.ts",
      ]);
      using client = await run.connect();
      await client.send("Inspector.enable");
      await client.send("Inspector.initialized");

      const answers: Record<string, object> = {};
      for (const name of ["A", "B"]) {
        await run.reached(name);
        // Bun's injected script host says that a DOMException is an error. JavaScriptCore's does not.
        const { result } = await client.send("Runtime.evaluate", { expression: "new DOMException(globalThis.marker)" });
        answers[name] = { subtype: result.subtype, className: result.className };
        release(client);
      }
      expect(answers).toEqual({
        A: { subtype: "error", className: "DOMException" },
        B: { subtype: "error", className: "DOMException" },
      });
      expect(await run.finished()).toEqual(passed(2));
    },
    timeout,
  );

  test(
    "node:inspector: the server that the first file opened is the inspector of the later files",
    async () => {
      const imports = `import inspector from "node:inspector";`;
      using dir = tempDir("inspect-isolate-node-inspector", {
        "a.test.ts": waitingTestFile("A", { imports, before: `inspector.open(0, "127.0.0.1");` }),
        "b.test.ts": waitingTestFile("B", {
          imports,
          before: `
            let again;
            try {
              inspector.open(0, "127.0.0.1");
              again = "opened a second server";
            } catch (error) {
              again = error.code;
            }
            process.stderr.write("IN B " + JSON.stringify({ url: String(inspector.url()), again }) + "\\n");
          `,
          after: `
            inspector.close();
            process.stderr.write("CLOSED IN B " + JSON.stringify({ url: String(inspector.url()) }) + "\\n");
          `,
        }),
        "c.test.ts": `
          import { test } from "bun:test";
          ${imports}
          test("C", () => {
            const before = String(inspector.url());
            inspector.open(0, "127.0.0.1");
            process.stderr.write("IN C " + JSON.stringify({ before, opened: inspector.url() !== undefined }) + "\\n");
            inspector.close();
          });
        `,
      });
      await using run = new InspectedTestRun(String(dir), ["--isolate", "./a.test.ts", "./b.test.ts", "./c.test.ts"]);
      const report = async (label: string) =>
        JSON.parse((await run.stderrMatch(new RegExp(`^${label} (.*)$`, "m")))[1]);
      const [, url] = await run.stderrMatch(/^Debugger listening on (ws:\/\/\S+)$/m);
      await run.reached("A");
      // This server speaks the Chrome DevTools Protocol.
      using client = await InspectorClient.connect(url);
      const marker = async () => (await client.send("Runtime.evaluate", { expression: "globalThis.marker" })).result;
      await client.send("Runtime.enable");
      await client.send("Debugger.enable");
      expect(await marker()).toEqual({ type: "string", value: "A" });
      release(client);

      await run.reached("B");
      expect(await report("IN B")).toEqual({ url, again: "ERR_INSPECTOR_ALREADY_ACTIVATED" });
      // The client is told that its one execution context is a new one.
      await client.next("Runtime.executionContextsCleared");
      await client.next("Runtime.executionContextCreated");
      expect((await client.next("Runtime.executionContextCreated")).context.name).toBe("Bun");
      expect(await marker()).toEqual({ type: "string", value: "B" });
      release(client);

      expect(await report("CLOSED IN B")).toEqual({ url: "undefined" });
      expect(await report("IN C")).toEqual({ before: "undefined", opened: true });
      expect(await run.finished()).toEqual(passed(3));
    },
    timeout,
  );

  // Lets the event loop run, then collects: the global of a file that finished is destroyed here.
  const collectingTestFile = (name: string) => `
    import { test } from "bun:test";
    test(${JSON.stringify(name)}, async () => {
      Bun.gc(true);
      await new Promise(resolve => setImmediate(resolve));
      Bun.gc(true);
    });
  `;

  test(
    "a client that detached does not make a later file abort",
    async () => {
      using dir = tempDir("inspect-isolate-detach", {
        "a.test.ts": collectingTestFile("A"),
        // Waits for a file and not for the client: a Runtime.evaluate leaves an injected script
        // that keeps this file's global alive, and a global that stays alive is never destroyed.
        "b.test.ts": `
          import { test } from "bun:test";
          import { existsSync } from "node:fs";
          import { join } from "node:path";
          test("B", async () => {
            process.stderr.write("READY B\\n");
            while (!existsSync(join(import.meta.dir, "continue"))) await new Promise(resolve => setImmediate(resolve));
          }, 300_000);
        `,
        "c.test.ts": collectingTestFile("C"),
        "d.test.ts": collectingTestFile("D"),
        "e.test.ts": collectingTestFile("E"),
      });
      await using run = new InspectedTestRun(String(dir), [
        ...isolated,
        "./a.test.ts",
        "./b.test.ts",
        "./c.test.ts",
        "./d.test.ts",
        "./e.test.ts",
      ]);
      await run.reached("B");
      const client = await run.connect();
      // The reply shows that the inspected thread attached the client.
      expect(await client.send("Inspector.enable")).toEqual({});
      await client.close();
      // The debugger thread serves this after it saw the socket close, so it has told the
      // inspected thread to detach the client before the file continues.
      const { host } = new URL(await run.inspectorUrl());
      expect((await fetch(`http://${host}/json/version`)).status).toBe(200);
      fs.writeFileSync(join(String(dir), "continue"), "");
      expect(await run.finished()).toEqual(passed(5));
    },
    timeout,
  );

  test.each([[["--isolate"]], [[]]])(
    "%j: the process exits cleanly with a client attached when it destroys the VM on exit",
    async flags => {
      using dir = tempDir("inspect-isolate-exit", {
        "a.test.ts": waitingTestFile("A"),
        "b.test.ts": waitingTestFile("B"),
      });
      await using run = new InspectedTestRun(
        String(dir),
        [...flags, "--inspect=127.0.0.1:0", "./a.test.ts", "./b.test.ts"],
        { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1" },
      );
      await run.reached("A");
      using client = await run.connect();
      expect(await client.send("Debugger.enable")).toEqual({});
      expect(await client.evaluate("globalThis.marker")).toBe("A");
      release(client);
      await run.reached("B");
      // A second client, which attaches in the second file.
      using late = await run.connect();
      expect(await late.evaluate("globalThis.marker")).toBe("B");
      release(late);
      expect(await run.finished()).toEqual(passed(2));
    },
    timeout,
  );

  test(
    "the globals of the files that finished are collected while clients stay attached",
    async () => {
      const names = ["1", "2", "3", "4", "5", "6", "7", "8"];
      using dir = tempDir(
        "inspect-isolate-collect",
        Object.fromEntries(
          names.map(name => [
            `file_${name}.test.ts`,
            waitingTestFile(name, {
              imports: `import { heapStats } from "bun:jsc";`,
              before: `
                Bun.gc(true);
                Bun.gc(true);
                const stats = heapStats();
                process.stderr.write("GLOBALS " + stats.objectTypeCounts.GlobalObject + " PROTECTED " + stats.protectedGlobalObjectCount + "\\n");
              `,
            }),
          ]),
        ),
      );
      await using run = new InspectedTestRun(String(dir), [
        ...isolated,
        ...names.map(name => `./file_${name}.test.ts`),
      ]);
      using clients = new DisposableStack();
      for (const name of names) {
        await run.reached(name);
        // Each file gets a client of its own that stays attached. The client holds a remote
        // object of the file's global, and the console agent holds a message from that global.
        const client = clients.use(await run.connect());
        await client.send("Runtime.evaluate", { expression: "console.log({ file: globalThis.marker }), globalThis" });
        release(client);
      }
      const result = await run.finished();
      const counts = [...run.stderr.matchAll(/^GLOBALS (\d+) PROTECTED (\d+)$/gm)];
      expect({
        ...result,
        // Only the global of the file that runs is protected from collection.
        protectedGlobals: counts.map(count => Number(count[2])),
        globalsAreCollected: Math.max(...counts.map(count => Number(count[1]))) <= 4,
      }).toEqual({
        ...passed(8),
        protectedGlobals: [1, 1, 1, 1, 1, 1, 1, 1],
        globalsAreCollected: true,
      });
    },
    timeout,
  );
});
