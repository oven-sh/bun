import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
const { expect } = createTest(import.meta.path);

await using server = http.createServer((req, res) => {
  res.end(JSON.stringify(req.headers));
});
await once(server.listen(0), "listening");
const url = `http://localhost:${server.address().port}`;
for (let method of ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"]) {
  const { promise, resolve, reject } = Promise.withResolvers();
  http
    .request(
      url,
      {
        method,
      },
      res => {
        const body: Uint8Array[] = [];
        res.on("data", chunk => {
          body.push(chunk);
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(body).toString()));
          } catch (e) {
            reject(e);
          }
        });
      },
    )
    .on("error", reject)
    .end();

  const headers = (await promise) as Record<string, string | undefined>;
  expect(headers).toBeDefined();
  expect(headers["transfer-encoding"]).toBeUndefined();
  switch (method) {
    case "GET":
    case "DELETE":
    case "OPTIONS":
      // Content-Length will not be present for GET, DELETE, and OPTIONS
      // aka DELETE in node.js will be undefined and in bun it will be 0
      // this is not outside the spec but is different between node.js and bun
      expect(headers["content-length"]).toBeOneOf(["0", undefined]);
      break;
    default:
      expect(headers["content-length"]).toBeDefined();
      break;
  }
}
