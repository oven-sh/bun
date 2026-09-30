import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
const { expect } = createTest(import.meta.path);

await using server = http.createServer().listen(0);
await once(server, "listening");
fetch(`http://localhost:${server.address().port}`)
  .then(res => res.text())
  .catch(() => {});

// Like Node, a GET is incomplete inside the 'request' listener and complete
// once the listener returns. It does not wait for 'close'.
let completeInListener: boolean | undefined;
server.once("request", req => {
  completeInListener = req.complete;
});
const [req, res] = await once(server, "request");
const completeAfterListener = req.complete;
const closeEvent = once(req, "close");
res.end("hi");

await closeEvent;
// Asserted after the response ended: a failure before it would leave the
// connection open and the server could not close.
expect(completeInListener).toBe(false);
expect(completeAfterListener).toBe(true);
expect(req.complete).toBe(true);
