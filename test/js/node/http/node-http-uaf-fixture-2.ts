import http from "http";
import { once } from "events";
const server = http
  .createServer((req, res) => {
    res.writeHead(200, { Connection: "close" });
    res.destroy();
  })
  .listen(0);
await once(server, "listening");
const url = `http://localhost:${server.address().port}`;
console.log(`Server running at ${url}`);

const body = new Blob([Buffer.allocUnsafe(1024 * 1024 * 10)]);

for (let i = 0; i < 100; i++) {
  await Promise.all(
    [...Array(10)].map(() =>
      fetch(url, {
        method: "POST",
        body,
      })
        .then(r => r.blob())
        .catch(() => {}),
    ),
  );
}

server.close();
