/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js. The expected
 * values come from Node.js v26.3.0.
 *
 * libuv does not report a unix socket connect that fails at connect(2) from
 * inside the call. It queues the callback on the loop, so the socket is still
 * connecting in every tick and microtask of the calling turn:
 * https://github.com/nodejs/node/blob/v26.3.0/deps/uv/src/unix/pipe.c#L333-L343
 * Only a name it cannot express fails in the call:
 * https://github.com/nodejs/node/blob/v26.3.0/deps/uv/src/unix/pipe.c#L266-L280
 */
import assert from "node:assert";
import { AsyncLocalStorage } from "node:async_hooks";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

// Node.js cannot load the harness.
const harness = typeof Bun !== "undefined" ? await import("harness") : undefined;
const childEnv = harness ? harness.bunEnv : process.env;
const posixTest = process.platform === "win32" ? test.skip : test;
const bunTest = process.versions.bun && process.platform !== "win32" ? test : test.skip;

// A short base: Node.js fails a name that does not fit sun_path inside connect(), and TMPDIR can be long.
const base = process.platform === "win32" ? os.tmpdir() : "/tmp";
const dirs: string[] = [];
function makeDir() {
  const dir = fs.mkdtempSync(path.join(base, "ucf-"));
  dirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));
const closeOf = (emitter: { on(event: "close", listener: () => void): unknown }) =>
  new Promise<void>(resolve => emitter.on("close", () => resolve()));

function run(script: string, ...args: string[]) {
  return new Promise<{ stdout: string[]; stderr: string; exitCode: number | null }>((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script, ...args], {
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => (stdout += chunk));
    child.stderr.on("data", chunk => (stderr += chunk));
    child.on("error", reject);
    child.on("close", exitCode => resolve({ stdout: stdout.trim().split("\n"), stderr, exitCode }));
  });
}

