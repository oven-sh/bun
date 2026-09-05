// A burst of TCP connections that never send a byte to a TLS Bun.serve listener
// must all be reaped by the server's idle timeout. On Linux, TCP_DEFER_ACCEPT
// releases the whole burst at once and the synthetic readable dispatch parks
// the overflow in the SSL low-priority queue, which the timer sweep must still
// be able to see.
//
// Prints one JSON line: { opened, held } where held is the count the server
// had not closed by the deadline.

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
const held = new Set<net.Socket>();
const allSettled = Promise.withResolvers<void>();
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
    if (settled === N) allSettled.resolve();
  });
  socks.push(s);
}

// The idle timeout is 10s and the sweep granularity is 4s, so a correctly
// behaving server closes every connection by ~16s; the deadline leaves margin
// for debug builds. The race here is won or lost at a single sweep tick, so a
// server that has not reaped them all by the deadline never will.
await Promise.race([allSettled.promise, Bun.sleep(DEADLINE_MS)]);

console.log(JSON.stringify({ opened, held: held.size }));

for (const s of socks) s.destroy();
server.stop(true);
process.exit(0);
