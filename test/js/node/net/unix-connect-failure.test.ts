import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isWindows, tempDir } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import net from "node:net";
import { join } from "node:path";
import tls from "node:tls";

// libuv does not report a unix socket connect that fails at connect(2) from
// inside the call. It queues the callback on the loop (`uv__io_feed`), so the
// socket is still connecting in every tick and microtask of the calling turn,
// and fails before the immediates that turn queued. Only a name libuv cannot
// express fails inside the call.
const itPosix = it.skipIf(isWindows);
const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));
// A debug or ASAN child takes seconds to start, and these run side by side.
const slow = isDebug || isASAN;
const childTimeout = slow ? 60_000 : undefined;

describe.concurrent("a unix socket connect that fails at connect(2)", () => {
  itPosix("is still connecting in the ticks and microtasks of the calling turn", async () => {
    using dir = tempDir("unix-connect-failure", {});
    const seen: Record<string, string> = {};
    const events: string[] = [];
    const socket = net.connect(join(String(dir), "none.sock"));
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
    expect({ seen, events }).toEqual({
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
    });
  });

  itPosix("is reported before the immediates of the calling turn", async () => {
    using dir = tempDir("unix-connect-failure", {});
    const events: string[] = [];
    let socket: net.Socket;
    setImmediate(() => events.push(`immediate queued before connect(): destroyed=${socket.destroyed}`));
    socket = net.connect(join(String(dir), "none.sock"));
    socket.on("error", (e: NodeJS.ErrnoException) => events.push(`error ${e.code}`));
    const closed = new Promise<void>(resolve => {
      socket.on("close", () => {
        events.push("close");
        resolve();
      });
    });
    setImmediate(() => events.push(`immediate queued after connect(): destroyed=${socket.destroyed}`));
    await closed;
    await nextTurn();
    expect(events).toEqual([
      "error ENOENT",
      "immediate queued before connect(): destroyed=true",
      "immediate queued after connect(): destroyed=true",
      "close",
    ]);
  });

  // Closing the handle cancels the request: afterConnect sees a destroyed socket and reports nothing.
  for (const [name, reason, expected] of [
    ["destroy()", undefined, ["close false"]],
    ["destroy(err)", Object.assign(new Error("mine"), { code: "E_MINE" }), ["error E_MINE", "close true"]],
  ] as const) {
    itPosix(`${name} in a tick after connect() is the only thing reported`, async () => {
      using dir = tempDir("unix-connect-failure", {});
      const events: string[] = [];
      const socket = net.connect(join(String(dir), "none.sock"));
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
      expect(events).toEqual([...expected]);
    });
  }

  // uv_pipe_connect2 has no EALREADY: a later connect() replaces the request,
  // and the one callback is for the latest.
  describe("a second connect() before the first is reported", () => {
    async function secondConnect(first: "missing" | "live", second: "missing" | "live") {
      using dir = tempDir("unix-connect-failure", {});
      const paths = { missing: join(String(dir), "none.sock"), live: join(String(dir), "live.sock") };
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
        socket.on("connect", () => events.push("connect"));
        socket.on("error", (e: NodeJS.ErrnoException) => events.push(`error ${e.code}`));
        const closed = new Promise<void>(resolve => {
          socket.on("close", hadError => {
            events.push(`close ${hadError}`);
            resolve();
          });
        });
        socket.connect(paths[second]);
        if (second === "live") {
          await once(socket, "connect");
          await accepted.promise;
          socket.destroy();
        }
        await closed;
        await nextTurn();
        return { events, connections };
      } finally {
        server.close();
      }
    }

    itPosix("missing then missing: one error", async () => {
      expect(await secondConnect("missing", "missing")).toEqual({
        events: ["error ENOENT", "close true"],
        connections: 0,
      });
    });
    itPosix("missing then live: connects, the first failure is not reported", async () => {
      expect(await secondConnect("missing", "live")).toEqual({ events: ["connect", "close false"], connections: 1 });
    });
    itPosix("live then missing: the second failure is reported", async () => {
      expect((await secondConnect("live", "missing")).events).toEqual(["error ENOENT", "close true"]);
    });
  });

  // uv_pipe_connect2 returns these from the call, and node destroys the socket there.
  itPosix("a name libuv cannot express fails inside connect()", async () => {
    const longDir = `${Buffer.alloc(70, "a").toString()}/${Buffer.alloc(70, "b").toString()}`;
    using dir = tempDir("unix-connect-failure", { [`${longDir}/keep`]: "" });
    const names = {
      "basename longer than sun_path": join(String(dir), Buffer.alloc(200, "a").toString() + ".sock"),
      "path longer than sun_path": join(String(dir), longDir, "none.sock"),
      "NUL in the name": join(String(dir), "no\0ne.sock"),
    };
    const results: Record<string, unknown> = {};
    for (const [name, path] of Object.entries(names)) {
      const events: string[] = [];
      const socket = net.connect(path);
      const destroyedOnReturn = socket.destroyed;
      socket.on("connectionAttemptFailed", () => events.push("connectionAttemptFailed"));
      socket.on("error", (e: NodeJS.ErrnoException) => events.push(`error ${e.syscall}`));
      await new Promise<void>(resolve => socket.on("close", () => resolve()));
      results[name] = { destroyedOnReturn, events };
    }
    const inCall = { destroyedOnReturn: true, events: ["error connect"] };
    expect(results).toEqual({
      "basename longer than sun_path": inCall,
      "path longer than sun_path": inCall,
      "NUL in the name": inCall,
    });
  });

  itPosix("runs its listeners in the async context of the connect() call", async () => {
    using dir = tempDir("unix-connect-failure", {});
    const storage = new AsyncLocalStorage<string>();
    const seen: Record<string, string | undefined> = {};
    const closed = Promise.withResolvers<void>();
    storage.run("the store", () => {
      const socket = net.connect(join(String(dir), "none.sock"));
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
    expect(seen).toEqual({
      connectionAttemptFailed: "the store",
      error: "the store",
      close: "the store",
      write: "the store",
    });
  });

  // Node's Pipe handle has no setTypeOfService: the socket keeps the value and makes no call.
  itPosix("setTypeOfService() keeps the value on a unix socket in every state", async () => {
    using dir = tempDir("unix-connect-failure", {});
    const live = join(String(dir), "live.sock");
    const results: Record<string, number> = {};
    const accepted = Promise.withResolvers<void>();
    const server = net.createServer(connection => {
      connection.on("error", () => {});
      try {
        results.accepted = connection.setTypeOfService(0x10).getTypeOfService();
        accepted.resolve();
      } catch (e) {
        accepted.reject(e);
      }
      connection.end();
    });
    await new Promise<void>(resolve => server.listen(live, resolve));
    try {
      const failing = net.connect(join(String(dir), "none.sock"));
      failing.on("error", () => {});
      const failingClosed = new Promise<void>(resolve => failing.on("close", () => resolve()));
      results["dial that fails"] = failing.setTypeOfService(0x10).getTypeOfService();

      const socket = net.connect(live);
      results.connecting = socket.setTypeOfService(0x10).getTypeOfService();
      await once(socket, "connect");
      results.connected = socket.setTypeOfService(0x20).getTypeOfService();
      await accepted.promise;
      socket.destroy();
      await failingClosed;
    } finally {
      server.close();
    }
    expect(results).toEqual({ "dial that fails": 0x10, connecting: 0x10, connected: 0x20, accepted: 0x10 });
  });

  itPosix("a redial from 'error' returns to the event loop", async () => {
    using dir = tempDir("unix-connect-failure", {});
    const path = join(String(dir), "none.sock");
    const total = 64;
    let attempts = 0;
    let attemptsAtFirstImmediate = -1;
    await new Promise<void>(resolve => {
      setImmediate(() => {
        attemptsAtFirstImmediate = attempts;
      });
      (function dial() {
        net.connect(path).on("error", () => {
          // Stops once the immediate ran, or after `total` attempts if it never got to.
          if (++attempts < total && attemptsAtFirstImmediate < 0) dial();
          else resolve();
        });
      })();
    });
    expect(attemptsAtFirstImmediate).toBeGreaterThanOrEqual(0);
  });

  describe("through every node entry point", () => {
    itPosix("tls.connect({ path })", async () => {
      using dir = tempDir("unix-connect-failure", {});
      const events: string[] = [];
      const socket = tls.connect({ path: join(String(dir), "none.sock"), rejectUnauthorized: false });
      socket.on("error", (e: NodeJS.ErrnoException) => events.push(`error ${e.code}`));
      const closed = new Promise<void>(resolve => socket.on("close", () => resolve()));
      process.nextTick(() => events.push(`tick: connecting=${socket.connecting} destroyed=${socket.destroyed}`));
      await closed;
      expect(events).toEqual(["tick: connecting=true destroyed=false", "error ENOENT"]);
    });

    itPosix("http2.connect(authority, { path })", async () => {
      using dir = tempDir("unix-connect-failure", {});
      const events: string[] = [];
      const session = http2.connect("http://localhost", { path: join(String(dir), "none.sock") });
      session.on("error", (e: NodeJS.ErrnoException) => events.push(`error ${e.code}`));
      const closed = new Promise<void>(resolve => session.on("close", () => resolve()));
      process.nextTick(() => events.push(`tick: connecting=${session.connecting} destroyed=${session.destroyed}`));
      await closed;
      expect(events).toEqual(["tick: connecting=true destroyed=false", "error ENOENT"]);
    });

    it.skipIf(!isLinux)("an abstract name", async () => {
      const events: string[] = [];
      const socket = net.connect(`\0bun-unix-connect-failure-${process.pid}-${Math.random().toString(36).slice(2)}`);
      events.push(`returned: connecting=${socket.connecting} destroyed=${socket.destroyed}`);
      socket.on("connectionAttemptFailed", () => events.push("connectionAttemptFailed"));
      socket.on("error", (e: NodeJS.ErrnoException) => events.push(`error ${e.code}`));
      await new Promise<void>(resolve => socket.on("close", () => resolve()));
      expect(events).toEqual([
        "returned: connecting=true destroyed=false",
        "connectionAttemptFailed",
        "error ECONNREFUSED",
      ]);
    });

    itPosix("http.request({ socketPath }) emits 'socket' before 'error'", async () => {
      using dir = tempDir("unix-connect-failure", {});
      const events: string[] = [];
      const err = await new Promise<NodeJS.ErrnoException>(resolve => {
        const req = http.request({ socketPath: join(String(dir), "none.sock"), path: "/", agent: false });
        req.on("socket", () => events.push("socket"));
        req.on("error", e => {
          events.push(`error ${req.socket ? "with" : "without"} req.socket`);
          resolve(e);
        });
        req.end();
      });
      expect({ code: err.code, events }).toEqual({ code: "ENOENT", events: ["socket", "error with req.socket"] });
    });

    // A write made before the socket is assigned is flushed into the socket
    // while it still connects, and the socket fails it when the connect fails.
    for (const [name, file, request, options, error] of [
      ["http, agent: false", "none.sock", http.request, { agent: false }, "error ENOENT"],
      ["http, default agent", "none.sock", http.request, {}, "error ENOENT"],
      ["https, agent: false", "none.sock", https.request, { agent: false, rejectUnauthorized: false }, "error ENOENT"],
      [
        "http, a path that is a plain file",
        "file.sock",
        http.request,
        { agent: false },
        expect.stringMatching(/^error (ECONNREFUSED|ENOTSOCK)$/),
      ],
    ] as const) {
      itPosix(`a write buffered before the connect gets its callback (${name})`, async () => {
        using dir = tempDir("unix-connect-failure", { "file.sock": "" });
        const events: string[] = [];
        const req = request({ socketPath: join(String(dir), file), method: "POST", path: "/", ...options });
        req.on("socket", socket => events.push(`socket connecting=${socket.connecting}`));
        req.on("error", (e: NodeJS.ErrnoException) => events.push(`error ${e.code}`));
        const closed = new Promise<void>(resolve => {
          req.on("close", () => {
            events.push("close");
            resolve();
          });
        });
        req.write("hello", e => events.push(`write callback ${(e as NodeJS.ErrnoException | undefined)?.code}`));
        await closed;
        await nextTurn();
        expect(events).toEqual([
          "socket connecting=true",
          error,
          "close",
          "write callback ERR_SOCKET_CLOSED_BEFORE_CONNECTION",
        ]);
      });
    }

    itPosix("req.destroy() before the socket is assigned reports a hang up, not the connect error", async () => {
      using dir = tempDir("unix-connect-failure", {});
      const events: string[] = [];
      const req = http.request({ socketPath: join(String(dir), "none.sock"), method: "POST", path: "/", agent: false });
      req.on("socket", () => events.push("socket"));
      req.on("error", (e: NodeJS.ErrnoException) => events.push(`error ${e.code} ${e.message}`));
      const closed = new Promise<void>(resolve => req.on("close", () => resolve()));
      req.destroy();
      await closed;
      await nextTurn();
      expect(events).toEqual(["error ECONNRESET socket hang up"]);
    });
  });

  describe("in a process of its own", () => {
    async function run(script: string, ...args: string[]) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script, ...args],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout: stdout.trim().split("\n"), stderr, exitCode };
    }

    // The failure holds the loop like a request in flight: unref() does not drop it.
    itPosix(
      "is reported for a socket that was unref()ed",
      async () => {
        using dir = tempDir("unix-connect-failure", {});
        const result = await run(
          `
        const socket = require("node:net").connect(process.argv[1]);
        socket.unref();
        socket.on("error", e => console.log("error " + e.code));
        socket.on("close", () => console.log("close"));
        `,
          join(String(dir), "none.sock"),
        );
        expect(result).toEqual({ stdout: ["error ENOENT", "close"], stderr: "", exitCode: 0 });
      },
      childTimeout,
    );

    // Node reports a listener that throws from the connect callback as uncaughtException,
    // and the socket is left as the callback left it.
    for (const kind of ["unix socket", "TCP"] as const) {
      itPosix(
        `a throwing 'connectionAttemptFailed' listener is an uncaughtException (${kind})`,
        async () => {
          using dir = tempDir("unix-connect-failure", {});
          const result = await run(
            `
          const net = require("node:net");
          process.on("uncaughtException", e => console.log("uncaughtException " + e.message));
          function dial(target) {
            const socket = net.connect(target);
            socket.on("connectionAttemptFailed", () => {
              console.log("connectionAttemptFailed");
              throw new Error("from the listener");
            });
            socket.on("error", e => console.log("error " + e.code));
            process.on("exit", () => console.log("destroyed=" + socket.destroyed));
          }
          if (process.argv[1] !== "tcp") dial(process.argv[1]);
          else {
            const server = net.createServer().listen(0, "127.0.0.1", () => {
              const { port } = server.address();
              server.close(() => dial({ port, host: "127.0.0.1" }));
            });
          }
          `,
            kind === "TCP" ? "tcp" : join(String(dir), "none.sock"),
          );
          expect(result).toEqual({
            stdout: ["connectionAttemptFailed", "uncaughtException from the listener", "destroyed=false"],
            stderr: "",
            exitCode: 0,
          });
        },
        childTimeout,
      );
    }

    // Each way a failure that is still queued can end must give back the socket.
    itPosix(
      "does not retain the socket, however the attempt ends",
      async () => {
        using dir = tempDir("unix-connect-failure", {});
        const result = await run(
          `
        const net = require("node:net");
        const { heapStats } = require("bun:jsc");
        const path = process.argv[1];
        const count = +process.argv[2];
        const shapes = {
          reported: socket => {},
          destroyed: socket => process.nextTick(() => socket.destroy()),
          superseded: socket => socket.connect(path),
        };
        function once(shape) {
          return new Promise(resolve => {
            const socket = net.connect(path);
            socket.on("error", () => {});
            socket.on("close", resolve);
            shape(socket);
          });
        }
        const live = {};
        for (const [name, shape] of Object.entries(shapes)) {
          for (let i = 0; i < count; i += 50) {
            const batch = [];
            for (let j = 0; j < 50; j++) batch.push(once(shape));
            await Promise.all(batch);
          }
          Bun.gc(true);
          await new Promise(resolve => setImmediate(resolve));
          Bun.gc(true);
          live[name] = heapStats().objectTypeCounts.TCPSocket ?? 0;
        }
        console.log(JSON.stringify(live));
        `,
          join(String(dir), "none.sock"),
          slow ? "50" : "2000",
        );
        expect({ stderr: result.stderr, exitCode: result.exitCode }).toEqual({ stderr: "", exitCode: 0 });
        const live = JSON.parse(result.stdout.at(-1)!);
        expect(Math.max(live.reported, live.destroyed, live.superseded)).toBeLessThanOrEqual(10);
      },
      childTimeout,
    );

    // The queued failure is released without running script when the worker's VM stops first.
    itPosix(
      "a worker that exits with the failure still queued",
      async () => {
        const workers = slow ? 2 : 16;
        using dir = tempDir("unix-connect-failure", {});
        const result = await run(
          `
        const { Worker } = require("node:worker_threads");
        const source =
          "const { parentPort } = require('node:worker_threads');" +
          "setImmediate(() => require('node:net').connect(" + JSON.stringify(process.argv[1]) + ").on('error', () => parentPort.postMessage('error')));" +
          "setImmediate(() => process.exit(0));";
        let started = 0, exited = 0, reported = 0;
        const total = +process.argv[2];
        function again() {
          if (started >= total) {
            if (exited === total) console.log(JSON.stringify({ exited, reported }));
            return;
          }
          started++;
          const worker = new Worker(source, { eval: true });
          worker.on("message", () => reported++);
          worker.on("error", e => { console.error(e); process.exit(1); });
          worker.on("exit", () => { exited++; again(); });
        }
        again();
        again();
        `,
          join(String(dir), "none.sock"),
          String(workers),
        );
        expect(result).toEqual({ stdout: [JSON.stringify({ exited: workers, reported: 0 })], stderr: "", exitCode: 0 });
      },
      childTimeout,
    );

    // The file's context is retired with the failure still queued: it is released, not run.
    itPosix(
      "bun test --isolate moves to the next file with the failure still queued",
      async () => {
        using dir = tempDir("unix-connect-failure", {
          "a.test.ts": `
          import { test } from "bun:test";
          import net from "node:net";
          import { join } from "node:path";
          test("dials and returns", () => {
            net.connect(join(import.meta.dir, "none.sock")).on("error", () => {});
          });
        `,
          "b.test.ts": `
          import { test, expect } from "bun:test";
          test("runs after it", async () => {
            await new Promise(resolve => setImmediate(resolve));
            expect(1).toBe(1);
          });
        `,
        });
        await using proc = Bun.spawn({
          cmd: [bunExe(), "test", "--isolate", "./a.test.ts", "./b.test.ts"],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
        expect(stderr).toContain(" 2 pass");
        expect(stderr).toContain(" 0 fail");
        expect(exitCode).toBe(0);
      },
      childTimeout,
    );
  });
});
