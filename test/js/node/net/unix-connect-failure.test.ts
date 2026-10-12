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

const harness = typeof Bun !== "undefined" ? await import("harness") : undefined;
// A debug or ASAN child takes seconds to start.
const slow = !!harness && (harness.isDebug || harness.isASAN);
const childOptions = slow ? { timeout: 60_000 } : {};
const childEnv = harness ? harness.bunEnv : process.env;
const posixTest = process.platform === "win32" ? test.skip : test;
// A second connect() leaves the request it replaced active in Node, so a Node process never exits after one.
const bunTest = process.versions.bun && process.platform !== "win32" ? test : test.skip;

const dirs: string[] = [];
function makeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ucf-"));
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
    child.stderr.on("data", chunk => {
      stderr += chunk;
      // A child that loops on uncaught errors never exits: stop it instead of waiting for the timeout.
      if (stderr.length > 64 * 1024) child.kill();
    });
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

  // uv_pipe_connect2 has no EALREADY: a later connect() replaces the request, and the one callback is for the latest.
  // https://github.com/nodejs/node/blob/v26.3.0/deps/uv/src/unix/pipe.c#L333-L334
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
  posixTest("setTypeOfService() keeps the value until the failure is reported", async () => {
    const socket = net.connect(path.join(makeDir(), "none.sock"));
    socket.on("error", () => {});
    const closed = closeOf(socket);
    assert.strictEqual(socket.setTypeOfService(0x10).getTypeOfService(), 0x10);
    await closed;
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

    // A write made before the socket is assigned is flushed into the socket
    // while it still connects, and the socket fails it when the connect fails.
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

  describe("in a process of its own", () => {
    // The agent dials again for the next queued request when a socket closes. A socket that
    // fails inside connect() has no request yet: its 'error' was uncaught and the agent looped.
    posixTest("an agent at its socket limit fails every queued request once", childOptions, async () => {
      const result = await run(
        `
        const http = require("node:http");
        const agent = new http.Agent({ maxSockets: 1 });
        for (let i = 0; i < 3; i++) {
          const req = http.request({ socketPath: process.argv[1], agent, path: "/" + i });
          req.on("error", e => console.log("request " + i + " error " + e.code));
          req.end();
        }
        `,
        path.join(makeDir(), "none.sock"),
      );
      assert.deepStrictEqual(result, {
        stdout: ["request 0 error ENOENT", "request 1 error ENOENT", "request 2 error ENOENT"],
        stderr: "",
        exitCode: 0,
      });
    });

    // The failure holds the loop like a request in flight: unref() does not drop it.
    posixTest("is reported for a socket that was unref()ed", childOptions, async () => {
      const result = await run(
        `
        const socket = require("node:net").connect(process.argv[1]);
        socket.unref();
        socket.on("error", e => console.log("error " + e.code));
        socket.on("close", () => console.log("close"));
        `,
        path.join(makeDir(), "none.sock"),
      );
      assert.deepStrictEqual(result, { stdout: ["error ENOENT", "close"], stderr: "", exitCode: 0 });
    });

    // The connect and the exit are in the same batch of immediates, so the failure is still queued at the exit.
    posixTest("a worker that exits with the failure still queued", childOptions, async () => {
      const workers = slow ? 2 : 8;
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
        path.join(makeDir(), "none.sock"),
        String(workers),
      );
      assert.deepStrictEqual(result, {
        stdout: [JSON.stringify({ exited: workers, reported: 0 })],
        stderr: "",
        exitCode: 0,
      });
    });

    // Each way a failure that is still queued can end must give back the socket.
    bunTest("does not retain the socket, however the attempt ends", childOptions, async () => {
      const result = await run(
        `
        const net = require("node:net");
        const tls = require("node:tls");
        const { heapStats } = require("bun:jsc");
        const path = process.argv[1];
        const count = +process.argv[2];
        const shapes = {
          reported: socket => {},
          destroyed: socket => process.nextTick(() => socket.destroy()),
          superseded: socket => socket.connect(path),
        };
        function once(dial, shape) {
          return new Promise(resolve => {
            const socket = dial();
            socket.on("error", () => {});
            socket.on("close", resolve);
            shape(socket);
          });
        }
        const dials = { net: () => net.connect(path), tls: () => tls.connect({ path }) };
        const live = {};
        for (const [module, dial] of Object.entries(dials)) {
          for (const [name, shape] of Object.entries(shapes)) {
            for (let i = 0; i < count; i += 25) {
              const batch = [];
              for (let j = 0; j < 25; j++) batch.push(once(dial, shape));
              await Promise.all(batch);
            }
            Bun.gc(true);
            await new Promise(resolve => setImmediate(resolve));
            Bun.gc(true);
            const counts = heapStats().objectTypeCounts;
            live[module + " " + name] = (counts.TCPSocket ?? 0) + (counts.TLSSocket ?? 0);
          }
        }
        console.log(JSON.stringify(live));
        `,
        path.join(makeDir(), "none.sock"),
        slow ? "25" : "1000",
      );
      assert.deepStrictEqual({ stderr: result.stderr, exitCode: result.exitCode }, { stderr: "", exitCode: 0 });
      const live: Record<string, number> = JSON.parse(result.stdout.at(-1)!);
      assert.deepStrictEqual(
        Object.entries(live).filter(([, count]) => count > 10),
        [],
      );
    });
  });
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (harness) {
  const node = harness.nodeExe();

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", { timeout: 120_000 }, async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
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