describe("a unix socket connect that fails at connect(2)", () => {
  posixTest("is still connecting in the ticks and microtasks of the calling turn", async () => {
    const seen: Record<string, string> = {};
    const events: string[] = [];
    const socket = net.connect(path.join(makeDir(), "none.sock"));
    const state = () => `connecting=${socket.connecting} destroyed=${socket.destroyed}`;
    seen.returned = state();
    socket.on("connectionAttemptFailed", () => events.push("connectionAttemptFailed"));
    socket.on("error", (e: NodeJS.ErrnoException) => events.push(`error ${e.code}`));
    const closed = new Promise<void>(resolve => {
      socket.on("close", hadError => {
        events.push(`close ${hadError}`);
        resolve();
      });
    });
    process.nextTick(() => {
      seen.tick = state();
      // The socket holds a write made while it connects and fails it when it closes.
      socket.write("hello", e => events.push(`write callback ${(e as NodeJS.ErrnoException | undefined)?.code}`));
    });
    queueMicrotask(() => {
      seen.microtask = state();
    });
    await closed;
    await nextTurn();
    assert.deepStrictEqual(
      { seen, events },
      {
        seen: {
          returned: "connecting=true destroyed=false",
          tick: "connecting=true destroyed=false",
          microtask: "connecting=true destroyed=false",
        },
        events: [
          "connectionAttemptFailed",
          "error ENOENT",
          "close true",
          "write callback ERR_SOCKET_CLOSED_BEFORE_CONNECTION",
        ],
      },
    );
  });

  // Closing the handle cancels the request: afterConnect sees a destroyed socket and reports nothing.
  for (const [name, reason, expected] of [
    ["destroy()", undefined, ["close false"]],
    ["destroy(err)", Object.assign(new Error("mine"), { code: "E_MINE" }), ["error E_MINE", "close true"]],
  ] as const) {
    posixTest(`${name} in a tick after connect() is the only thing reported`, async () => {
      const events: string[] = [];
      const socket = net.connect(path.join(makeDir(), "none.sock"));
      socket.on("connectionAttemptFailed", () => events.push("connectionAttemptFailed"));
      socket.on("error", (e: NodeJS.ErrnoException) => events.push(`error ${e.code}`));
      const closed = new Promise<void>(resolve => {
        socket.on("close", hadError => {
          events.push(`close ${hadError}`);
          resolve();
        });
      });
      process.nextTick(() => socket.destroy(reason));
      await closed;
      await nextTurn();
      await nextTurn();
      assert.deepStrictEqual(events, [...expected]);
    });
  }

  // Only in Bun: Node.js fails an internal assertion when the request of the closed handle completes.
  bunTest("destroy() and a new connect() are not failed by the first connect", async () => {
    const dir = makeDir();
    const server = net.createServer(connection => {
      connection.on("error", () => {});
      connection.end("hello");
    });
    await new Promise<void>(resolve => server.listen(path.join(dir, "live.sock"), resolve));
    try {
      const events: string[] = [];
      const socket = net.connect(path.join(dir, "none.sock"));
      const done = Promise.withResolvers<void>();
      socket.on("error", (e: NodeJS.ErrnoException) => {
        events.push(`error ${e.code}`);
        done.resolve();
      });
      socket.on("connect", () => events.push("connect"));
      socket.on("data", chunk => {
        events.push(`data ${chunk}`);
        done.resolve();
      });
      socket.destroy();
      socket.connect(path.join(dir, "live.sock"));
      await done.promise;
      socket.destroy();
      assert.deepStrictEqual(events, ["connect", "data hello"]);
    } finally {
      server.close();
    }
  });

  // Only in Bun: Node.js gives the path to the TCP handle of the first connect() and reports EINVAL.
  bunTest("fails inside connect() when an earlier connect() of the socket is pending", async () => {
    const server = net.createServer(connection => connection.destroy());
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const events: string[] = [];
      const socket = new net.Socket();
      socket.on("connect", () => {
        events.push("connect");
        socket.destroy();
      });
      socket.on("error", (e: NodeJS.ErrnoException) => events.push(`error ${e.code}`));
      const closed = new Promise<void>(resolve => {
        socket.on("close", hadError => {
          events.push(`close ${hadError}`);
          resolve();
        });
      });
      socket.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
      socket.connect(path.join(makeDir(), "none.sock"));
      const destroyedOnReturn = socket.destroyed;
      await closed;
      await nextTurn();
      assert.deepStrictEqual(
        { destroyedOnReturn, events },
        { destroyedOnReturn: true, events: ["error ENOENT", "close true"] },
      );
    } finally {
      server.close();
    }
  });

  // Node.js throws a TypeError from connect() here: it reads `connect` of the handle that destroy() cleared.
  bunTest("a 'connectionAttempt' listener that destroys the socket gets only 'close'", async () => {
    const events: string[] = [];
    const socket = new net.Socket();
    socket.on("connectionAttempt", () => socket.destroy());
    socket.on("error", (e: NodeJS.ErrnoException) => events.push(`error ${e.code ?? e.name}`));
    const closed = new Promise<void>(resolve => {
      socket.on("close", hadError => {
        events.push(`close ${hadError}`);
        resolve();
      });
    });
    socket.connect(path.join(makeDir(), "none.sock"));
    await closed;
    await nextTurn();
    assert.deepStrictEqual(events, ["close false"]);
  });

  // libuv reports the failure, so a fake clock that replaces the timer globals does not hold it.
  posixTest("is reported while a fake clock holds the global setImmediate", async () => {
    const events: string[] = [];
    const held: (() => void)[] = [];
    const realSetImmediate = globalThis.setImmediate;
    globalThis.setImmediate = ((callback: (...args: unknown[]) => void, ...args: unknown[]) => {
      held.push(() => callback(...args));
    }) as unknown as typeof setImmediate;
    try {
      const socket = net.connect(path.join(makeDir(), "none.sock"));
      socket.on("error", (e: NodeJS.ErrnoException) => events.push(`error ${e.code}`));
      // The failure is due on the next turn of the loop: a held one is still missing after eight.
      for (let turn = 0; turn < 8 && events.length === 0; turn++) {
        await new Promise<void>(resolve => realSetImmediate(resolve));
      }
    } finally {
      globalThis.setImmediate = realSetImmediate;
      for (const release of held) release();
    }
    assert.deepStrictEqual(events, ["error ENOENT"]);
  });

  // uv_pipe_connect2 has no EALREADY, a later connect() replaces the request: https://github.com/nodejs/node/blob/v26.3.0/deps/uv/src/unix/pipe.c#L333-L334
  describe("a second connect() before the first is reported", () => {
    async function secondConnect(first: "missing" | "live", second: "missing" | "live") {
      const dir = makeDir();
      const paths = { missing: path.join(dir, "none.sock"), live: path.join(dir, "live.sock") };
      let connections = 0;
      const accepted = Promise.withResolvers<void>();
      const server = net.createServer(connection => {
        connections++;
        connection.on("error", () => {});
        connection.resume();
        accepted.resolve();
      });
      await new Promise<void>(resolve => server.listen(paths.live, resolve));
      try {
        const events: string[] = [];
        const socket = net.connect(paths[first]);
        const connected = new Promise<void>(resolve => {
          socket.on("connect", () => {
            events.push("connect");
            resolve();
          });
        });
        socket.on("error", (e: NodeJS.ErrnoException) => events.push(`error ${e.code}`));
        const closed = new Promise<void>(resolve => {
          socket.on("close", hadError => {
            events.push(`close ${hadError}`);
            resolve();
          });
        });
        socket.connect(paths[second]);
        if (second === "live") {
          await Promise.race([connected, closed]);
          if (!socket.destroyed) {
            await accepted.promise;
            socket.destroy();
          }
        }
        await closed;
        await nextTurn();
        return { events, connections };
      } finally {
        server.close();
      }
    }

    // Only in Bun: Node.js keeps the request that was replaced active, and its process never exits.
    bunTest("missing then missing: one error", async () => {
      assert.deepStrictEqual(await secondConnect("missing", "missing"), {
        events: ["error ENOENT", "close true"],
        connections: 0,
      });
    });
    bunTest("missing then live: connects, the first failure is not reported", async () => {
      assert.deepStrictEqual(await secondConnect("missing", "live"), {
        events: ["connect", "close false"],
        connections: 1,
      });
    });
    bunTest("live then missing: the second failure is reported", async () => {
      assert.deepStrictEqual((await secondConnect("live", "missing")).events, ["error ENOENT", "close true"]);
    });
  });

  posixTest("a name that does not fit sun_path fails inside connect()", async () => {
    const events: string[] = [];
    const socket = net.connect(path.join(makeDir(), Buffer.alloc(200, "a").toString() + ".sock"));
    const destroyedOnReturn = socket.destroyed;
    socket.on("connectionAttemptFailed", () => events.push("connectionAttemptFailed"));
    socket.on("error", (e: NodeJS.ErrnoException) => events.push(`error ${e.code}`));
    await closeOf(socket);
    assert.deepStrictEqual({ destroyedOnReturn, events }, { destroyedOnReturn: true, events: ["error EINVAL"] });
  });

  // The kernel reads sun_path as a C string, so a dial of this name reaches the listener of the name before the NUL.
  posixTest("a name with a NUL fails inside connect() and dials nothing", async () => {
    const live = path.join(makeDir(), "live.sock");
    let connections = 0;
    let onProbe = () => {};
    const server = net.createServer(connection => {
      connections++;
      connection.on("error", () => {});
      // Only the probe writes. The accept queue is in order: every earlier connection is counted by then.
      connection.on("data", () => onProbe());
    });
    await new Promise<void>(resolve => server.listen(live, resolve));
    try {
      const events: string[] = [];
      const socket = net.connect(live + "\0ignored");
      const destroyedOnReturn = socket.destroyed;
      socket.on("connectionAttemptFailed", () => events.push("connectionAttemptFailed"));
      socket.on("connect", () => {
        events.push("connect");
        socket.destroy();
      });
      socket.on("error", (e: NodeJS.ErrnoException) => events.push(`error ${e.code}`));
      await closeOf(socket);
      const probe = net.connect(live, () => probe.write("probe"));
      await new Promise<void>((resolve, reject) => {
        onProbe = resolve;
        probe.on("error", reject);
      });
      probe.destroy();
      assert.deepStrictEqual(
        { destroyedOnReturn, events, connections: connections - 1 },
        { destroyedOnReturn: true, events: ["error EINVAL"], connections: 0 },
      );
    } finally {
      server.close();
    }
  });

  posixTest("runs its listeners in the async context of the connect() call", async () => {
    const storage = new AsyncLocalStorage<string>();
    const seen: Record<string, string | undefined> = {};
    const closed = Promise.withResolvers<void>();
    storage.run("the store", () => {
      const socket = net.connect(path.join(makeDir(), "none.sock"));
      socket.on("connectionAttemptFailed", () => (seen.connectionAttemptFailed = storage.getStore()));
      socket.on("error", () => (seen.error = storage.getStore()));
      socket.on("close", () => {
        seen.close = storage.getStore();
        closed.resolve();
      });
      socket.write("hello", () => (seen.write = storage.getStore()));
    });
    await closed.promise;
    await nextTurn();
    assert.deepStrictEqual(seen, {
      connectionAttemptFailed: "the store",
      error: "the store",
      close: "the store",
      write: "the store",
    });
  });

  // Node's Pipe handle has no setTypeOfService: the socket keeps the value.
  posixTest("setTypeOfService() keeps the value, also in the listeners of the failure", async () => {
    const seen: Record<string, number> = {};
    const socket = net.connect(path.join(makeDir(), "none.sock"));
    seen.returned = socket.setTypeOfService(0x10).getTypeOfService();
    socket.on("connectionAttemptFailed", () => {
      seen.connectionAttemptFailed = socket.setTypeOfService(0x20).getTypeOfService();
    });
    socket.on("error", () => {
      seen.error = socket.setTypeOfService(0x30).getTypeOfService();
    });
    await closeOf(socket);
    assert.deepStrictEqual(seen, { returned: 0x10, connectionAttemptFailed: 0x20, error: 0x30 });
  });

  posixTest("a redial from 'error' returns to the event loop", async () => {
    const target = path.join(makeDir(), "none.sock");
    const total = 64;
    let attempts = 0;
    let attemptsAtFirstImmediate = -1;
    await new Promise<void>(resolve => {
      setImmediate(() => {
        attemptsAtFirstImmediate = attempts;
      });
      (function dial() {
        net.connect(target).on("error", () => {
          // Stops once the immediate ran, or after `total` attempts if it never got to.
          if (++attempts < total && attemptsAtFirstImmediate < 0) dial();
          else resolve();
        });
      })();
    });
    assert.ok(attemptsAtFirstImmediate >= 0, `the immediate had not run after ${attempts} attempts`);
  });

  describe("through every node entry point", () => {
    posixTest("tls.connect({ path })", async () => {
      const events: string[] = [];
      const socket = tls.connect({ path: path.join(makeDir(), "none.sock"), rejectUnauthorized: false });
      socket.on("error", (e: NodeJS.ErrnoException) => events.push(`error ${e.code}`));
      const closed = closeOf(socket);
      process.nextTick(() => events.push(`tick: connecting=${socket.connecting} destroyed=${socket.destroyed}`));
      await closed;
      assert.deepStrictEqual(events, ["tick: connecting=true destroyed=false", "error ENOENT"]);
    });

    posixTest("http2.connect(authority, { path })", async () => {
      const events: string[] = [];
      const session = http2.connect("http://localhost", { path: path.join(makeDir(), "none.sock") });
      session.on("error", (e: NodeJS.ErrnoException) => events.push(`error ${e.code}`));
      const closed = closeOf(session);
      process.nextTick(() => events.push(`tick: connecting=${session.connecting} destroyed=${session.destroyed}`));
      await closed;
      assert.deepStrictEqual(events, ["tick: connecting=true destroyed=false", "error ENOENT"]);
    });

    (process.platform === "linux" ? test : test.skip)("an abstract name", async () => {
      const events: string[] = [];
      const socket = net.connect(`\0bun-unix-connect-failure-${process.pid}-${Math.random().toString(36).slice(2)}`);
      events.push(`returned: connecting=${socket.connecting} destroyed=${socket.destroyed}`);
      socket.on("connectionAttemptFailed", () => events.push("connectionAttemptFailed"));
      socket.on("error", (e: NodeJS.ErrnoException) => events.push(`error ${e.code}`));
      await closeOf(socket);
      assert.deepStrictEqual(events, [
        "returned: connecting=true destroyed=false",
        "connectionAttemptFailed",
        "error ECONNREFUSED",
      ]);
    });

    posixTest("http.request({ socketPath }) emits 'socket' before 'error'", async () => {
      const events: string[] = [];
      const err = await new Promise<NodeJS.ErrnoException>(resolve => {
        const req = http.request({ socketPath: path.join(makeDir(), "none.sock"), path: "/", agent: false });
        req.on("socket", () => events.push("socket"));
        req.on("error", e => {
          events.push(`error ${req.socket ? "with" : "without"} req.socket`);
          resolve(e);
        });
        req.end();
      });
      assert.deepStrictEqual(
        { code: err.code, events },
        { code: "ENOENT", events: ["socket", "error with req.socket"] },
      );
    });

    // A write made before the socket is assigned is flushed while the socket connects, and fails when the connect fails.
    for (const [name, file, request, options] of [
      ["http, agent: false", "none.sock", http.request, { agent: false }],
      ["http, default agent", "none.sock", http.request, {}],
      ["https, agent: false", "none.sock", https.request, { agent: false, rejectUnauthorized: false }],
      ["http, a path that is a plain file", "file.sock", http.request, { agent: false }],
    ] as const) {
      posixTest(`a write buffered before the connect gets its callback (${name})`, async () => {
        const dir = makeDir();
        fs.writeFileSync(path.join(dir, "file.sock"), "");
        const events: string[] = [];
        const req = request({ socketPath: path.join(dir, file), method: "POST", path: "/", ...options });
        req.on("socket", socket => events.push(`socket connecting=${socket.connecting}`));
        // A plain file refuses the connect: ECONNREFUSED on Linux, ENOTSOCK on macOS.
        req.on("error", (e: NodeJS.ErrnoException) =>
          events.push(`error ${e.code}`.replace("ENOTSOCK", "ECONNREFUSED")),
        );
        const closed = new Promise<void>(resolve => {
          req.on("close", () => {
            events.push("close");
            resolve();
          });
        });
        req.write("hello", e => events.push(`write callback ${(e as NodeJS.ErrnoException | undefined)?.code}`));
        await closed;
        await nextTurn();
        assert.deepStrictEqual(events, [
          "socket connecting=true",
          file === "none.sock" ? "error ENOENT" : "error ECONNREFUSED",
          "close",
          "write callback ERR_SOCKET_CLOSED_BEFORE_CONNECTION",
        ]);
      });
    }

    posixTest("req.destroy() before the socket is assigned reports a hang up, not the connect error", async () => {
      const events: string[] = [];
      const req = http.request({
        socketPath: path.join(makeDir(), "none.sock"),
        method: "POST",
        path: "/",
        agent: false,
      });
      req.on("socket", () => events.push("socket"));
      req.on("error", (e: NodeJS.ErrnoException) => events.push(`error ${e.code} ${e.message}`));
      const closed = closeOf(req);
      req.destroy();
      await closed;
      await nextTurn();
      assert.deepStrictEqual(events, ["error ECONNRESET socket hang up"]);
    });
  });

  // When a socket closes, the agent dials again for the next queued request: a socket that fails inside connect() has none yet.
  posixTest("an agent at its socket limit fails every queued request once", async () => {
    const target = path.join(makeDir(), "none.sock");
    const agent = new http.Agent({ maxSockets: 1 });
    const requests = 3;
    const errors: string[] = [];
    const done = Promise.withResolvers<void>();
    let dials = 0;
    const createConnection = agent.createConnection;
    agent.createConnection = function (...args) {
      // One dial more than there are requests is the loop: end it, so that the test fails and does not hang.
      if (++dials > requests) return void done.resolve();
      return createConnection.apply(this, args)?.on("error", () => {});
    };
    try {
      for (let i = 0; i < requests; i++) {
        const req = http.request({ socketPath: target, agent, path: `/${i}` });
        req.on("error", (e: NodeJS.ErrnoException) => {
          errors.push(`request ${i} error ${e.code}`);
          if (errors.length === requests) done.resolve();
        });
        req.end();
      }
      await done.promise;
      await nextTurn();
    } finally {
      agent.destroy();
    }
    assert.deepStrictEqual(
      { dials, errors },
      { dials: requests, errors: ["request 0 error ENOENT", "request 1 error ENOENT", "request 2 error ENOENT"] },
    );
  });

  describe("in a process of its own", () => {
    // Inside an immediate nothing else holds the loop: the failure does, like a request in flight, and unref() does not drop it.
    posixTest("is reported for a socket that was unref()ed", async () => {
      const result = await run(
        `
        const net = require("node:net");
        setImmediate(() => {
          const socket = net.connect(process.argv[1]);
          socket.unref();
          socket.on("error", e => console.log("error " + e.code));
          socket.on("close", () => console.log("close"));
        });
        `,
        path.join(makeDir(), "none.sock"),
      );
      assert.deepStrictEqual(result, { stdout: ["error ENOENT", "close"], stderr: "", exitCode: 0 });
    });

    // The connect and the exit are in the same batch of immediates, so the failure is still queued at the exit.
    posixTest("is not reported when the process exits with the failure still queued", async () => {
      const result = await run(
        `
        const net = require("node:net");
        setImmediate(() => net.connect(process.argv[1]).on("error", e => console.log("error " + e.code)));
        setImmediate(() => process.exit(0));
        `,
        path.join(makeDir(), "none.sock"),
      );
      assert.deepStrictEqual(result, { stdout: [""], stderr: "", exitCode: 0 });
    });
  });

  // Each way a failure that is still queued can end must give back the socket.
  bunTest("does not retain the socket, however the attempt ends", async () => {
    const target = path.join(makeDir(), "none.sock");
    const dials = 16;
    const ends: ((socket: net.Socket) => void)[] = [
      () => {},
      socket => process.nextTick(() => socket.destroy()),
      socket => socket.connect(target),
    ];
    const sockets: WeakRef<net.Socket>[] = [];
    for (const end of ends) {
      await Promise.all(
        Array.from({ length: dials }, () => {
          const socket = net.connect(target);
          sockets.push(new WeakRef(socket));
          socket.on("error", () => {});
          end(socket);
          return closeOf(socket);
        }),
      );
    }
    await nextTurn();
    Bun.gc(true);
    const live = sockets.filter(socket => socket.deref()).length;
    assert.ok(live < dials, `${live} of ${sockets.length} sockets are still alive`);
  });
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (harness) {
  const node = harness.nodeExe();
  // The expected values come from Node.js 26: an older one cannot parse this file or lacks what it tests.
  const nodeMajor = node
    ? parseInt(Bun.spawnSync({ cmd: [node, "-p", "process.versions.node"], env: harness.bunEnv }).stdout.toString(), 10)
    : 0;

  describe("Node.js compatibility", () => {
    (nodeMajor >= 26 ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run: `node --test` forks a second process per file, and node:test exits non-zero on a failure anyway.
      await using proc = Bun.spawn({
        cmd: [node!, fileURLToPath(import.meta.url)],
        env: harness.bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
