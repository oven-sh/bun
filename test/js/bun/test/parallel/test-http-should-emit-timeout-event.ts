import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
const { expect } = createTest(import.meta.path);

await using server = http.createServer().listen(0);
await once(server, "listening");

// Send an incomplete request (the declared body never arrives) so the request
// is still incomplete when the timeout fires; like Node, a request that has
// already completed does not get a 'timeout' event.
const client = net.connect((server.address() as net.AddressInfo).port);
await once(client, "connect");
client.write("POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 10\r\n\r\nabc");

const [req, res] = await once(server, "request");
expect(req.complete).toBe(false);
let callBackCalled = false;
req.setTimeout(100, () => {
  callBackCalled = true;
});
await once(req, "timeout");
expect(callBackCalled).toBe(true);
// Like Node, a timeout with a listener attached does not destroy the socket;
// tear the connection down explicitly so the process can exit.
client.destroy();
req.socket.destroy();
