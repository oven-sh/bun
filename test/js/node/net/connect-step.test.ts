/**
 * The tests in this file run in both Bun and Node.js, except the two that are
 * marked Bun-only: `bun test` runs them here, and the last test runs this same
 * file under Node.js. The expected values come from Node.js v26.3.0.
 *
 * The step from a lookup result to the connect call. TCPWrap::Connect parses
 * the address in the family that the lookup named, and libuv allows one
 * connect in flight per handle:
 * https://github.com/nodejs/node/blob/v26.3.0/src/tcp_wrap.cc#L465-L474
 * https://github.com/nodejs/node/blob/v26.3.0/deps/uv/src/unix/tcp.c#L288-L289
 */
import assert from "node:assert";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// Node.js cannot load the harness.
const harness = typeof Bun !== "undefined" ? await import("harness") : undefined;
const childEnv = harness ? harness.bunEnv : process.env;

type Lookup = NonNullable<net.TcpSocketConnectOpts["lookup"]>;

// A connect on a handle that has one in flight: libuv refuses it on POSIX, and on Windows ConnectEx does: https://github.com/nodejs/node/blob/v26.3.0/deps/uv/src/win/tcp.c#L900-L918
const busy = process.platform === "win32" ? "EISCONN" : "EALREADY";

async function listening() {
  const accepted: net.Socket[] = [];
  let onProbe = () => {};
  const server = net.createServer(connection => {
    accepted.push(connection);
    connection.on("error", () => {});
    // Only the probe of connections() writes.
    connection.on("data", () => onProbe());
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    // The accept queue is in order: when the server reads the probe, it counted every earlier connection.
    async connections() {
      const probe = net.connect(port, "127.0.0.1", () => probe.write("probe"));
      await new Promise<void>((resolve, reject) => {
        onProbe = resolve;
        probe.on("error", reject);
      });
      probe.destroy();
      return accepted.length - 1;
    },
    // A connection that the client lost track of must not keep the server open.
    close() {
      for (const connection of accepted) connection.destroy();
      return new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

function record(socket: net.Socket) {
  const events: string[] = [];
  socket.on("connectionAttempt", (address, _port, family) => events.push(`attempt ${address} ${family}`));
  socket.on("connectionAttemptFailed", (address, _port, family, error: NodeJS.ErrnoException) =>
    events.push(`attempt failed ${address} ${family} ${error.code}`),
  );
  socket.on("connect", () => {
    events.push("connect");
    socket.destroy();
  });
  // An AggregateError has the errors of a list of addresses and no syscall.
  socket.on("error", (error: NodeJS.ErrnoException & { errors?: NodeJS.ErrnoException[] }) =>
    events.push(`error ${error.code} ${error.errors ? `[${error.errors.map(each => each.code)}]` : error.syscall}`),
  );
  const closed = new Promise<string[]>(resolve => {
    socket.on("close", hadError => {
      events.push(`close ${hadError}`);
      resolve(events);
    });
  });
  return closed;
}

describe("the step from a lookup result to the connect call", () => {
  for (const [address, family] of [
    ["127.0.0.1", 6],
    ["::1", 4],
  ] as const) {
    test(`${address} named as family ${family} fails with EINVAL and dials nothing`, async () => {
      const server = await listening();
      try {
        const lookup: Lookup = (_hostname, _options, callback) => callback(null, address, family);
        const socket = new net.Socket();
        const closed = record(socket);
        socket.connect({ host: "example.invalid", port: server.port, autoSelectFamily: false, lookup });
        assert.deepStrictEqual(
          { events: await closed, connections: await server.connections() },
          {
            events: [`attempt ${address} ${family}`, "error EINVAL connect", "close true"],
            connections: 0,
          },
        );
      } finally {
        await server.close();
      }
    });
  }

  test("a list of addresses skips the one named in the wrong family", async () => {
    const server = await listening();
    try {
      const lookup = ((_hostname, _options, callback) =>
        callback(null, [
          { address: "127.0.0.1", family: 6 },
          { address: "127.0.0.1", family: 4 },
        ])) as Lookup;
      const socket = new net.Socket();
      const closed = record(socket);
      socket.connect({ host: "example.invalid", port: server.port, autoSelectFamily: true, lookup });
      assert.deepStrictEqual(
        { events: await closed, connections: await server.connections() },
        {
          events: [
            "attempt 127.0.0.1 6",
            "attempt failed 127.0.0.1 6 EINVAL",
            "attempt 127.0.0.1 4",
            "connect",
            "close false",
          ],
          connections: 1,
        },
      );
    } finally {
      await server.close();
    }
  });

  // Bun-only: Node.js dials the next address on a new handle there, and the result depends on that address and on the first connect.
  const bunOnly = process.versions.bun ? test : test.skip;
  const blockList = new net.BlockList();
  blockList.addAddress("127.0.0.2");
  const twice: Lookup = (_hostname, _options, callback) => {
    callback(null, "127.0.0.1", 4);
    callback(null, "127.0.0.1", 4);
  };
  const wrongFamily: Lookup = (_hostname, _options, callback) => process.nextTick(callback, null, "127.0.0.1", 6);
  const listOf = (...addresses: { address: string; family: number }[]) =>
    ((_hostname, _options, callback) => process.nextTick(callback, null, addresses)) as Lookup;
  const thenList = (lookup: Lookup) => (s: net.Socket, port: number) =>
    s.connect(port, "127.0.0.1").connect({ host: "example.invalid", port, autoSelectFamily: true, lookup });
  const twoAttempts = ["attempt 127.0.0.1 4", "attempt 127.0.0.1 4", `error ${busy} connect`, "close true"];
  for (const [run, name, connect, expected] of [
    [test, "a second connect()", (s, port) => s.connect(port, "127.0.0.1").connect(port, "127.0.0.1"), twoAttempts],
    [
      test,
      "a second and a third connect()",
      (s, port) => s.connect(port, "127.0.0.1").connect(port, "127.0.0.1").connect(port, "127.0.0.1"),
      twoAttempts,
    ],
    [
      test,
      "a lookup callback that runs twice",
      (s, port) => s.connect({ host: "example.invalid", port, autoSelectFamily: false, lookup: twice }),
      twoAttempts,
    ],
    // TCPWrap::Connect parses the address before it calls uv_tcp_connect.
    [
      test,
      "a lookup result named in the wrong family",
      (s, port) =>
        s
          .connect(port, "127.0.0.1")
          .connect({ host: "example.invalid", port, autoSelectFamily: false, lookup: wrongFamily }),
      ["attempt 127.0.0.1 4", "attempt 127.0.0.1 6", "error EINVAL connect", "close true"],
    ],
    [
      bunOnly,
      "a second connect() to a list of addresses",
      thenList(listOf({ address: "127.0.0.1", family: 4 }, { address: "::1", family: 6 })),
      [
        "attempt 127.0.0.1 4",
        "attempt 127.0.0.1 4",
        `attempt failed 127.0.0.1 4 ${busy}`,
        `error ${busy} [${busy}]`,
        "close true",
      ],
    ],
    [
      bunOnly,
      "a second connect() to a list whose first address the blockList refuses",
      thenList(listOf({ address: "127.0.0.2", family: 4 }, { address: "127.0.0.1", family: 4 })),
      [
        "attempt 127.0.0.1 4",
        "attempt failed 127.0.0.2 4 ERR_IP_BLOCKED",
        "error ERR_IP_BLOCKED [ERR_IP_BLOCKED]",
        "close true",
      ],
    ],
  ] as [typeof test, string, (socket: net.Socket, port: number) => void, string[]][]) {
    run(`${name} fails while the first connect is in flight`, async () => {
      const server = await listening();
      try {
        const socket = new net.Socket({ blockList });
        const closed = record(socket);
        connect(socket, server.port);
        const events = await closed;
        const connections = await server.connections();
        assert.deepStrictEqual({ events, destroyed: socket.destroyed }, { events: expected, destroyed: true });
        // The first attempt was in flight when the socket was destroyed.
        assert.ok(connections <= 1, `the server accepted ${connections} connections`);
      } finally {
        await server.close();
      }
    });
  }

  // Node.js begins the trace span of a connect after libuv accepted it.
  test("a connect that fails in the call has no trace span", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "connect-step-"));
    try {
      // Each socket reports a connect too and then closes, so that a build without the checks fails here and does not hang.
      const script = `
        const net = require("node:net");
        const server = net.createServer(connection => connection.on("error", () => {}).resume());
        server.listen(0, "127.0.0.1", () => {
          const port = server.address().port;
          const report = socket =>
            socket.on("error", error => console.log(error.code)).on("connect", () => {
              console.log("connect");
              socket.destroy();
            });
          const lookup = (hostname, options, callback) => callback(null, "127.0.0.1", 6);
          const wrongFamily = report(net.connect({ host: "example.invalid", port, autoSelectFamily: false, lookup }));
          wrongFamily.on("close", () => {
            const twice = report(new net.Socket());
            twice.on("close", () => server.close());
            twice.connect(port, "127.0.0.1").connect(port, "127.0.0.1");
          });
        });
      `;
      const child = spawn(
        process.execPath,
        ["--trace-events-enabled", "--trace-event-categories", "node.net.native", "-e", script],
        { cwd, env: childEnv, stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", chunk => (stdout += chunk));
      child.stderr.on("data", chunk => (stderr += chunk));
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", resolve);
      });
      const log = path.join(cwd, "node_trace.1.log");
      const spans = fs.existsSync(log)
        ? (JSON.parse(fs.readFileSync(log, "utf8")).traceEvents as { name: string; cat: string; ph: string }[])
            .filter(event => event.name === "connect" && event.cat.includes("node.net.native"))
            .map(event => event.ph)
            .join("")
        : "no trace file";
      // The only span is the first connect of the second socket: it begins, and the destroy of the socket ends it.
      assert.deepStrictEqual(
        { stdout: stdout.trim().split("\n"), stderr, spans, exitCode },
        { stdout: ["EINVAL", busy], stderr: "", spans: "be", exitCode: 0 },
      );
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
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
