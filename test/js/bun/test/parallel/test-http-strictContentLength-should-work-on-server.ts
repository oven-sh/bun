import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
const { expect } = createTest(import.meta.path);

const { promise, resolve, reject } = Promise.withResolvers();
await using server = http.createServer((req, res) => {
  try {
    res.strictContentLength = true;
    res.writeHead(200, { "Content-Length": 10 });

    res.write("123456789");

    // Too much data
    try {
      res.write("123456789");
      expect.unreachable();
    } catch (e: any) {
      expect(e).toBeInstanceOf(Error);
      expect(e.code).toBe("ERR_HTTP_CONTENT_LENGTH_MISMATCH");
    }

    // Too little data
    try {
      res.end();
      expect.unreachable();
    } catch (e: any) {
      expect(e).toBeInstanceOf(Error);
      expect(e.code).toBe("ERR_HTTP_CONTENT_LENGTH_MISMATCH");
    }

    // Just right
    res.end("0");
    resolve();
  } catch (e: any) {
    reject(e);
  } finally {
  }
});

await once(server.listen(0), "listening");
const url = `http://localhost:${server.address().port}`;
await fetch(url, { method: "GET" }).catch(() => {});
await promise;
