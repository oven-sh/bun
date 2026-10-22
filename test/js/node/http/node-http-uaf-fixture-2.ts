// Fixture for #18564: the server destroys a response while the client is still
// uploading a large body. Ten uploads at a time, ROUNDS times. Prints one JSON
// line with the request tally.
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";

const server = http
  .createServer((req, res) => {
    res.writeHead(200, { Connection: "close" });
    res.destroy();
  })
  .listen(0, "127.0.0.1");
await once(server, "listening");
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const body = new Blob([Buffer.allocUnsafe(1024 * 1024 * 10)]);
const ROUNDS = Number(process.env.ROUNDS ?? 100);
const tally = { requests: 0, responded: 0, failed: 0 };

for (let i = 0; i < ROUNDS; i++) {
  await Promise.all(
    [...Array(10)].map(() => {
      tally.requests++;
      return fetch(url, { method: "POST", body })
        .then(r => r.blob())
        .then(
          () => tally.responded++,
          () => tally.failed++,
        );
    }),
  );
}

server.close();
console.log(JSON.stringify(tally));
