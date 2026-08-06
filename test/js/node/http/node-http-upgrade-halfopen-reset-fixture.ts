// Half-open Upgrade socket with queued writes; the peer never reads, FINs, then RSTs.
// The server socket must be closed (and the process exit), not left spinning on the
// one-shot EVFILT_WRITE that kqueue keeps re-delivering with EV_EOF.
import { once } from "node:events";
import http from "node:http";
import net from "node:net";

const server = http.createServer((req, res) => res.end());
const closed = Promise.withResolvers();
const halfClosed = Promise.withResolvers();
const backedUp = Promise.withResolvers();
server.on("upgrade", (req, socket) => {
  socket.on("error", () => {});
  socket.on("close", () => closed.resolve());
  // Like ws: answer the peer's FIN with end(), which queues behind the pending writes.
  // 'end' firing also means read interest was already dropped, the state the fix keys on.
  socket.on("end", () => {
    socket.end();
    halfClosed.resolve();
  });
  // Flowing mode so the peer's FIN is consumed and 'end' actually fires (node semantics).
  socket.resume();
  socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: x\r\n\r\n");
  const chunk = Buffer.alloc(4 * 1024 * 1024, 0x61);
  for (let i = 0; i < 8; i++) socket.write(chunk);
  backedUp.resolve();
});
await once(server.listen(0, "127.0.0.1"), "listening");

const c = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
c.on("error", () => {});
// Never read: the server's 32 MB stays queued behind a full pipe.
c.pause();
await once(c, "connect");
c.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: x\r\n\r\n");
await backedUp.promise;
// Half-close once the server has its writes queued.
c.end();
// The server has read our FIN; now vanish.
await halfClosed.promise;
c.resetAndDestroy();

await closed.promise;
console.log("closed");
server.close();
// Exiting naturally (no process.exit) proves the loop went idle instead of spinning.
