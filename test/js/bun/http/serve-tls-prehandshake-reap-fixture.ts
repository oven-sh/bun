// A burst of TCP connections that never send a byte to a TLS Bun.serve listener
// must all be reaped by the server's idle timeout. On Linux, TCP_DEFER_ACCEPT
// releases the whole burst at once, more than the 5 handshake reads one loop
// iteration allows. The overflow has no input, so it must not be parked in the
// SSL low-priority queue, where timeouts are held back.
//
// Prints one JSON line: { opened, held } where held is the count the server
// had not closed by the deadline.

import { sweepSocketTimers } from "bun:internal-for-testing";
import net from "node:net";

const N = Number(process.env.N || 300);
const DEADLINE_MS = Number(process.env.DEADLINE_MS || 22000);

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  tls: { cert: process.env.TLS_CERT!, key: process.env.TLS_KEY! },
  fetch: () => new Response("ok"),
});

let opened = 0;
let settled = 0;
let reaped = 0;
const held = new Set<net.Socket>();
const socks: net.Socket[] = [];
for (let i = 0; i < N; i++) {
  const s = net.connect(server.port as number, "127.0.0.1", () => {
    opened++;
    held.add(s);
  });
  s.on("error", () => {});
  s.on("close", () => {
    if (held.delete(s)) reaped++;
    settled++;
  });
  socks.push(s);
}

// The idle timeout is 10s, which is due at the third or fourth sweep after the accept, and
// nothing reports the accept: on Linux the kernel holds the burst back for about a
// second. So this runs the sweep by hand until the first open connection is closed
// (one that a full accept backlog turned away doesn't count). A parked connection's
// timeout is held back for 30 sweeps, so a server that has not reaped the rest a few
// sweeps later has parked them.
const deadline = performance.now() + DEADLINE_MS;
for (let sweepsSinceFirstClose = 0; settled < N && sweepsSinceFirstClose < 8 && performance.now() < deadline; ) {
  await Bun.sleep(20);
  sweepSocketTimers(1);
  if (reaped > 0) sweepsSinceFirstClose++;
}

console.log(JSON.stringify({ opened, held: held.size }));

for (const s of socks) s.destroy();
server.stop(true);
process.exit(0);
