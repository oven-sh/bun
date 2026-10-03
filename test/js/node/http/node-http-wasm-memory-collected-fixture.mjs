// A node:http handler that makes its `WebAssembly.Memory` per request and
// writes straight from it. After `grow()` nothing the pending write holds keeps
// the memory alive, so a collection releases its pages before `res.end()`
// spills the unsent tail. A fast memory is enough, and one memory in the whole
// process is enough.
//
// Exits 0 and prints the body it received, which must be the bytes the handler
// passed. An unfixed build faults on the spill or sends another object's bytes.
import http from "node:http";
import net from "node:net";
import { once } from "node:events";
const PAGES = 512; // 32 MB
const CHUNK_SIZE = PAGES * 65536;

const wrote = Promise.withResolvers();
const server = http.createServer((req, res) => {
  // Local to the handler, so it is unreachable once this returns.
  const mem = new WebAssembly.Memory({ initial: PAGES, maximum: PAGES + 8 });
  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Length": String(CHUNK_SIZE),
  });
  res.write(new Uint8Array(mem.buffer).fill(7));
  mem.grow(2);
  wrote.resolve(res);
});
await once(server.listen(0), "listening");

const socket = net.connect(server.address().port, "127.0.0.1");
await once(socket, "connect");
socket.pause();
socket.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
const res = await wrote.promise;

// The handler has returned, so its memory is unreachable. The program's
// other work claims the released pages, and then the response ends.
await new Promise(resolve => setImmediate(resolve));
Bun.gc(true);
globalThis.claim = Array.from({ length: 4 }, () => new Uint8Array(CHUNK_SIZE).fill(0xee));
res.end(); // spills the pending tail

const chunks = [];
socket.on("data", c => chunks.push(c));
const closed = once(socket, "close");
socket.resume();
await closed;

const received = Buffer.concat(chunks);
const body = received.subarray(received.indexOf("\r\n\r\n") + 4);
const expected = Buffer.alloc(CHUNK_SIZE, 7);
console.log(JSON.stringify({ bodyLength: body.length, bodyMatches: Buffer.compare(body, expected) === 0 }));
server.close();
