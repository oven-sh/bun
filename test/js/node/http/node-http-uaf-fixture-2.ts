import http from "http";
import { once } from "events";
import type { AddressInfo } from "net";
const unix = process.env.SOCKET_PATH;
const server = http
  .createServer((req, res) => {
    res.writeHead(200, { Connection: "close" });
    res.destroy();
  })
  .listen(unix ?? 0);
await once(server, "listening");
const url = unix ? "http://localhost" : `http://localhost:${(server.address() as AddressInfo).port}`;
console.log(`Server running at ${unix ?? url}`);

const body = new Blob([Buffer.allocUnsafe(1024 * 1024 * 10)]);
const ROUNDS = Number(process.env.ROUNDS ?? 100);

for (let i = 0; i < ROUNDS; i++) {
  await Promise.all(
    [...Array(10)].map(() =>
      fetch(url, {
        unix,
        method: "POST",
        body,
      })
        .then(r => r.blob())
        .catch(() => {}),
    ),
  );
}

server.close();
console.log("Done");
