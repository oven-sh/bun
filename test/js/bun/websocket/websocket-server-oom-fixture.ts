// Servers for the "a buffer for a received message that cannot grow" tests in
// websocket-server-fail-close-codes.test.ts. The parent caps every allocation in this
// process (ASAN_OPTIONS=max_allocation_size_mb) and drives raw clients against the ports
// printed first. Every later line of stdout is one JSON event: a close, a call of the
// `error` handler, an 'error' of `ws`, or the answer to "flood".
import { socketFaultInjection as fault } from "bun:internal-for-testing";
import type { ServerWebSocket } from "bun";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";

const emit = (event: object) => console.log(JSON.stringify(event));
// The answer to a delivered message names its bytes, not only how many there are.
const got = (message: string | Buffer) => `got ${message.length} ${Bun.hash(message)}`;

// No write reaches the kernel until a socket closes. "stall" also leaves 3 MiB unsent on the socket.
let stalled = false;
function hold() {
  stalled = true;
  fault.set({ syscall: "send", action: "zero", repeat: -1 });
  fault.set({ syscall: "writev", action: "zero", repeat: -1 });
}
function stall(send: (data: Buffer) => void) {
  hold();
  send(Buffer.alloc(3 * 1024 * 1024));
}
function unstall() {
  if (stalled) fault.clear();
  stalled = false;
}

// Sends frames until the kernel does not take one whole, which leaves the rest of that one unsent.
// Not from the message handler: there a send only goes to the cork buffer.
function flood(ws: ServerWebSocket<unknown>) {
  const frame = Buffer.alloc(64 * 1024, 1);
  let whole = 0;
  while (ws.send(frame) > 0) whole++;
  emit({ flooded: whole });
}

function serve(tls?: object) {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    tls,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("upgrade failed", { status: 400 });
    },
    websocket: {
      perMessageDeflate: true,
      open(ws) {
        ws.subscribe("room");
      },
      message(ws, message) {
        if (message === "stall") return stall(bytes => ws.send(bytes));
        if (message === "hold") return hold();
        if (message === "publish") return void server.publish("room", "published");
        if (message === "flood") return void setImmediate(flood, ws);
        ws.send(got(message));
      },
      // A message that is refused is not a handler that threw, so nothing may arrive here.
      error(error) {
        emit({ error: String(error) });
      },
      close(ws, code, reason) {
        unstall();
        emit({ close: code, reason });
      },
    },
  });
  return server;
}

const wsPackage = new WebSocketServer({ port: 0, host: "127.0.0.1" });
wsPackage.on("connection", ws => {
  ws.on("message", (data: Buffer, isBinary) => {
    if (!isBinary && data.toString() === "stall") return stall(bytes => ws.send(bytes));
    ws.send(got(data));
  });
  ws.on("error", (error: NodeJS.ErrnoException) => {
    emit({ error: error.name, message: error.message, code: error.code });
  });
  ws.on("close", code => {
    unstall();
    emit({ close: code });
  });
});
await once(wsPackage, "listening");

emit({
  ws: serve().port,
  wss: serve(JSON.parse(process.env.WS_OOM_TLS!)).port,
  "ws-package": (wsPackage.address() as AddressInfo).port,
});
