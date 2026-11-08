// ServerResponse.prototype gets an accessor under every name that a response has of its own. The stores are printed in their order for a response that a program makes itself and for the responses of a GET and of a HEAD request.
import { once } from "node:events";
import http, { IncomingMessage, ServerResponse } from "node:http";
import net, { type AddressInfo } from "node:net";

let stores: string[] = [];
const show = (value: unknown) =>
  typeof value === "function" || (typeof value === "object" && value !== null) ? typeof value : String(value);

let seen: string[] = [];
const server = http.createServer((_req, res) => {
  seen = stores;
  stores = [];
  res.end("ok");
});
await once(server.listen(0, "127.0.0.1"), "listening");
const port = (server.address() as AddressInfo).port;

async function exchange(method: string) {
  const client = net.connect(port, "127.0.0.1");
  await once(client, "connect");
  client.resume();
  client.write(`${method} / HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n`);
  await once(client, "close");
  stores = [];
  return seen.join(" ");
}

const names = Object.keys(new ServerResponse(new IncomingMessage(null as any))).filter(
  name => !Object.hasOwn(ServerResponse.prototype, name),
);
console.log(names.join(" "));
const kept = new WeakMap<object, Map<string, unknown>>();
for (const name of names) {
  Object.defineProperty(ServerResponse.prototype, name, {
    configurable: true,
    get() {
      return kept.get(this)?.get(name);
    },
    set(value) {
      stores.push(`${name}=${show(value)}`);
      let values = kept.get(this);
      if (!values) kept.set(this, (values = new Map()));
      values.set(name, value);
    },
  });
}
new ServerResponse(new IncomingMessage(null as any));
console.log("made: " + stores.join(" "));
stores = [];
console.log("GET: " + (await exchange("GET")));
console.log("HEAD: " + (await exchange("HEAD")));
server.close();
