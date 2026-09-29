// A TLS socket that waits in the low-priority queue times out like any other socket.
//
// uSockets runs 5 TLS handshakes per loop iteration. It parks the other sockets that became
// readable in the low-priority queue, where they are in no group list, and the timeout sweep
// visits them there. This fixture parks sockets in the iteration of a sweep:
//
//   1. N raw clients connect. The server pauses each socket in `open`. Each client then writes
//      the first byte of a handshake record, which stays unread in the kernel.
//   2. In one turn the server gives each socket a timeout that ends at the next sweep and
//      resumes it. Then it blocks for longer than the time between two sweeps.
//   3. The next loop iteration has N readable sockets. 5 of them run, N - 5 are parked, and the
//      sweep is due at the end of that same iteration.
//
// Prints { opened, timedOut }. timedOut counts the sockets whose `timeout` handler ran.
import type { Socket } from "bun";
import { tls } from "harness";
import net from "node:net";

const N = 20;
// LIBUS_TIMEOUT_GRANULARITY in packages/bun-usockets/src/libusockets.h, in milliseconds.
const SWEEP_INTERVAL_MS = 4000;

const opened: Socket[] = [];
let timedOut = 0;
const allOpened = Promise.withResolvers<void>();
const allTimedOut = Promise.withResolvers<void>();

const server = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  tls,
  socket: {
    open(socket) {
      socket.pause();
      if (opened.push(socket) === N) allOpened.resolve();
    },
    timeout(socket) {
      socket.terminate();
      if (++timedOut === N) allTimedOut.resolve();
    },
    handshake() {},
    data() {},
    error() {},
  },
});

const clients: net.Socket[] = [];
const written: Promise<void>[] = [];
for (let i = 0; i < N; i++) {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const client = net.connect(server.port, "127.0.0.1", () => client.write("\x16", () => resolve()));
  client.on("error", reject);
  clients.push(client);
  written.push(promise);
}
await Promise.all([allOpened.promise, ...written]);
for (const client of clients) client.removeAllListeners("error").on("error", () => {});

// An immediate runs between two iterations. From a socket handler, the sweep at the end of the
// same iteration would run before any socket is readable again.
await new Promise(resolve => setImmediate(resolve));
for (const socket of opened) {
  socket.timeout(1);
  socket.resume();
}
Bun.sleepSync(SWEEP_INTERVAL_MS + 100);

// No event tells that a sweep passed a socket by, so this waits for the sweep after the one that
// is due now. It only runs to its end when a socket did not time out.
const nextSweep = setTimeout(() => allTimedOut.resolve(), 2 * SWEEP_INTERVAL_MS + 1000);
await allTimedOut.promise;
clearTimeout(nextSweep);

console.log(JSON.stringify({ opened: opened.length, timedOut }));
for (const client of clients) client.destroy();
server.stop(true);
process.exit(0);
