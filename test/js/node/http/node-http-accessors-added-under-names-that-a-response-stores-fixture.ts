// A prototype of a server's response gets an accessor under a name that the constructors store. Every stored value is printed for a response that a program makes itself and for the responses of a GET and of a HEAD request.
import { once } from "node:events";
import http, { IncomingMessage, OutgoingMessage, ServerResponse } from "node:http";
import net, { type AddressInfo } from "node:net";
import { Stream } from "node:stream";

const names = [
  "sendDate",
  "useChunkedEncodingByDefault",
  "finished",
  "_hasBody",
  "writable",
  "destroyed",
  "outputSize",
  "_last",
  "_header",
  "_sent100",
  "req",
  "statusMessage",
  "_keepAliveTimeout",
  "_contentLength",
  "outputData",
  "maxRequestsOnConnectionReached",
  "_defaultKeepAlive",
  "_removedConnection",
  "_removedContLen",
  "_removedTE",
  "strictContentLength",
  "_trailer",
  "_headerSent",
  "_closed",
  "_onPendingData",
  "statusCode",
  "_maxListeners",
  "_eventsCount",
];
const holders: [string, object][] = [
  ["ServerResponse.prototype", ServerResponse.prototype],
  ["OutgoingMessage.prototype", OutgoingMessage.prototype],
  ["Stream.prototype", Stream.prototype],
];

let stores: string[] = [];
const show = (value: unknown) =>
  typeof value === "function" || (typeof value === "object" && value !== null) ? typeof value : String(value);

const server = http.createServer((_req, res) => void res.end("ok"));
await once(server.listen(0, "127.0.0.1"), "listening");
const port = (server.address() as AddressInfo).port;

async function exchange(method: string) {
  const client = net.connect(port, "127.0.0.1");
  await once(client, "connect");
  client.resume();
  client.write(`${method} / HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n`);
  await once(client, "close");
  const seen = stores.join(" ");
  stores = [];
  return seen;
}

for (const [where, holder] of holders) {
  for (const name of names) {
    if (Object.hasOwn(holder, name)) continue;
    const kept = new WeakMap<object, unknown>();
    Object.defineProperty(holder, name, {
      configurable: true,
      get() {
        return kept.get(this);
      },
      set(value) {
        stores.push(show(value));
        kept.set(this, value);
      },
    });
    new ServerResponse(new IncomingMessage(null as any));
    const made = stores.join(" ");
    stores = [];
    const get = await exchange("GET");
    const head = await exchange("HEAD");
    delete (holder as any)[name];
    console.log(`${name} on ${where}: made [${made}] GET [${get}] HEAD [${head}]`);
  }
}
server.close();
