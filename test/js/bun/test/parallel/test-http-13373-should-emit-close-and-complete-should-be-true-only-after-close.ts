import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
const { expect } = createTest(import.meta.path);

await using server = http.createServer().listen(0);
await once(server, "listening");
fetch(`http://localhost:${server.address().port}`)
  .then(res => res.text())
  .catch(() => {});

const [req, res] = await once(server, "request");
// Like Node: a request without a body is complete once its 'request' listeners have returned.
expect(req.complete).toBe(true);
console.log("ok 1");
const closeEvent = once(req, "close");
res.end("hi");

await closeEvent;
expect(req.complete).toBe(true);
