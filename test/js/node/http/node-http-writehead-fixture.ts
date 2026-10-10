// The response of an Upgrade request, used after a WebSocket took its connection:
// writeHead(status, headers) with a Content-Length, then addTrailers() and end().
// The Content-Length is not in the header store. end() must still see it, and must not
// hand the trailers to the connection: the connection has no place for them any more.
//
// Prints one JSON line. The process has to exit by itself.
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import { WebSocketServer } from "ws";

const wss = new WebSocketServer({ noServer: true });
const ended = Promise.withResolvers<void>();
const switched = Promise.withResolvers<void>();
const firstTrailer = Buffer.alloc(200, "a").toString();

const server = http.createServer((req, res) => {
  res.on("error", () => {});
  if (req.url === "/first") {
    // A response with trailers, so that the connection has had a place for trailers.
    res.write("first-body");
    res.addTrailers({ "x-first": firstTrailer });
    res.end();
    return;
  }
  wss.handleUpgrade(req, req.socket, Buffer.alloc(0), ws => {
    ws.on("error", () => {});
    try {
      res.writeHead(200, { "Content-Length": 4 });
      res.addTrailers({ "x-second": Buffer.alloc(100, "b").toString() });
      res.end("late");
    } catch {
      // The response has no connection. Whether end() throws for that is not the subject here.
    }
    ended.resolve();
  });
});
await once(server.listen(0, "127.0.0.1"), "listening");

const client = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
client.on("error", () => {});
let received = "";
let upgradeSent = false;
client.setEncoding("latin1");
client.on("data", chunk => {
  received += chunk;
  if (!upgradeSent && received.endsWith(`0\r\nx-first: ${firstTrailer}\r\n\r\n`)) {
    upgradeSent = true;
    client.write(
      "GET /second HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n" +
        "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
    );
  }
  if (received.includes("HTTP/1.1 101 Switching Protocols\r\n")) switched.resolve();
});
await once(client, "connect");
client.write("GET /first HTTP/1.1\r\nHost: localhost\r\n\r\n");
await Promise.all([ended.promise, switched.promise]);

const closed = once(client, "close");
client.destroy();
await closed;
for (const ws of wss.clients) ws.terminate();
wss.close();
server.close();
server.closeAllConnections();
console.log(JSON.stringify({ ended: true }));
