// A burst of TCP connections that never send a byte to a TLS Bun.serve listener
// must all be reaped by the server's idle timeout. On Linux, TCP_DEFER_ACCEPT
// releases the whole burst at once, more than the 5 handshake reads one loop
// iteration allows. The overflow has no input, so it must not be parked in the
// SSL low-priority queue, where timeouts are held back.
//
// Prints one JSON line: { opened, held } where held is the count the server
// had not closed after the sweeps that bring the idle timeout.

import { getEventLoopStats, sweepSocketTimers } from "bun:internal-for-testing";
import net from "node:net";

const N = Number(process.env.N || 300);
const DEADLINE_MS = Number(process.env.DEADLINE_MS || 22000);

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  tls: { cert: process.env.TLS_CERT!, key: process.env.TLS_KEY! },
  fetch: () => new Response("ok"),
});
const holdersBefore = getEventLoopStats().sweepTimerCount;

let opened = 0;
let settled = 0;
const held = new Set<net.Socket>();
const socks: net.Socket[] = [];
for (let i = 0; i < N; i++) {
  const s = net.connect(server.port as number, "127.0.0.1", () => {
    opened++;
    held.add(s);
  });
  s.on("error", () => {});
  s.on("close", () => {
    held.delete(s);
    settled++;
  });
  socks.push(s);
}

// Nothing reports an accept, and on Linux the kernel holds the burst back for about a
// second. Every socket of this loop holds the sweep's timer, so the holders that the
// clients don't account for are the connections the server has accepted.
const accepted = () => getEventLoopStats().sweepTimerCount - holdersBefore - (N - settled);
const deadline = performance.now() + DEADLINE_MS;
while (accepted() <= 0 && performance.now() < deadline) await Bun.sleep(5);
// Each turn of the loop takes sockets out of the queue again, so this looks on every
// turn and runs the sweeps in the turn of the last accept.
while (accepted() < N - settled && performance.now() < deadline) await new Promise(resolve => setImmediate(resolve));

// The idle timeout is 10s, which is due at the third or fourth sweep. A parked
// connection's timeout is held back for 30 more.
sweepSocketTimers(8);
const left = accepted();
while (left <= 0 && settled < N && performance.now() < deadline) await Bun.sleep(5);

console.log(JSON.stringify({ opened, held: Math.max(left, held.size) }));

for (const s of socks) s.destroy();
server.stop(true);
process.exit(0);
