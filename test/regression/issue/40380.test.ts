import { expect, test } from "bun:test";
import { tls as certs } from "harness";
import { once } from "node:events";
import tls from "node:tls";

// https://github.com/oven-sh/bun/issues/40380
// A backpressured node:tls write must not fail with ERR_SOCKET_CLOSED when the
// peer half-closes cleanly (close_notify + FIN). Node leaves the write pending
// and only emits 'end'; a later failure surfaces as a real errno.
test("clean peer FIN does not fail a pending backpressured TLS write", async () => {
  const backpressured = Promise.withResolvers<void>();

  const server = tls.createServer(certs, sock => {
    sock.on("error", () => {});
    sock.pause(); // never read, so the client's write stays backpressured
    backpressured.promise.then(() => sock.end()); // then half-close cleanly
  });
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as { port: number };

  const sock = tls.connect({ port, rejectUnauthorized: false });
  const clientErrors: Error[] = [];
  sock.on("error", err => clientErrors.push(err));
  await once(sock, "secureConnect");

  try {
    let writeErr: Error | null | undefined;
    let writeCbCalled = false;
    const flushed = sock.write(Buffer.alloc(64 << 20), err => {
      writeCbCalled = true;
      writeErr = err;
    });
    // The 64 MB body cannot fit in the kernel and native buffers while the
    // peer is paused, so the write parks on backpressure.
    expect(flushed).toBe(false);
    backpressured.resolve();

    await once(sock, "end");
    // The broken path fails the parked write synchronously inside the native
    // close callback, before 'end' is emitted; the matching 'error' event is
    // emitted one tick later. Let both land before asserting.
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    expect(clientErrors).toEqual([]);
    // The write is either still pending (Node 24) or completed cleanly
    // (Bun 1.3.14). It must not have failed.
    expect(writeErr ?? null).toBe(null);
    if (writeCbCalled) expect(writeErr).toBe(null);
  } finally {
    sock.destroy();
    server.close();
  }
});
