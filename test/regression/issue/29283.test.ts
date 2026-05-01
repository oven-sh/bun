import { expect, test } from "bun:test";
import { once } from "node:events";
import { connect, createServer } from "node:net";

// https://github.com/oven-sh/bun/issues/29283
// https://github.com/oven-sh/bun/issues/12306
//
// `socket.setTimeout()` is an inactivity timer in Node.js: it must be
// reset by any socket activity, including incoming data. Before this
// fix, Bun only refreshed the timer in `_write()`, so a socket that
// was actively receiving data but not writing would incorrectly emit
// `timeout` after the configured interval.
test("Socket.setTimeout resets on incoming data", async () => {
  // Server writes a chunk every 50ms — well under the 300ms timeout.
  await using server = createServer(socket => {
    const id = setInterval(() => socket.write("ping"), 50);
    socket.on("close", () => clearInterval(id));
    socket.on("error", () => clearInterval(id));
  }).listen(0);
  await once(server, "listening");
  const { port } = server.address() as { port: number };

  let timedOut = false;
  let chunks = 0;
  const { promise: enoughReads, resolve: readsDone } = Promise.withResolvers<void>();

  const client = connect({ host: "127.0.0.1", port, timeout: 300 });
  client.on("data", () => {
    // Receive enough chunks to clearly cross the timeout window:
    // 20 * 50ms = 1000ms >> 300ms timeout. If setTimeout() is not
    // an idle timer, the 300ms timer will fire before we hit 20.
    if (++chunks >= 20) readsDone();
  });
  client.on("timeout", () => {
    timedOut = true;
    client.destroy();
    readsDone();
  });

  await once(client, "connect");
  await enoughReads;
  client.destroy();

  expect(timedOut).toBe(false);
  expect(chunks).toBeGreaterThanOrEqual(20);
});

// The corollary: when the socket actually goes idle, the timeout
// still fires. This guards against a fix that silently disables the
// timer.
test("Socket.setTimeout still fires on genuine idle", async () => {
  await using server = createServer(() => {
    // Accept the connection but never write.
  }).listen(0);
  await once(server, "listening");
  const { port } = server.address() as { port: number };

  const client = connect({ host: "127.0.0.1", port, timeout: 100 });
  await once(client, "connect");
  await once(client, "timeout");
  client.destroy();
});
