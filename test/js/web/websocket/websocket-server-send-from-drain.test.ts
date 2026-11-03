import { setSocketOptions } from "bun:internal-for-testing";
import { describe, expect, it } from "bun:test";
import { isWindows, tempDir } from "harness";
import { once } from "node:events";
import net from "node:net";
import { join } from "node:path";

const CHUNK = new Uint8Array(64 * 1024);
// With a 64 KiB SO_SNDBUF, 4 MiB hit backpressure dozens of times. Winsock may take any write whole, so send 64 MiB
// there.
const TOTAL = isWindows ? 1024 : 64;

// A send() that partial-writes from inside the drain handler must keep the
// socket polling for writable. us_socket_write2 (the header+payload writev
// path large frames take) used to rearm the poll without setting
// last_write_failed, so the writable dispatch that invoked drain then
// deregistered writable on its way out and the connection stalled forever.
it("ServerWebSocket.send() that backpressures inside drain keeps draining", async () => {
  const { promise: finished, resolve } = Promise.withResolvers<{ drains: number; backpressured: number }>();
  const { promise: firstBackpressure, resolve: resolveFirstBackpressure } = Promise.withResolvers<void>();
  let i = 0;
  let drains = 0;
  let backpressured = 0;
  function pump(ws: Bun.ServerWebSocket<undefined>) {
    while (i < TOTAL) {
      i++;
      if (ws.send(CHUNK) === -1) {
        backpressured++;
        resolveFirstBackpressure();
        return;
      }
    }
    resolve({ drains, backpressured });
  }
  using server = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response();
    },
    websocket: {
      open(ws) {
        setSocketOptions(ws, 1, CHUNK.byteLength);
        pump(ws);
      },
      message() {},
      drain(ws) {
        drains++;
        pump(ws);
      },
    },
  });

  // A raw client: complete the upgrade, don't read until the server has hit
  // backpressure (so the TCP window is closed), then read everything.
  let received = 0;
  const { promise: gotAll, resolve: resolveGotAll } = Promise.withResolvers<void>();
  const sock = net.connect(server.port!, "127.0.0.1", async () => {
    sock.write(
      "GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
    );
    sock.pause();
    await firstBackpressure;
    sock.resume();
  });
  sock.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (received >= TOTAL * CHUNK.byteLength) resolveGotAll();
  });

  const { drains: drainCount, backpressured: backpressureCount } = await finished;
  await gotAll;
  expect(backpressureCount).toBeGreaterThan(0);
  expect(drainCount).toBe(backpressureCount);
  sock.destroy();
}, 30_000);

describe("a client on a unix socket that is slow to read", () => {
  /** Has the server run `send` while the client does not read. Resolves with getBufferedAmount() right behind it and at every drain. */
  async function sendToSlowClient(send: (ws: Bun.ServerWebSocket<undefined>, server: Bun.Server<undefined>) => number) {
    using dir = tempDir("ws-slow-client", {});
    const unix = isWindows ? `\\\\.\\pipe\\bun-test-${crypto.randomUUID()}` : join(String(dir), "s.sock");
    const opened = Promise.withResolvers<Bun.ServerWebSocket<undefined>>();
    const drained = Promise.withResolvers<void>();
    const drains: number[] = [];
    using server = Bun.serve({
      unix,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response();
      },
      websocket: {
        open(ws) {
          ws.subscribe("topic");
          opened.resolve(ws);
        },
        message() {},
        drain(ws) {
          drains.push(ws.getBufferedAmount());
          if (drains.at(-1) === 0) drained.resolve();
        },
      },
    });
    const sock = net.connect(unix);
    sock.write(
      "GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
    );
    await once(sock, "data");
    sock.pause();
    const ws = await opened.promise;
    const status = send(ws, server);
    const buffered = ws.getBufferedAmount();
    sock.resume();
    await drained.promise;
    sock.destroy();
    return { status, buffered, drains };
  }

  // More than a unix socket or a Windows named pipe has room for.
  it.each([
    ["send", (ws, _) => ws.send(new Uint8Array(1_000_000))],
    ["publish", (_, server) => server.publish("topic", new Uint8Array(1_000_000))],
  ] as [string, Parameters<typeof sendToSlowClient>[0]][])(
    "%s() reports backpressure, and drain follows",
    async (_, send) => {
      const { status, buffered } = await sendToSlowClient(send);
      expect({ status, isBuffered: buffered > 0 }).toEqual({ status: -1, isBuffered: true });
    },
  );

  // These leave with the flush of a cork buffer, which is more than a named pipe has room for and less than a unix socket has.
  it.skipIf(!isWindows).each([
    ["sends inside cork()", ws => ws.cork(() => ws.send("x") + ws.send(new Uint8Array(100_000)))],
    [
      "several publish() in one tick",
      (_, server) => Array.from({ length: 10 }, () => server.publish("topic", new Uint8Array(10_000))).at(-1)!,
    ],
  ] as [string, Parameters<typeof sendToSlowClient>[0]][])("drain follows %s on a named pipe", async (_, send) => {
    const { drains } = await sendToSlowClient(send);
    expect(drains).toEqual([0]);
  });

  it("drain tells of progress before the whole backlog is out", async () => {
    const { drains } = await sendToSlowClient(ws => ws.send(new Uint8Array(8 * 1024 * 1024)));
    expect(drains[0]).toBeGreaterThan(0);
  });
});
