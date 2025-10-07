import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
const { expect } = createTest(import.meta.path);

await using server = http.createServer().listen(0);
server.unref();
await once(server, "listening");
const controller = new AbortController();
fetch(`http://localhost:${server.address().port}`, { signal: controller.signal })
  .then(res => res.text())
  .catch(() => {});

const [req, res] = await once(server, "request");
const closeEvent = Promise.withResolvers();
req.once("close", () => {
  closeEvent.resolve();
});
controller.abort();
await closeEvent.promise;
expect(req.aborted).toBe(true);
