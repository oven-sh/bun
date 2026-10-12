/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js. The expected
 * values come from Node.js v26.3.0.
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

async function listening() {
  let connections = 0;
  let onConnection = () => {};
  const server = net.createServer(connection => {
    connections++;
    connection.on("error", () => {});
    connection.resume();
    onConnection();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    // The accept queue is in order: when this connection is accepted, every earlier one was counted.
    async connections() {
      const accepted = new Promise<void>(resolve => (onConnection = resolve));
      const probe = net.connect(port, "127.0.0.1");
      probe.on("error", () => {});
      await accepted;
      probe.destroy();
      return connections - 1;
    },
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
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

  for (const [name, again] of [
    ["a second connect()", (socket: net.Socket, port: number) => socket.connect(port, "127.0.0.1")],
    [
      "a second and a third connect()",
      (socket: net.Socket, port: number) => socket.connect(port, "127.0.0.1").connect(port, "127.0.0.1"),
    ],
  ] as const) {
    test(`${name} while the first is in flight fails with EALREADY`, async () => {
      const server = await listening();
      try {
        const socket = new net.Socket();
        const closed = record(socket);
        socket.connect(server.port, "127.0.0.1");
        again(socket, server.port);
        const events = await closed;
        const connections = await server.connections();
        assert.deepStrictEqual(events, [
          "attempt 127.0.0.1 4",
          "attempt 127.0.0.1 4",
          "error EALREADY connect",
          "close true",
        ]);
        // The first attempt was in flight when the socket was destroyed.
        assert.ok(connections <= 1, `the server accepted ${connections} connections`);
      } finally {
        await server.close();
      }
    });
  }

  test("a lookup callback that runs twice fails the second connect with EALREADY", async () => {
    const server = await listening();
    try {
      const lookup: Lookup = (_hostname, _options, callback) => {
        callback(null, "127.0.0.1", 4);
        callback(null, "127.0.0.1", 4);
      };
      const socket = new net.Socket();
      const closed = record(socket);
      socket.connect({ host: "example.invalid", port: server.port, autoSelectFamily: false, lookup });
      const events = await closed;
      const connections = await server.connections();
      assert.deepStrictEqual(events, [
        "attempt 127.0.0.1 4",
        "attempt 127.0.0.1 4",
        "error EALREADY connect",
        "close true",
      ]);
      assert.ok(connections <= 1, `the server accepted ${connections} connections`);
    } finally {
      await server.close();
    }
  });
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (harness) {
  const node = harness.nodeExe();

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
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
