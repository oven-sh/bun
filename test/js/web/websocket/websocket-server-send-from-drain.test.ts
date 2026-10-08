import { expect, it } from "bun:test";
import net from "node:net";

const CHUNK = new Uint8Array(64 * 1024);
const TOTAL = 1024; // 64 MiB

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
  const sock = net.connect(server.port, "127.0.0.1", async () => {
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
