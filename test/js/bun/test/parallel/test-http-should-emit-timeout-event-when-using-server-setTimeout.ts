import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
const { expect } = createTest(import.meta.path);

await using server = http.createServer().listen(0);
await once(server, "listening");
let callBackCalled = false;
server.setTimeout(100, () => {
  callBackCalled = true;
  console.log("Called timeout");
});

fetch(`http://localhost:${server.address().port}`, { verbose: true })
  .then(res => res.text())
  .catch(err => {
    console.log(err);
  });

const [req, res] = await once(server, "request");
// Like Node, a GET is complete once the 'request' listener has returned.
const completeAfterListener = req.complete;
const [timedOutSocket] = await once(server, "timeout");
// Like Node, a timeout with a listener attached does not destroy the socket;
// tear the connection down explicitly so the process can exit.
timedOutSocket.destroy();
expect(completeAfterListener).toBe(true);
expect(callBackCalled).toBe(true);
