import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
import type { Socket } from "node:net";
const { expect } = createTest(import.meta.path);

const { promise, resolve, reject } = Promise.withResolvers();
let socket: Socket | undefined;

await using server = http.createServer((req, res) => {
  socket = req.socket;
  res.writeHead(200, { "Connection": "close" });

  res.socket.end();
  res.on("error", reject);
  try {
    const result = res.write("Hello, world!");
    resolve(result);
  } catch (err) {
    reject(err);
  }
});
await once(server.listen(0), "listening");
const url = `http://localhost:${server.address().port}`;

await fetch(url, {
  method: "POST",
  body: Buffer.allocUnsafe(1024 * 1024 * 10),
})
  .then(res => res.bytes())
  .catch(err => {});

// The half-closed connection may never close on its own (node matches);
// destroy it whichever way the promise settles or the disposal above hangs.
let result;
try {
  result = await promise;
} finally {
  socket?.destroy();
}
expect(result).toBeTrue();
