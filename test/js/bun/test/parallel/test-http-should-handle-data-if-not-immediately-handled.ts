import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
const { expect } = createTest(import.meta.path);

// Create a local server to receive data from
await using server = http.createServer();

// Listen to the request event
server.on("request", (request, res) => {
  setTimeout(() => {
    const body: Uint8Array[] = [];
    request.on("data", chunk => {
      body.push(chunk);
    });
    request.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(Buffer.concat(body));
    });
  }, 100);
});
await once(server.listen(0), "listening");
const url = `http://localhost:${server.address().port}`;
const payload = "Hello, world!".repeat(10).toString();
const res = await fetch(url, {
  method: "POST",
  body: payload,
});
expect(res.status).toBe(200);
expect(await res.text()).toBe(payload);
