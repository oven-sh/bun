// Prints, as JSON, what a connected UDP socket's handlers see when three
// datagrams and an ICMP error are both pending for one readable dispatch.
import { udpSocket } from "bun";
import { statSync } from "node:fs";
import { join } from "node:path";

const peer = await udpSocket({ hostname: "127.0.0.1" });
const connect = { hostname: "127.0.0.1", port: peer.port };

const events: string[] = [];
const { promise: settled, resolve } = Promise.withResolvers<void>();
// Android reports its own platform name, and its kernel is Linux.
const linuxKernel = process.platform === "linux" || process.platform === "android";
function push(event: string) {
  events.push(event);
  // A Linux kernel reports a pending error before the queued datagrams. The
  // BSDs hand out the datagrams first, so there the error is the last event:
  // settling on it turns lost datagrams into a short list instead of a timeout.
  if (events.includes("error ECONNREFUSED") && (!linuxKernel || events.length === 4)) resolve();
}

const socket = await udpSocket({
  hostname: "127.0.0.1",
  connect,
  socket: {
    data(_socket, data) {
      // A failing syscall in the handler leaves its own errno behind. The
      // error that follows must still be the one that the receive returned.
      try {
        statSync(join(import.meta.dir, "does-not-exist"));
      } catch {}
      push("data " + data.toString());
    },
    // The error is the handler's last argument.
    error: (...args: unknown[]) => push("error " + (args.at(-1) as NodeJS.ErrnoException).code),
  },
});
const canary = await udpSocket({ hostname: "127.0.0.1", connect, socket: { error() {} } });

// Nothing from here to `await settled` returns to the event loop, so the
// socket's next readable dispatch finds everything below already pending.
for (const payload of ["1", "2", "3"]) peer.send(payload, socket.port, "127.0.0.1");
peer.close();
// To the closed port: the kernel answers with ICMP port unreachable, which it
// latches on the socket as ECONNREFUSED.
socket.send("x");

// The canary is connected to the same closed port, and the kernel handles
// loopback packets in the order they were sent. Once the canary's own error is
// latched, which makes its send fail, the three datagrams are queued on the
// socket and the socket's error is latched too.
const deadline = Date.now() + 5000;
for (;;) {
  try {
    canary.send("c");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ECONNREFUSED") break;
    throw err;
  }
  if (Date.now() > deadline) throw new Error("the canary's ICMP error did not arrive");
  // One packet in flight at a time, so the loopback queue cannot overflow.
  Bun.sleepSync(1);
}

await settled;
console.log(JSON.stringify({ events, closed: socket.closed }));
socket.close();
canary.close();
