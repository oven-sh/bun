import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
const { expect } = createTest(import.meta.path);

const { promise, resolve, reject } = Promise.withResolvers();

await using server = http.createServer((req, res) => {
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

expect(await promise).toBeTrue();
