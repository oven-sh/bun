import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
const { expect } = createTest(import.meta.path);

await using server = http.createServer().listen(0);
await once(server, "listening");
let callBackCalled = false;
// Node.js: once a 'timeout' listener is installed the runtime does not
// destroy the socket; the listener decides. Destroy it here so the fetch
// below completes and the server can close.
server.setTimeout(100, socket => {
  callBackCalled = true;
  console.log("Called timeout");
  socket.destroy();
});

fetch(`http://localhost:${server.address().port}`, { verbose: true })
  .then(res => res.text())
  .catch(err => {
    console.log(err);
  });

const [req, res] = await once(server, "request");
expect(req.complete).toBe(false);
await once(server, "timeout");
expect(callBackCalled).toBe(true);
