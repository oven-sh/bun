// One accessor of a server's connection is replaced behind the first response. How often the server reads it is printed for the rest of that exchange, for three more on the connection and for its close.
import { once } from "node:events";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import net, { type AddressInfo, type Socket } from "node:net";

const names = [
  "destroyed",
  "readable",
  "readableEnded",
  "readableLength",
  "readableHighWaterMark",
  "writableHighWaterMark",
  "writableEnded",
];

let reads = 0;

function defineOn(holder: object, socket: Socket, name: string) {
  let owner: object = socket;
  while (!Object.hasOwn(owner, name)) owner = Object.getPrototypeOf(owner);
  const original = Object.getOwnPropertyDescriptor(owner, name)!.get!;
  Object.defineProperty(holder, name, {
    configurable: true,
    get(this: Socket) {
      reads++;
      return original.call(this);
    },
  });
}

const replacements: Record<string, (socket: Socket, name: string) => void> = {
  "on the socket": (socket, name) => defineOn(socket, socket, name),
  "on an heir of the prototype of the socket": (socket, name) => {
    const heir = Object.create(Object.getPrototypeOf(socket));
    defineOn(heir, socket, name);
    Object.setPrototypeOf(socket, heir);
  },
};

const get = "GET / HTTP/1.1\r\nHost: a\r\n\r\n";
const post = "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 5\r\n\r\nhello";

const exchanges: Record<string, { request: string; respond(req: IncomingMessage, res: ServerResponse): void }> = {
  "GET, end(body)": { request: get, respond: (_req, res) => void res.end("ok") },
  "GET, write(), end(body)": {
    request: get,
    respond(_req, res) {
      res.write("o");
      res.end("k");
    },
  },
  "GET, a content-length, write(), end()": {
    request: get,
    respond(_req, res) {
      res.setHeader("content-length", 2);
      res.write("ok");
      res.end();
    },
  },
  "POST with the body read": {
    request: post,
    respond(req, res) {
      req.on("data", () => {});
      req.on("end", () => res.end("ok"));
    },
  },
  "POST with the body read, write(), end(body)": {
    request: post,
    respond(req, res) {
      req.on("data", () => {});
      req.on("end", () => {
        res.write("o");
        res.end("k");
      });
    },
  },
  "POST with the body ignored": { request: post, respond: (_req, res) => void res.end("ok") },
};

let respond: (req: IncomingMessage, res: ServerResponse) => void;
const server = http.createServer((req, res) => respond(req, res));
await once(server.listen(0, "127.0.0.1"), "listening");
const port = (server.address() as AddressInfo).port;

async function exchange(client: Socket, request: string) {
  client.write(request);
  await once(client, "data");
  for (let turn = 0; turn < 2; turn++) await new Promise(resolve => setImmediate(resolve));
  const seen = reads;
  reads = 0;
  return seen;
}

for (const [where, replace] of Object.entries(replacements)) {
  for (const name of names) {
    for (const [how, { request, respond: answer }] of Object.entries(exchanges)) {
      const client = net.connect(port, "127.0.0.1");
      await once(client, "connect");
      let connection: Socket;
      respond = (req, res) => {
        connection = req.socket;
        res.end("ok");
        replace(connection, name);
      };
      const counts = [await exchange(client, get)];
      respond = answer;
      for (let i = 0; i < 3; i++) counts.push(await exchange(client, request));
      const closed = once(connection!, "close");
      client.destroy();
      await closed;
      counts.push(reads);
      reads = 0;
      console.log(`${name} ${where}, ${how}: ${counts.join(" ")}`);
    }
  }
}
server.close();
