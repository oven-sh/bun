import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
const { expect } = createTest(import.meta.path);

await using server = http.createServer((req, res) => {
  res.writeHead(200, { "Strict-Transport-Security": "max-age=31536000" });
  res.end();
});
server.listen(0, "localhost");
await once(server, "listening");
const response = await fetch(`http://localhost:${server.address().port}`);
expect(response.status).toBe(200);
expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000");
