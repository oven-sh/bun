import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isIPv6, isLinux, isWindows, nodeExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scenarios } from "./socket-reconnect-live-fixture.mjs";

// A connect that is in flight on a TCP handle. libuv refuses a second one on POSIX, and ConnectEx does on Windows:
// https://github.com/nodejs/node/blob/v26.3.0/deps/uv/src/unix/tcp.c#L288-L289
// https://github.com/nodejs/node/blob/v26.3.0/deps/uv/src/win/tcp.c#L900-L918
const busy = isWindows ? "EISCONN" : "EALREADY";

// connect_finish must tear down a still-live previous native socket before
// reusing the wrapper, not alias two native sockets onto one ext slot.
// One at a time: a debug build needs 3 s to start one of these processes.
describe("socket.connect() on an already-connected socket", () => {
  it("does not crash and emits connect for the new connection", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { createServer, connect } = require("node:net");
          const srv = createServer(c => c.on("error", () => {})).listen(0, "127.0.0.1", () => {
            const port = srv.address().port;
            const s = connect(port, "127.0.0.1", () => {
              process.stdout.write("first ");
              s.once("connect", () => {
                process.stdout.write("second");
                s.destroy();
                srv.close();
              });
              s.once("error", e => {
                process.stdout.write("err:" + e.code);
                srv.close();
              });
              s.connect(port, "127.0.0.1");
            });
          });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "first second", stderr, exitCode: 0 });
  });

  it("pauses the new connection although the previous one was left paused", async () => {
    // The wrapper is reused, so the paused state recorded for the first connection must
    // not turn the pause of the second one (a paused stream stops its new handle in
    // afterConnect) into a no-op.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { createServer, connect } = require("node:net");
          const { once } = require("node:events");
          let connections = 0;
          const wrote = Promise.withResolvers();
          const srv = createServer(c => {
            c.on("error", () => {});
            if (++connections === 2) c.end("hello", wrote.resolve);
          });
          srv.listen(0, "127.0.0.1", async () => {
            const port = srv.address().port;
            let resumed = false;
            let deliveredWhilePaused = false;
            let received = "";
            const onread = {
              buffer: Buffer.alloc(64),
              callback(n, buf) {
                if (!resumed) deliveredWhilePaused = true;
                received += buf.toString("utf8", 0, n);
                if (received === "hello") {
                  console.log(JSON.stringify({ deliveredWhilePaused, received }));
                  s.destroy();
                  srv.close();
                }
              },
            };
            const s = connect({ port, host: "127.0.0.1", onread });
            await once(s, "connect");
            // Connected and reading: this pause stops the first connection's handle.
            s.pause();
            s.connect({ port, host: "127.0.0.1" });
            await once(s, "connect");
            // "hello" is queued on the second connection once the server's end() callback
            // ran. The loop polls once between the two immediates, so a handle that still
            // reads delivers it (to the callback above, while !resumed) before resume().
            await wrote.promise;
            await new Promise(done => setImmediate(() => setImmediate(done)));
            resumed = true;
            s.resume();
          });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({ deliveredWhilePaused: false, received: "hello" }),
      stderr,
      exitCode: 0,
    });
  });

  it("does not crash when reconnecting while the first connect is still in flight", async () => {
    using dir = tempDir("reconnect-live-trace", {});
    const traceFile = join(String(dir), "node_trace.log");
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--trace-event-categories",
        "node.net.native",
        "--trace-event-file-pattern",
        traceFile,
        "-e",
        `
          const { createServer, connect } = require("node:net");
          const srv = createServer(c => c.on("error", () => {})).listen(0, "127.0.0.1", () => {
            const port = srv.address().port;
            const s = connect(port, "127.0.0.1");
            // Second connect while the first is still connecting.
            s.connect(port, "127.0.0.1");
            s.once("connect", () => {
              process.stdout.write("connect");
              s.destroy();
              srv.close();
            });
            s.once("error", e => {
              process.stdout.write("err:" + e.code);
              s.destroy();
              srv.close();
            });
          });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // The handle refuses the second connect, as node's does.
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "err:" + busy, stderr, exitCode: 0 });
    // The refused connect ends its trace span too.
    const phases = JSON.parse(readFileSync(traceFile, "utf8"))
      .traceEvents.filter((e: { name: string }) => e.name === "connect")
      .map((e: { ph: string }) => e.ph);
    expect(phases.sort()).toEqual(["b", "b", "e", "e"]);
  });
});

// A net.Socket keeps one native handle. Where node's handle refuses a connect() because it still owns
// a socket, ours answers with the same errno from the state of that socket: nothing is closed and
// nothing is dialed for the answer, and the net.Socket is destroyed with the error.

// The scenarios are in a file that node runs too.
const fixture = join(import.meta.dir, "socket-reconnect-live-fixture.mjs");

async function inThisProcess(name: string) {
  using dir = tempDir("reconnect-live", {});
  return await (scenarios as Record<string, (dir: string) => Promise<unknown>>)[name](String(dir));
}

// Runs the scenarios in a process of `exe`, one after the other.
async function inProcessOf(exe: string, names: readonly string[]) {
  using dir = tempDir("reconnect-live", {});
  await using proc = Bun.spawn({
    cmd: [exe, fixture, String(dir), ...names],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  // The results are the last thing the fixture prints: no exit 0, nothing to parse.
  expect(exitCode).toBe(0);
  return JSON.parse(stdout) as Record<string, unknown>;
}

const dial = ["connectionAttempt 127.0.0.1", "connect", "ready"];
// What a refused connect() adds to the events of a socket. 'close' reports that there was an error.
const refused = (code: string) => ["connectionAttempt 127.0.0.1", `error ${code} connect`, "close true"];
// https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L1161-L1170
const refusal = (code: string) => ({
  message: `connect ${code} 127.0.0.1:PORT - Local (ADDRESS)`,
  code,
  syscall: "connect",
  address: "127.0.0.1",
});
// A path on a TCP handle: node parses it as an IPv4 address, and that fails.
const pathOnTCP = (before: string[], dialed = 0) => ({
  outcome: "close",
  destroyedInCall: true,
  events: [...before, "connectionAttempt SOCK", "error EINVAL connect", "close true"],
  errors: [{ message: "connect EINVAL SOCK - Local (ADDRESS)", code: "EINVAL", syscall: "connect", address: "SOCK" }],
  dialed,
});

// These print the same in node v26.3.0 on Linux. libuv's Windows handles are other code: no node row there.
const sameInNode = [
  "in-flight",
  "lookup-twice",
  "accepted",
  "after-end",
  "local-address",
  "tcp-path",
  "tcp-path-in-flight",
  "tls-path",
  "accepted-path",
  "accepted-path-ipv4",
  ...(isIPv6() ? ["tcp6-path"] : []),
  "tls-in-flight",
];
const node = nodeExe();
let fromNode: Promise<Record<string, unknown>> | undefined;

describe.each([
  ["bun", false, inThisProcess],
  ["node", !node || isWindows, async (name: string) => (await (fromNode ??= inProcessOf(node!, sameInNode)))[name]],
] as const)("connect() that node's handle refuses (%s)", (_runtime, skip, run) => {
  it.skipIf(skip)("while a connect is in flight", async () => {
    expect(await run("in-flight")).toEqual({
      outcome: "close",
      events: ["connectionAttempt 127.0.0.1", ...refused(busy)],
      errors: [refusal(busy)],
    });
  });

  it.skipIf(skip)("from a lookup that calls back twice", async () => {
    expect(await run("lookup-twice")).toEqual({
      outcome: "close",
      events: ["connectionAttempt 127.0.0.1", ...refused(busy)],
      errors: [refusal(busy)],
    });
  });

  it.skipIf(skip)("on a socket that a server accepted: EISCONN", async () => {
    expect(await run("accepted")).toEqual({
      outcome: "close",
      events: refused("EISCONN"),
      errors: [refusal("EISCONN")],
      dialed: 0,
      // The peer of the accepted socket sees a FIN.
      client: [...dial, "end", "close false"],
    });
  });

  it.skipIf(skip)("after end(), until the peer closes: EISCONN", async () => {
    expect(await run("after-end")).toEqual({
      outcome: "close",
      events: [...dial, ...refused("EISCONN")],
      errors: [refusal("EISCONN")],
      dialed: 1,
    });
  });

  it.skipIf(skip)("with a localAddress on a connected socket: bind EINVAL", async () => {
    expect(await run("local-address")).toEqual({
      outcome: "close",
      events: [...dial, "error EINVAL bind", "close true"],
      errors: [{ message: "bind EINVAL 127.0.0.1", code: "EINVAL", syscall: "bind", address: "127.0.0.1" }],
      dialed: 1,
    });
  });

  it.skipIf(skip)("with a path on a connected TCP socket: EINVAL", async () => {
    expect(await run("tcp-path")).toEqual(pathOnTCP(dial));
  });

  it.skipIf(skip)("with a path while the TCP connect is in flight: EINVAL", async () => {
    expect(await run("tcp-path-in-flight")).toEqual(pathOnTCP(["connectionAttempt 127.0.0.1"]));
  });

  it.skipIf(skip)("with a path on an established TLSSocket: EINVAL", async () => {
    expect(await run("tls-path")).toEqual(pathOnTCP([...dial, "secureConnect"]));
  });

  it.skipIf(skip)("with a path on a socket accepted on the default address: EINVAL", async () => {
    expect(await run("accepted-path")).toEqual(pathOnTCP([]));
  });

  it.skipIf(skip)("with a path that is an IPv4 address, on an accepted socket: EISCONN", async () => {
    expect(await run("accepted-path-ipv4")).toEqual({
      outcome: "close",
      events: refused("EISCONN"),
      errors: [
        {
          message: "connect EISCONN 127.0.0.1 - Local (ADDRESS)",
          code: "EISCONN",
          syscall: "connect",
          address: "127.0.0.1",
        },
      ],
    });
  });

  it.skipIf(skip || !isIPv6())("with a path on a connected IPv6 socket: EINVAL", async () => {
    expect(await run("tcp6-path")).toEqual(pathOnTCP(["connectionAttempt ::1", "connect", "ready"]));
  });

  it.skipIf(skip)("on a TLSSocket whose connect is in flight", async () => {
    expect(await run("tls-in-flight")).toEqual({
      outcome: "close",
      events: ["connectionAttempt 127.0.0.1", ...refused(busy)],
      errors: [refusal(busy)],
    });
  });
});

describe("connect() that node refuses by another way", () => {
  const onUnix = { message: "connect EISCONN SOCK", code: "EISCONN", syscall: "connect", address: "SOCK" };

  // node reports what connect(2) says for the new path, with the request, one loop turn later:
  // https://github.com/nodejs/node/blob/v26.3.0/deps/uv/src/unix/pipe.c#L300-L330
  it("on a connected unix socket: EISCONN in the call", async () => {
    expect(await inThisProcess("unix-path")).toEqual({
      outcome: "close",
      destroyedInCall: true,
      events: ["connect", "ready", "connectionAttempt SOCK", "error EISCONN connect", "close true"],
      errors: [onUnix],
      dialed: 1,
    });
  });

  it("on a unix socket whose connect is in flight: EISCONN in the call", async () => {
    expect(await inThisProcess("unix-in-flight")).toEqual({
      outcome: "close",
      destroyedInCall: true,
      events: ["connectionAttempt SOCK", "connectionAttempt SOCK", "error EISCONN connect", "close true"],
      errors: [onUnix],
    });
  });

  // Bun only: node's connect() takes no fd.
  it("with an fd: EBUSY", async () => {
    expect(await inThisProcess("fd")).toEqual({
      outcome: "close",
      events: [...dial, "error EBUSY open", "close true"],
      errors: [{ message: "open EBUSY", code: "EBUSY", syscall: "open" }],
      dialed: 1,
    });
  });

  // libuv reports EBUSY for a named pipe, with the request.
  it.skipIf(!isWindows)("on a connected named pipe: EISCONN in the call", async () => {
    expect(await inThisProcess("named-pipe")).toEqual({
      path: {
        outcome: "close",
        events: ["connect", "ready", "connectionAttempt PIPE", "error EISCONN connect", "close true"],
        errors: [{ message: "connect EISCONN PIPE", code: "EISCONN", syscall: "connect", address: "PIPE" }],
        dialed: 0,
      },
      address: {
        outcome: "close",
        events: ["connect", "ready", "connectionAttempt 127.0.0.1", "error EISCONN connect", "close true"],
        errors: [
          { message: "connect EISCONN 127.0.0.1:PORT", code: "EISCONN", syscall: "connect", address: "127.0.0.1" },
        ],
        dialed: 0,
      },
    });
  });

  // After such a refusal node goes on to the next address of the name: it closes the socket of the
  // handle without an event and dials there. Here the socket is destroyed with the error.
  describe("by a name with two addresses, the walk stops", () => {
    it("at a bind that the handle refuses", async () => {
      expect(await inThisProcess("two-addresses-local-port")).toEqual({
        outcome: "close",
        events: [...dial, "error EINVAL bind", "close true"],
        errors: [{ message: "bind EINVAL 0.0.0.0:LOCAL", code: "EINVAL", syscall: "bind", address: "0.0.0.0" }],
        dialed: 1,
      });
    });

    it("at an address that the BlockList of the socket blocks", async () => {
      expect(await inThisProcess("two-addresses-blocked")).toEqual({
        outcome: "close",
        events: [...dial, "connectionAttemptFailed 127.0.0.1", "error ERR_IP_BLOCKED undefined", "close true"],
        errors: [{ message: "IP(127.0.0.1) is blocked by net.BlockList", code: "ERR_IP_BLOCKED" }],
        data: "hello",
        dialed: 1,
      });
    });

    // #21524
    it("at a connect that is in flight, and the socket is closed", async () => {
      expect(await inThisProcess("two-addresses-in-flight")).toEqual({
        outcome: "close",
        events: [
          "connectionAttempt 127.0.0.1",
          "connectionAttempt 127.0.0.1",
          "connectionAttemptFailed 127.0.0.1",
          // The attempt of the first call, which the destroy cancelled.
          "connectionAttemptFailed 127.0.0.1",
          `error ${busy} connect`,
          "close true",
        ],
        errors: [refusal(busy)],
        data: "",
        state: { destroyed: true, connecting: false, readyState: "closed" },
      });
    });

    // 127.0.0.9 refuses at once on Linux only.
    it.skipIf(!isLinux)("at the socket that a 'connectionAttemptFailed' listener dialed on the handle", async () => {
      expect(await inThisProcess("walk-finds-a-socket")).toEqual({
        outcome: "close",
        events: [
          "connectionAttempt 127.0.0.9",
          "connectionAttemptFailed 127.0.0.9",
          "connectionAttempt SOCK",
          "error ECONNREFUSED connect",
          "close true",
        ],
        data: "",
        dialed: { tcp: 0, unix: 1 },
        state: { destroyed: true, connecting: false, readyState: "closed" },
      });
    });
  });
});

// connect(2) answers 0 for such a socket once on Linux, and node emits 'connect' again on the same
// connection. Here the connection is swapped for a new one, as before.
it.each(["connected", "other-port", "after-fin", "two-addresses", "tls-established", "tls-handshake"])(
  "a client socket that has not sent its FIN still emits 'connect' again (%s)",
  async name => {
    expect(await inThisProcess(name)).toEqual({ outcome: "connect" });
  },
);
