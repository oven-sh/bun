import { createTest } from "node-harness";
import { once } from "node:events";
import { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
const { expect } = createTest(import.meta.path);

// This matches Node.js:
const im = Object.create(IncomingMessage.prototype);
IncomingMessage.call(im, { url: "/foo" } as any);
expect(im.url).toBe("");

let didCall = false;
function Subclass(...args: [any]) {
  IncomingMessage.apply(this, args);
  didCall = true;
}
Object.setPrototypeOf(Subclass.prototype, IncomingMessage.prototype);
Object.setPrototypeOf(Subclass, IncomingMessage);

await using server = new Server({ IncomingMessage: Subclass as unknown as typeof IncomingMessage }, (req, res) => {
  if (req instanceof Subclass && didCall) {
    expect(req.url).toBe("/foo");
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("hello");
  } else {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("bye");
  }
});
server.listen(0);
await once(server, "listening");
const response = await fetch(`http://localhost:${(server.address() as AddressInfo).port}/foo`, { method: "GET" });
expect(response.status).toBe(200);
