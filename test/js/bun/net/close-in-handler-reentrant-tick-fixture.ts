// Spawned by socket.test.ts under `bun test`: expect(promise).resolves spins
// the event loop synchronously (waitForPromise), which is how user code ends up
// re-entering the event loop from inside a socket handler, i.e. from inside
// that socket's poll callback.
//
// On the libuv backend (Windows), a socket closed in that position had its poll
// handle closed, and the handle's close callback run, inside the nested run.
// libuv then resumed on the freed handle once the handler returned and ran the
// close callback a second time, double freeing the handle. The corruption
// surfaced in whatever sockets were created next, so every case churns through
// a batch of connections afterwards; the process crashing or hanging (bun test
// times the case out) is the failure mode socket.test.ts checks for.
import type { Socket, SocketHandler } from "bun";
import { expect, test } from "bun:test";

const HOST = "127.0.0.1";

// Server side of every live connection, keyed by the client's local port, so a
// case can close the peer of a specific client. The port is stashed in
// socket.data because a closed socket no longer reports its remotePort.
const peers = new Map<number, Socket<number>>();
let onPeersClosed: (() => void) | undefined;

const server = Bun.listen<number>({
  hostname: HOST,
  port: 0,
  socket: {
    open(socket) {
      socket.data = socket.remotePort;
      peers.set(socket.data, socket);
      // Gives every client a `data` dispatch to run its case from.
      socket.write("x");
    },
    data() {},
    close(socket) {
      peers.delete(socket.data);
      if (peers.size === 0) onPeersClosed?.();
    },
  },
});

function peersClosed(): Promise<void> {
  if (peers.size === 0) return Promise.resolve();
  const { promise, resolve } = Promise.withResolvers<void>();
  onPeersClosed = resolve;
  return promise;
}

/** Resolves after `n` further turns of the event loop (one timer firing each). */
function turns(n: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const step = () => (n-- > 0 ? setTimeout(step, 0) : resolve());
  step();
  return promise;
}

/** Runs the event loop, nested inside the caller, until `promise` resolves. */
function spinUntil(promise: Promise<void>): void {
  expect(promise).resolves.toBeUndefined();
}

function connect(handlers: Partial<SocketHandler<undefined>>): Promise<Socket<undefined>> {
  return Bun.connect<undefined>({
    hostname: HOST,
    port: server.port,
    socket: { data() {}, ...handlers },
  });
}

/**
 * Opens `count` connections and closes them all from their own `data`
 * handlers. Before a case this lines up freed poll handles next to the one the
 * case double frees; after a case it is what trips over the corrupted heap.
 */
async function churn(count: number): Promise<void> {
  const closed: Promise<void>[] = [];
  for (let i = 0; i < count; i++) {
    const { promise, resolve } = Promise.withResolvers<void>();
    closed.push(promise);
    await connect({
      data(socket) {
        socket.terminate();
      },
      close() {
        resolve();
      },
    });
  }
  await Promise.all(closed);
  await peersClosed();
}

test("closing the socket from its own handler, then re-entering the event loop", async () => {
  await churn(8);

  const { promise: ran, resolve: done } = Promise.withResolvers<void>();
  await connect({
    data(socket) {
      socket.terminate();
      spinUntil(turns(16));
      done();
    },
  });
  await ran;
  await peersClosed();

  await churn(32);
});

test("the peer closes the socket while its handler is re-entering the event loop", async () => {
  await churn(8);

  const { promise: ran, resolve: done } = Promise.withResolvers<void>();
  const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
  await connect({
    data(socket) {
      // The reset reaches this socket inside the nested run below, so its own
      // close runs in a poll callback nested under this one.
      peers.get(socket.localPort)!.terminate();
      spinUntil(closed.then(() => turns(16)));
      done();
    },
    close() {
      onClosed();
    },
  });
  await ran;
  await peersClosed();

  await churn(32);
});
