import { Subprocess, spawn } from "bun";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, isASAN, isPosix, randomPort, tempDir } from "harness";
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

/**
 * Runs `script` in a bun that has an inspector. `send` sends one protocol message and resolves to
 * the reply, or to an error when the inspector closes the socket. `events` has the name of each
 * event the inspector sent.
 */
async function inspect(script: string, env: Record<string, string | undefined> = bunEnv) {
  const child = spawn({
    cmd: [bunExe(), "--inspect=ws://127.0.0.1:0/", "-e", script],
    env,
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
  const events: string[] = [];
  // A crash closes the socket. Resolve instead of rejecting so the failure shows up in what the test compares.
  const closed = Promise.withResolvers<Reply>();
  const opened = Promise.withResolvers<Reply>();
  const webSocket = new WebSocket(url);
  webSocket.addEventListener("open", () => opened.resolve({}));
  webSocket.addEventListener("close", () => closed.resolve({ error: { message: "the inspector closed the socket" } }));
  webSocket.addEventListener("error", () => closed.resolve({ error: { message: "the inspector socket failed" } }));
  webSocket.addEventListener("message", ({ data }) => {
    const reply: Reply & { id?: number; method?: string } = JSON.parse(data.toString());
    if (reply.id === undefined) {
      events.push(reply.method!);
      return;
    }
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

  return {
    child,
    send,
    events,
    async [Symbol.asyncDispose]() {
      webSocket.close();
      child.kill();
      await child.exited;
    },
  };
}

test("LifecycleReporter.getModuleGraph reports an empty argv when process.argv isn't an array", async () => {
  await using session = await inspect("setInterval(() => {}, 1000);");
  const { child, send } = session;

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
});

// queryHolders() of the console answers from a collection that reports each reference it follows.
// A Map and a Set keep their entries in a table that is a cell of its own, and so does a bound
// function with its arguments past the third: the table has to report what it holds.
test("queryHolders() finds the Map, the Set and the bound function that hold an object", async () => {
  await using session = await inspect(`
    globalThis.target = {};
    globalThis.holders = {
      object: { target },
      mapOfKeys: new Map([[target, 1]]),
      mapOfValues: new Map([["key", target]]),
      set: new Set([target]),
      bound: function () {}.bind(null, 1, 2, 3, target),
    };
    globalThis.nameOf = holder => Object.keys(holders).find(name => holders[name] === holder) ?? "other";
    delete globalThis.target;
    setInterval(() => {}, 1000);
  `);

  const reply = await session.send("Runtime.evaluate", {
    expression: "queryHolders(holders.object.target).map(nameOf).sort()",
    includeCommandLineAPI: true,
    returnByValue: true,
  });
  expect(reply.error ?? reply.result.result.value).toEqual(["bound", "mapOfKeys", "mapOfValues", "object", "set"]);
});

// What the Heap domain says when a snapshot fails. BUN_JSC_heapSnapshotBuilderEdgeLimitForTesting
// stands in for a heap with more edges than a snapshot can hold, which takes gigabytes to build.
describe("Heap: a snapshot that cannot hold its edges", () => {
  const heapEvents = (events: string[]) => events.filter(name => name.startsWith("Heap."));

  test("Heap.snapshot and Heap.startTracking reply with an error", async () => {
    await using session = await inspect("setInterval(() => {}, 1000);", {
      ...bunEnv,
      BUN_JSC_heapSnapshotBuilderEdgeLimitForTesting: "1000",
    });
    const outcome = async (method: string) => {
      const reply = await session.send(method);
      return reply.error?.message ?? reply.result;
    };

    expect({
      snapshot: await outcome("Heap.snapshot"),
      // A start that fails leaves tracking off: the second start takes a snapshot again.
      startTracking: await outcome("Heap.startTracking"),
      startTrackingAgain: await outcome("Heap.startTracking"),
      stopTracking: await outcome("Heap.stopTracking"),
      events: heapEvents(session.events),
    }).toEqual({
      snapshot: "Heap snapshot is too large",
      startTracking: "Heap snapshot is too large",
      startTrackingAgain: "Heap snapshot is too large",
      stopTracking: {},
      events: [],
    });
  });

  test("Heap.stopTracking replies with an error, sends no event and leaves tracking off", async () => {
    // The heap is under the limit at the start, and the array puts it over.
    await using session = await inspect("setInterval(() => {}, 1000);", {
      ...bunEnv,
      BUN_JSC_heapSnapshotBuilderEdgeLimitForTesting: "50000",
    });
    const outcome = async (method: string, params?: object) => {
      const reply = await session.send(method, params);
      return reply.error?.message ?? reply.result;
    };

    expect({
      startTracking: await outcome("Heap.startTracking"),
      grown: (
        await outcome("Runtime.evaluate", {
          expression: "(globalThis.elements = new Array(60000).fill({})).length",
          returnByValue: true,
        })
      ).result.value,
      stopTracking: await outcome("Heap.stopTracking"),
      stopTrackingAgain: await outcome("Heap.stopTracking"),
      events: heapEvents(session.events),
    }).toEqual({
      startTracking: {},
      grown: 60000,
      stopTracking: "Heap snapshot is too large",
      stopTrackingAgain: {},
      events: ["Heap.trackingStart"],
    });
  });

  // ASAN's allocator can be told to refuse a large allocation. Then the edges do not fit for the
  // reason they do not fit in a real heap: the Vector of the snapshot cannot grow.
  test.skipIf(!isASAN)("Heap.snapshot replies with an error when the edges cannot be allocated", async () => {
    await using session = await inspect(
      "globalThis.objects = Array.from({ length: 70_000 }, () => ({})); setInterval(() => {}, 1000);",
      {
        ...bunEnv,
        Malloc: "1",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "allocator_may_return_null=1", "max_allocation_size_mb=2", "detect_leaks=0"]
          .filter(Boolean)
          .join(":"),
      },
    );
    const reply = await session.send("Heap.snapshot");
    expect(reply.error?.message ?? reply.result).toBe("Heap snapshot is too large");
  });
});
