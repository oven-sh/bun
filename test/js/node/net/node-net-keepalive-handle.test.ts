/**
 * The calls that socket.setKeepAlive() of node:net makes on its handle, in seconds:
 * https://github.com/nodejs/node/blob/v26.12.1/lib/net.js#L908-L951
 *
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 */
import assert from "node:assert";
import { once } from "node:events";
import net from "node:net";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// `@types/node` has the two parameters of Node.js v26.3.0, and no handle.
type KeepAliveSocket = { setKeepAlive(...args: unknown[]): unknown; _handle: { setKeepAlive: Function } };

test("setKeepAlive() has four parameters", () => {
  assert.strictEqual(net.Socket.prototype.setKeepAlive.length, 4);
});

test("a handle that the program gave gets seconds, the interval and the count, once for each change", () => {
  const calls: unknown[][] = [];
  const handle = {
    setKeepAlive(...args: unknown[]) {
      calls.push(args);
    },
    // What Node.js asks of a handle.
    readStart: () => 0,
    readStop: () => 0,
    close(callback?: () => void) {
      if (callback) process.nextTick(callback);
    },
    getAsyncId: () => 0,
  };
  // @ts-expect-error `manualStart`, and a handle that is not a TCP one
  const socket = new net.Socket({ handle, manualStart: true });
  const step = (...args: unknown[]) => {
    calls.length = 0;
    const returned = (socket as unknown as KeepAliveSocket).setKeepAlive(...args);
    return [returned === socket, ...calls];
  };
  try {
    assert.deepStrictEqual(
      {
        "off while off": step({ enable: false }),
        "options": step({ enable: true, initialDelay: 5000, interval: 3000, count: 7 }),
        "the same values": step(true, 5000, 3000, 7),
        "another interval and count": step(true, 5000, 4000, 8),
        "the same whole seconds": step(true, 5999, 4999, 8),
        "two arguments": step(true, 5000),
        "off": step(false),
        "off again": step({}),
        "a negative delay and interval, a fraction as count": step(true, -5000, -3000, 7.5),
        "strings": step(true, "5000", "3000", "7"),
      },
      {
        "off while off": [true],
        "options": [true, [true, 5, 3, 7]],
        "the same values": [true],
        "another interval and count": [true, [true, 5, 4, 8]],
        "the same whole seconds": [true],
        "two arguments": [true, [true, 5, undefined, undefined]],
        "off": [true, [false, 0, undefined, undefined]],
        "off again": [true],
        "a negative delay and interval, a fraction as count": [true, [true, -5, -3, 7.5]],
        "strings": [true, [true, 5, 3, "7"]],
      },
    );
  } finally {
    socket.destroy();
  }
});

test("a function put over setKeepAlive() of the handle of a connection gets the same calls", async () => {
  const server = net.createServer(socket => socket.resume());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const client = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
  try {
    await once(client, "connect");
    const socket = client as unknown as KeepAliveSocket;
    const calls: unknown[][] = [];
    socket._handle.setKeepAlive = (...args: unknown[]) => {
      calls.push(args);
      return 0;
    };
    socket.setKeepAlive({ enable: true, initialDelay: 5000, interval: 3000, count: 7 });
    socket.setKeepAlive(true, 5000, 3000, 7);
    socket.setKeepAlive(true, 5000);
    socket.setKeepAlive(false);
    assert.deepStrictEqual(calls, [
      [true, 5, 3, 7],
      [true, 5, undefined, undefined],
      [false, 0, undefined, undefined],
    ]);
  } finally {
    client.destroy();
    server.close();
  }
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, nodeExeAtLeast } = await import("harness");
  // v26.4.0 added the interval, the count and the options.
  const node = nodeExeAtLeast("26.4.0");

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, fileURLToPath(import.meta.url)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
