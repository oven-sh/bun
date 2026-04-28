// Regression check for PostgresSQLConnection.deinit() leaking tls_ctx.
//
// The SSL SocketContext (tls_ctx) for a Postgres connection is created
// eagerly when sslmode != disable, before any network I/O. If the
// connection object is later finalized/closed, deinit() must free it.
//
// We don't need a real Postgres server to exercise this path: pointing
// at a TCP server that accepts and immediately closes is enough for the
// native PostgresSQLConnection to be allocated (with its tls_ctx), then
// torn down via onClose -> finalize -> deinit.

import { SQL } from "bun";
import net from "node:net";

const server = net.createServer(socket => {
  // Close as soon as the client sends anything (the SSLRequest).
  socket.once("data", () => socket.destroy());
  socket.once("error", () => {});
});

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => resolve());
});

const addr = server.address() as net.AddressInfo;

async function attempt() {
  const sql = new SQL({
    url: `postgres://u@127.0.0.1:${addr.port}/db`,
    tls: true,
    adapter: "postgres",
    max: 1,
    idleTimeout: 1,
    connectionTimeout: 5,
  });
  try {
    await sql.connect();
  } catch {}
  try {
    await sql.close();
  } catch {}
}

// Warm up: let one-time allocations (first SSL_CTX libraries, etc.) settle.
for (let i = 0; i < 50; i++) {
  await attempt();
}
Bun.gc(true);
await Bun.sleep(10);
Bun.gc(true);

const rssBefore = process.memoryUsage.rss();

const iterations = 2000;
for (let i = 0; i < iterations; i++) {
  await attempt();
  if (i % 200 === 0) Bun.gc(true);
}

Bun.gc(true);
await Bun.sleep(10);
Bun.gc(true);

const rssAfter = process.memoryUsage.rss();

server.close();

const deltaMB = (rssAfter - rssBefore) / 1024 / 1024;
console.log(JSON.stringify({ rssBefore, rssAfter, deltaMB, iterations }));
