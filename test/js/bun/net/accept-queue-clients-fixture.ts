// Client half of "one readiness event of a listener does not empty a long queue" in
// tcp-server.test.ts. It runs in a Worker, so that it can connect while the thread of the
// listener is blocked: the connections then all wait in the listener's queue.
import { connect, type Socket } from "bun";

declare var self: Worker;

let sockets: Socket[] = [];

self.onmessage = async ({ data }) => {
  if (data === "close") {
    for (const socket of sockets) socket.terminate();
    sockets = [];
    self.postMessage("closed");
    return;
  }

  const { target, count, first, signal } = data;
  const view = new Int32Array(signal);
  try {
    sockets = await Promise.all(
      Array.from({ length: count }, () => {
        const { promise, resolve, reject } = Promise.withResolvers<Socket>();
        connect({
          ...target,
          socket: {
            open(socket) {
              // A listener with deferred accept queues the connection when these bytes arrive.
              if (first && socket.write(first) !== first.length) reject(new Error("short write"));
              else resolve(socket);
            },
            connectError(socket, error) {
              reject(error);
            },
            data() {},
            error() {},
          },
        }).catch(reject);
        return promise;
      }),
    );
    Atomics.store(view, 0, 1);
  } catch (error) {
    console.error(error);
    Atomics.store(view, 0, 2);
  }
  Atomics.notify(view, 0);
};

self.postMessage("ready");
