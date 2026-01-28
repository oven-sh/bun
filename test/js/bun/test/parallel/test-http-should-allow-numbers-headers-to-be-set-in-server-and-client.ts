import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
const { expect } = createTest(import.meta.path);

let server_headers;
await using server = http.createServer((req, res) => {
  server_headers = req.headers;
  res.setHeader("x-number", 10);
  res.appendHeader("x-number-2", 20);
  res.end();
});

await once(server.listen(0, "localhost"), "listening");
const { promise, resolve } = Promise.withResolvers();

{
  const response = http.request(`http://localhost:${server.address().port}`, resolve);
  response.setHeader("x-number", 30);
  response.appendHeader("x-number-2", 40);
  response.end();
}
const response = (await promise) as Record<string, string>;
expect(response.headers["x-number"]).toBe("10");
expect(response.headers["x-number-2"]).toBe("20");
expect(server_headers["x-number"]).toBe("30");
expect(server_headers["x-number-2"]).toBe("40");
