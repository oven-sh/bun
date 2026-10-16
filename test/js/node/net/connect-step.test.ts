/**
 * The tests in this file run in both Bun and Node.js, except the one that is
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
import net from "node:net";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// Node.js cannot load the harness.
const harness = typeof Bun !== "undefined" ? await import("harness") : undefined;

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
  socket.on("error", (error: NodeJS.ErrnoException) => events.push(`error ${error.code} ${error.syscall}`));
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
    [
      bunOnly,
      "a second connect() to a list of addresses",
      thenList(listOf({ address: "127.0.0.1", family: 4 }, { address: "::1", family: 6 })),
      [
        "attempt 127.0.0.1 4",
        "attempt 127.0.0.1 4",
        `attempt failed 127.0.0.1 4 ${busy}`,
        `error ${busy} connect`,
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
        "error ERR_IP_BLOCKED undefined",
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
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (harness) {
  const node = harness.nodeExe();
  // A Node.js that does not strip types by default cannot load this file.
  const stripsTypes =
    !!node &&
    Bun.spawnSync({ cmd: [node, "-p", "process.features.typescript"], env: harness.bunEnv })
      .stdout.toString()
      .trim() === "strip";

  describe("Node.js compatibility", () => {
    (stripsTypes ? test : test.skip)("all tests pass in Node.js", async () => {
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
