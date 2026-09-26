// A request whose head arrives split over two reads, reached by the client
// alone: it declares a body it never sends, and `Connection: close` makes the
// completed response close the socket inside the dispatch. Prints the reject
// reason of the pending `req.text()`, then the url, the x-pad length and the
// sorted header names that its handler reads.
import { connect } from "node:net";

const { promise: rejected, resolve: finish } = Promise.withResolvers<void>();

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  idleTimeout: 0,
  fetch(req) {
    if (req.method === "GET") return new Response("ok");
    req.text().then(
      () => {
        console.log("resolved, expected a reject");
        finish();
      },
      error => {
        const got: Record<string, string> = {};
        for (const [key, value] of req.headers) got[key] = value;
        console.log(
          [error.name, JSON.stringify(req.url), String(got["x-pad"]?.length), Object.keys(got).sort().join(",")].join(
            "|",
          ),
        );
        finish();
      },
    );
    // Larger than the cork buffer, so the response completes and the close
    // gate fires while this dispatch is still on the stack.
    return new Response(Buffer.alloc(20 * 1024, 0x61).toString());
  },
});

const head =
  "POST /a HTTP/1.1\r\nHost: x\r\nConnection: close\r\nContent-Length: 10\r\nX-Pad: " +
  Buffer.alloc(300, 0x70).toString() +
  "\r\n\r\n";
const socket = connect(server.port, "127.0.0.1");
socket.on("error", () => {});
await new Promise(resolve => socket.once("connect", resolve));
socket.setNoDelay(true);
const answered = new Promise(resolve => socket.once("data", resolve));
// One read: a whole GET plus the first 22 bytes of the POST head, which park
// in the parser's fallback buffer.
socket.write("GET /barrier HTTP/1.1\r\nHost: x\r\n\r\n" + head.slice(0, 22));
await answered;
socket.on("data", () => {});
// The rest of the head, but never the 10 body bytes it declares.
socket.write(head.slice(22));
await rejected;
socket.destroy();
server.stop(true);
