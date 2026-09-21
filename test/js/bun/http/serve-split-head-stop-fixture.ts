// A request whose head arrives split over two reads, and a handler that calls
// server.stop(true). Prints the x-mark value, the x-pad length and the sorted
// header names that the handler reads afterwards.
//
// SPLIT_HEAD_MODE=lazy reads `req.headers` in the synchronous part of the
// handler. Any other value reads them after an await, which returns the
// snapshot the server takes itself when the dispatch ends.
import { existsSync } from "node:fs";
import { connect } from "node:net";

const { promise: printed, resolve: finish } = Promise.withResolvers<void>();

function report(req: Request) {
  const got: Record<string, string> = {};
  for (const [key, value] of req.headers) got[key] = value;
  console.log([got["x-mark"], String(got["x-pad"]?.length), Object.keys(got).sort().join(",")].join("|"));
  finish();
}

// Native allocations of many sizes around the size of the freed block (about
// 430 bytes). On a build with no sanitizer they take it over, so a view into
// it reads their bytes. The names stay far below the shortest platform path
// limit (1024 bytes on macOS).
function churn() {
  for (let n = 64; n < 768; n += 8) {
    const name = Buffer.alloc(n, 0x5a).toString();
    try {
      Bun.resolveSync("./" + name, "/tmp");
    } catch {}
    try {
      existsSync("/tmp/" + name);
    } catch {}
  }
}

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  idleTimeout: 0,
  fetch(req, srv) {
    if (req.url.endsWith("/barrier")) return new Response("ok");
    srv.stop(true);
    churn();
    if (process.env.SPLIT_HEAD_MODE === "lazy") {
      report(req);
      return new Response("x");
    }
    return (async () => {
      // Only to make the handler return a pending promise, so that the server
      // snapshots the headers itself as the dispatch ends.
      await Bun.sleep(1);
      report(req);
      return new Response("x");
    })();
  },
});

const head =
  "GET /a HTTP/1.1\r\nHost: x\r\nX-Pad: " +
  Buffer.alloc(300, 0x70).toString() +
  "\r\nX-Mark: " +
  Buffer.alloc(40, 0x4d).toString() +
  "\r\n\r\n";
const socket = connect(server.port, "127.0.0.1");
socket.on("error", () => {});
await new Promise(resolve => socket.once("connect", resolve));
socket.setNoDelay(true);
// One read that holds a whole request plus the first 22 bytes of the next
// head: the server answers the first and parks the rest in the parser's
// fallback buffer.
const answered = new Promise(resolve => socket.once("data", resolve));
socket.write("GET /barrier HTTP/1.1\r\nHost: x\r\n\r\n" + head.slice(0, 22));
await answered;
// The rest of the head. This request is parsed out of the buffer.
socket.write(head.slice(22));
await printed;
socket.destroy();
