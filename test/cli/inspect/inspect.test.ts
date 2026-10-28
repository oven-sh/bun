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

// The time that a test file of a `bun test` child can wait for the test, so that no child stays behind.
const childTestTimeout = 30_000;

/** A `bun test` child. Its test files report on stderr, and wait for the test to let them continue. */
class TestRun {
  readonly process: Subprocess<"ignore", "ignore", "pipe">;
  readonly #cwd: string;
  readonly #end = Promise.withResolvers<never>();
  #stderr = "";
  #ended = false;
  #grew = Promise.withResolvers<void>();

  constructor(cwd: string, args: string[], env: NodeJS.Dict<string>) {
    this.#cwd = cwd;
    this.#end.promise.catch(() => {});
    this.process = spawn({
      cmd: [bunExe(), "test", `--timeout=${childTestTimeout}`, ...args],
      cwd,
      env,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    });
    (async () => {
      const decoder = new TextDecoder();
      for await (const chunk of this.process.stderr) {
        this.#stderr += decoder.decode(chunk, { stream: true });
        this.#wake();
      }
      this.#ended = true;
      this.#end.reject(new Error(`bun test ended:\n${this.#stderr}`));
      this.#wake();
    })();
  }

  #wake() {
    const grew = this.#grew;
    this.#grew = Promise.withResolvers<void>();
    grew.resolve();
  }

  /** The first match of `pattern` in stderr. Rejects when the process ends without one. */
  async stderrMatch(pattern: RegExp): Promise<RegExpMatchArray> {
    for (;;) {
      const match = this.#stderr.match(pattern);
      if (match) return match;
      if (this.#ended) throw new Error(`bun test ended before ${pattern} in stderr:\n${this.#stderr}`);
      await this.#grew.promise;
    }
  }

  /** Resolves when a test file reports that it waits for `name`. */
  async reached(name: string): Promise<void> {
    await this.stderrMatch(new RegExp(`^READY ${name}$`, "m"));
  }

  /** Lets the test files that wait for `name` continue. */
  release(name: string): void {
    fs.writeFileSync(join(this.#cwd, `continue-${name}`), "");
  }

  /** `promise`, or a rejection with stderr when the process ends first. */
  unlessEnded<T>(promise: Promise<T>): Promise<T> {
    return Promise.race([promise, this.#end.promise]);
  }

  /** The result of the run. It has stderr only when the run did not end with exit code 0. */
  async finished() {
    const exitCode = await this.process.exited;
    while (!this.#ended) await this.#grew.promise;
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
 * What an editor does for the processes of its terminals. It listens, each bun process dials it
 * (BUN_INSPECT_CONNECT_TO), and it enables the domains that the VS Code extension enables.
 */
function listenAsEditor(dialers = 1) {
  const enable = [
    "Inspector.enable",
    "Runtime.enable",
    "Console.enable",
    "LifecycleReporter.enable",
    "TestReporter.enable",
  ];
  const attached = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  attached.promise.catch(() => {});
  const sockets: { end(): void }[] = [];
  let answered = 0;
  let closedCount = 0;
  const listener = Bun.listen<SocketFramer>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        // The reply to the last command shows that the inspected thread attached this socket.
        socket.data = new SocketFramer(message => {
          if (JSON.parse(message).id === enable.length && ++answered === dialers) attached.resolve();
        });
        sockets.push(socket);
        enable.forEach((method, index) => socket.data.send(socket, JSON.stringify({ id: index + 1, method })));
      },
      data(socket, bytes) {
        socket.data.onData(socket, bytes);
      },
      close() {
        attached.reject(new Error("bun closed the inspector socket before it answered"));
        if (++closedCount === dialers) closed.resolve();
      },
    },
  });
  return {
    url: `tcp://127.0.0.1:${listener.port}`,
    /** Resolves when each process that dialed has answered. */
    attached: attached.promise,
    /** Closes each socket, as an editor that goes away does. */
    async close(): Promise<void> {
      for (const socket of sockets) socket.end();
      await closed.promise;
    },
    [Symbol.dispose]() {
      listener.stop(true);
    },
  };
}

// `bun test --isolate` gives each test file a new global object. The GC destroys the global object
// of a file that finished, and with it the inspector controller that a client attached to.
describe.concurrent("bun test --isolate", () => {
  // A debug build needs more than a second to start one `bun test` child with an inspector, and a case
  // here often needs more than the default of 5 s.
  const timeout = isDebug || isASAN ? 120_000 : undefined;
  const env = {
    ...bunEnv,
    // The exit destroys each global object that the GC did not destroy.
    BUN_DESTRUCT_VM_ON_EXIT: "1",
    // `bun test` sets no time zone for an empty TZ. When it sets one, a debug build keeps the
    // global object of the first test file alive to the end of the run.
    TZ: "",
  };
  // A compilation that waits for a JIT thread keeps the global object of a finished file alive.
  const envWithoutJITThreads = { ...env, BUN_JSC_useConcurrentJIT: "0" };
  const passed = (pass: number) => ({ pass, fail: 0, exitCode: 0, signalCode: null });

  // The GC destroys the global object of each file that finished, if nothing keeps it alive.
  const collect = `
      Bun.gc(true);
      await new Promise(resolve => setImmediate(resolve));
      Bun.gc(true);`;

  const collectingTestFile = `
    import { test } from "bun:test";
    test("collects", async () => {${collect}
    });
  `;

  // Reports `READY <name>` on stderr, waits for the file `continue-<name>`, and collects.
  const waitingTestFile = (name: string, before = "") => `
    import { test } from "bun:test";
    import { existsSync } from "node:fs";
    import { join } from "node:path";
    test("waits for ${name}", async () => {${before}
      process.stderr.write("READY ${name}\\n");
      while (!existsSync(join(import.meta.dir, "continue-${name}"))) await Bun.sleep(1);${collect}
    });
  `;

  test(
    "a file that closed the client of its own node:inspector does not make a later file abort",
    async () => {
      using dir = tempDir("inspect-isolate-node-inspector", {
        "a.test.ts": `
          import { test, expect } from "bun:test";
          import inspector from "node:inspector";
          test("is the client of its own inspector", async () => {
            inspector.open(0, "127.0.0.1");
            const socket = new WebSocket(inspector.url());
            const reply = Promise.withResolvers();
            socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: "Debugger.enable" }));
            socket.onmessage = ({ data }) => {
              const message = JSON.parse(data);
              if (message.id === 1) reply.resolve(message.result);
            };
            socket.onclose = () => reply.reject(new Error("the inspector closed the socket"));
            // The reply shows that the global object of this file attached the client.
            expect(await reply.promise).toEqual({ debuggerId: "(bun)" });
            // Returns after the inspector dropped the client.
            inspector.close();
          });
        `,
        "b.test.ts": collectingTestFile,
      });
      await using run = new TestRun(String(dir), ["--isolate", "./a.test.ts", "./b.test.ts"], envWithoutJITThreads);
      expect(await run.finished()).toEqual(passed(2));
    },
    timeout,
  );

  test(
    "BUN_INSPECT_CONNECT_TO: an editor that goes away during a later file does not make the run abort",
    async () => {
      using dir = tempDir("inspect-isolate-editor", {
        "a.test.ts": waitingTestFile("A"),
        "b.test.ts": waitingTestFile("B"),
      });
      using editor = listenAsEditor();
      await using run = new TestRun(String(dir), ["--isolate", "./a.test.ts", "./b.test.ts"], {
        ...envWithoutJITThreads,
        BUN_INSPECT_CONNECT_TO: editor.url,
      });
      // The first file waits, so its global object is the one that attaches the editor.
      await run.unlessEnded(editor.attached);
      run.release("A");
      await run.reached("B");
      await run.unlessEnded(editor.close());
      // The second file now collects the global object of the first file.
      run.release("B");
      expect(await run.finished()).toEqual(passed(2));
    },
    timeout,
  );

  test(
    "--parallel with BUN_INSPECT_CONNECT_TO: an editor that goes away does not make a worker abort",
    async () => {
      const workers = 2;
      using dir = tempDir("inspect-parallel-editor", {
        "a.test.ts": waitingTestFile("all"),
        "b.test.ts": waitingTestFile("all"),
        "c.test.ts": waitingTestFile("all"),
      });
      // Each worker dials the editor, and the coordinator does too.
      using editor = listenAsEditor(workers + 1);
      await using run = new TestRun(String(dir), [`--parallel=${workers}`, "--parallel-delay=0"], {
        ...envWithoutJITThreads,
        BUN_INSPECT_CONNECT_TO: editor.url,
      });
      await run.unlessEnded(editor.attached);
      await run.unlessEnded(editor.close());
      // The worker that runs a second file collects the global object of its first file there.
      run.release("all");
      expect(await run.finished()).toEqual(passed(3));
    },
    timeout,
  );

  test.each([[["--isolate"]], [[]]])(
    "%j with BUN_INSPECT_CONNECT_TO: the process exits cleanly while the editor of the first file is attached",
    async flags => {
      using dir = tempDir("inspect-isolate-exit", {
        "a.test.ts": waitingTestFile("A"),
        "b.test.ts": collectingTestFile,
      });
      using editor = listenAsEditor();
      await using run = new TestRun(String(dir), [...flags, "./a.test.ts", "./b.test.ts"], {
        ...env,
        BUN_INSPECT_CONNECT_TO: editor.url,
      });
      await run.unlessEnded(editor.attached);
      run.release("A");
      expect(await run.finished()).toEqual(passed(2));
    },
    timeout,
  );

  test(
    "a client that attaches after the swap to the next file detaches from the global object that attached it",
    async () => {
      using dir = tempDir("inspect-isolate-attach-after-swap", {
        // The immediate runs when the file has finished, after the last time its event loop takes
        // tasks from other threads, and it holds the inspected thread there. So the debugger thread
        // creates the connection of a client for the global object of this file, and the inspected
        // thread attaches the client to the global object of the next file.
        "a.test.ts": `
          import { test } from "bun:test";
          import { existsSync, writeSync } from "node:fs";
          import { join } from "node:path";
          test("holds the inspected thread after its last turn", () => {
            setImmediate(() => {
              writeSync(2, "READY A\\n");
              const deadline = Date.now() + ${childTestTimeout};
              while (!existsSync(join(import.meta.dir, "continue-A")) && Date.now() < deadline) Bun.sleepSync(1);
            });
          });
        `,
        // It collects before it reports: the GC has then destroyed the global object of the first file.
        "b.test.ts": `globalThis.marker = "B";` + waitingTestFile("B", collect),
        "c.test.ts": collectingTestFile,
      });
      await using run = new TestRun(
        String(dir),
        ["--isolate", "--inspect=127.0.0.1:0", "./a.test.ts", "./b.test.ts", "./c.test.ts"],
        envWithoutJITThreads,
      );
      const [, url] = await run.stderrMatch(/^\s*(ws:\/\/\S+)$/m);
      const versionUrl = `http://${new URL(url).host}/json/version`;
      await run.reached("A");

      const socket = new WebSocket(url);
      const opened = Promise.withResolvers<void>();
      const closed = Promise.withResolvers<void>();
      socket.addEventListener("open", () => opened.resolve());
      socket.addEventListener("error", () => opened.reject(new Error(`cannot connect to the inspector at ${url}`)));
      socket.addEventListener("close", () => closed.resolve());
      /** The reply to one command. Rejects when the socket closes or the process ends first. */
      const command = (id: number, method: string, params: object = {}) => {
        const reply = Promise.withResolvers<any>();
        socket.addEventListener("message", ({ data }) => {
          const message = JSON.parse(data.toString());
          if (message.id === id) reply.resolve(message.result);
        });
        socket.addEventListener("close", () =>
          reply.reject(new Error(`the inspector closed the socket before ${method}`)),
        );
        socket.send(JSON.stringify({ id, method, params }));
        return run.unlessEnded(reply.promise);
      };
      // The debugger thread answers this request after it handled what the client sent before. If
      // the request fails, the answer has the error and how the process ended.
      const debuggerThreadCaughtUp = async () => {
        const answer = await fetch(versionUrl).then(
          response => ({ status: response.status }),
          async error => ({ error: String(error), ...(await run.finished()) }),
        );
        expect(answer).toEqual({ status: 200 });
      };
      await run.unlessEnded(opened.promise);
      const enabled = command(1, "Inspector.enable");
      // The debugger thread has created the connection of the client, and has the command for it.
      await debuggerThreadCaughtUp();
      run.release("A");
      expect(await enabled).toEqual({});

      await run.reached("B");
      // The global object of the second file attached the client, so it answers.
      expect(await command(2, "Runtime.evaluate", { expression: "globalThis.marker", returnByValue: true })).toEqual({
        result: { type: "string", value: "B" },
        wasThrown: false,
      });
      socket.close();
      await closed.promise;
      // The debugger thread has told the inspected thread to detach the client.
      await debuggerThreadCaughtUp();
      run.release("B");
      expect(await run.finished()).toEqual(passed(3));
    },
    timeout,
  );
});
