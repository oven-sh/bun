// Fixture for the setSession memory-leak test in node-tls-connect.test.ts.
//
// d2i_SSL_SESSION returns a newly-owned SSL_SESSION (refcount 1).
// SSL_set_session takes its own reference ("the caller retains ownership"),
// so the caller must SSL_SESSION_free the one from d2i_SSL_SESSION. When that
// free is missing, every setSession() call leaks one SSL_SESSION (~7 KB with
// the agent1 cert chain).
//
// We call socket.setSession(buf) many times in a single connection's `open`
// handler – the only window in which SSL_set_session is legal (before the
// handshake starts) – and report the resulting RSS growth.
import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";

const fixturesDir = path.join(import.meta.dirname, "fixtures");
const iterations = parseInt(process.argv[2] || "20000", 10);

const server = tls.createServer(
  {
    key: fs.readFileSync(path.join(fixturesDir, "agent1-key.pem")),
    cert: fs.readFileSync(path.join(fixturesDir, "agent1-cert.pem")),
    maxVersion: "TLSv1.2",
  },
  socket => socket.end(),
);

await new Promise<void>(resolve => server.listen(0, resolve));
const port = (server.address() as import("node:net").AddressInfo).port;

// First connection: obtain a serialized session to feed back into setSession().
const session = await new Promise<Buffer>((resolve, reject) => {
  const socket = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false }, () => {
    const sess = socket.getSession();
    socket.on("close", () => resolve(sess!));
    socket.end();
  });
  socket.on("error", reject);
});

// Call native setSession() `n` times from the `open` handler of a single TLS
// client connection. For an SSL socket, Bun only invokes `open` (before the
// handshake) when both `open` and `handshake` handlers are supplied.
function runSetSessionLoop(n: number) {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  let calls = 0;
  Bun.connect({
    hostname: "127.0.0.1",
    port,
    tls: { rejectUnauthorized: false },
    socket: {
      open(socket) {
        for (let i = 0; i < n; i++) {
          socket.setSession(session);
          calls++;
        }
      },
      handshake(socket) {
        socket.end();
      },
      data() {},
      close() {
        resolve(calls);
      },
      error(_socket, err) {
        reject(err);
      },
    },
  }).catch(reject);
  return promise;
}

// Warm up the allocator so the measured window isn't dominated by first-use
// growth (mimalloc page commit, JIT, etc.).
await runSetSessionLoop(500);
Bun.gc(true);
const before = process.memoryUsage.rss();

const calls = await runSetSessionLoop(iterations);
Bun.gc(true);
const after = process.memoryUsage.rss();

console.log(JSON.stringify({ calls, growthBytes: after - before }));

server.close();
