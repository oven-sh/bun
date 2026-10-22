// The peer ends its side while the socket takes nothing. A write waits on the stream behind the
// session's buffer. The socket's own end() flushes it, and the callback of that write destroys the
// session from inside the end(). Prints "destroyed" when that callback ran.
import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";
import http2utils from "./helpers";

if (!fault.available()) {
  console.log("destroyed");
  process.exit(0);
}
function frame(type: number, flags: number, id: number, body = Buffer.alloc(0)) {
  return Buffer.concat([new http2utils.Frame(body.length, type, flags, id).data, body]);
}
const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));

const server = http2.createServer();
server.on("sessionError", () => {});
let destroyed = false;
let fd = -1;
let session: http2.ServerHttp2Session;
server.on("session", (serverSession: http2.ServerHttp2Session) => {
  session = serverSession;
  session.on("error", () => {});
});
server.on("connection", (socket: net.Socket) => {
  socket.on("error", () => {});
  fd = (socket as any)._handle.fd;
  socket.on("end", () => {
    fault.clear();
    session.ping(() => {});
  });
});
server.on("stream", async (stream: http2.ServerHttp2Stream) => {
  stream.on("error", () => {});
  for (const syscall of ["send", "writev"] as const) {
    fault.set({ syscall, action: "errno", errno: "EAGAIN", repeat: -1, fd });
  }
  stream.respond({ ":status": 200 });
  stream.write(Buffer.alloc(1000, "a"));
  await nextTurn();
  stream.write(Buffer.alloc(1000, "b"), () => {
    destroyed = true;
    session.destroy();
    Bun.gc(true);
  });
  peer.end();
});
server.listen(0, "127.0.0.1");
await once(server, "listening");

const peer = net.connect({
  port: (server.address() as net.AddressInfo).port,
  host: "127.0.0.1",
  allowHalfOpen: true,
});
let requested = false;
peer.on("error", () => {});
peer.on("data", () => {
  if (requested) return;
  requested = true;
  const authority = Buffer.from("127.0.0.1");
  // SETTINGS ACK, then GET / with END_STREAM.
  const block = Buffer.concat([Buffer.from([0x82, 0x86, 0x84, 0x41, authority.length]), authority]);
  peer.write(Buffer.concat([frame(4, 1, 0), frame(1, 0x5, 1, block)]));
});
// SETTINGS_INITIAL_WINDOW_SIZE and a connection WINDOW_UPDATE of the largest size.
const window = Buffer.from([0x7f, 0xff, 0xff, 0xff]);
const update = Buffer.from([0x7f, 0xff, 0x00, 0x00]);
peer.write(
  Buffer.concat([
    http2utils.kClientMagic,
    frame(4, 0, 0, Buffer.concat([Buffer.from([0, 4]), window])),
    frame(8, 0, 0, update),
  ]),
);
await once(peer, "close");
await nextTurn();
Bun.gc(true);
server.close();
console.log(destroyed ? "destroyed" : "the write callback did not run");
process.exit(0);
