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
expect(req.complete).toBe(false);
let callBackCalled = false;
req.setTimeout(100, () => {
  callBackCalled = true;
});
await once(req, "timeout");
expect(callBackCalled).toBe(true);
