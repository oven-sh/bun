import { expect, test } from "bun:test";
import { tls as certs } from "harness";
import { once } from "node:events";
import tls from "node:tls";

// https://github.com/oven-sh/bun/issues/40380
// A backpressured node:tls write must not fail with ERR_SOCKET_CLOSED when the
// peer half-closes cleanly (close_notify + FIN). The write stays parked and
// completes once the peer drains it; the socket only emits 'end'.
test("clean peer FIN does not fail a pending backpressured TLS write", async () => {
  const backpressured = Promise.withResolvers<void>();
  const peerFinObserved = Promise.withResolvers<void>();

  const server = tls.createServer(certs, sock => {
    sock.on("error", () => {});
    sock.pause(); // never read, so the client's write stays backpressured
    backpressured.promise.then(() => sock.end()); // then half-close cleanly
    peerFinObserved.promise.then(() => sock.resume()); // then drain the write
  });
  let sock: ReturnType<typeof tls.connect> | undefined;

  try {
    server.listen(0);
    await once(server, "listening");
    const { port } = server.address() as { port: number };

    sock = tls.connect({ port, rejectUnauthorized: false });
    const clientErrors: Error[] = [];
    sock.on("error", err => clientErrors.push(err));
    await once(sock, "secureConnect");

    const writeDone = Promise.withResolvers<Error | null | undefined>();
    const flushed = sock.write(Buffer.alloc(64 << 20), err => writeDone.resolve(err));
    // The 64 MB body cannot fit in the kernel and native buffers while the
    // peer is paused, so the write parks on backpressure.
    expect(flushed).toBe(false);
    backpressured.resolve();

    // The peer's FIN only closed its write side. The parked write must
    // survive it and complete once the peer starts reading again. The broken
    // path destroys the socket instead and fails the write with
    // ERR_SOCKET_CLOSED.
    await once(sock, "end");
    peerFinObserved.resolve();
    const writeErr = await writeDone.promise;
    expect(writeErr ?? null).toBe(null);
    expect(clientErrors).toEqual([]);
  } finally {
    sock?.destroy();
    server.close();
  }
});
