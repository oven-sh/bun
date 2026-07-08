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
// Node.js: a 'timeout' listener vetoes the default socket destroy, so the
// callback must destroy the socket itself for the server to close cleanly.
req.setTimeout(100, () => {
  callBackCalled = true;
  req.socket.destroy();
});
await once(req, "timeout");
expect(callBackCalled).toBe(true);
