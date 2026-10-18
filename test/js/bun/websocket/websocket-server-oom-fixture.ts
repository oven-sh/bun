// Servers for the "a buffer for a received message cannot grow" tests in
// websocket-server-fail-close-codes.test.ts. The parent caps every allocation in this
// process (ASAN_OPTIONS=max_allocation_size_mb) and drives raw clients against the ports
// printed first. Every later line of stdout is one JSON event: a close, or an 'error' of `ws`.
import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";

const emit = (event: object) => console.log(JSON.stringify(event));

// Leaves 3 MiB unsent on the socket: no write reaches the kernel until a socket closes.
let stalled = false;
function stall(send: (data: Buffer) => void) {
  stalled = true;
  fault.set({ syscall: "send", action: "zero", repeat: -1 });
  fault.set({ syscall: "writev", action: "zero", repeat: -1 });
  send(Buffer.alloc(3 * 1024 * 1024));
}
function unstall() {
  if (stalled) fault.clear();
  stalled = false;
}

function serve(tls?: object) {
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    tls,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("upgrade failed", { status: 400 });
    },
    websocket: {
      perMessageDeflate: true,
      message(ws, message) {
        if (message === "stall") return stall(bytes => ws.send(bytes));
        ws.send(`got ${message.length}`);
      },
      close(ws, code, reason) {
        unstall();
        emit({ close: code, reason });
      },
    },
  });
}

const wsPackage = new WebSocketServer({ port: 0, host: "127.0.0.1" });
wsPackage.on("connection", ws => {
  ws.on("message", (data: Buffer, isBinary) => {
    if (!isBinary && data.toString() === "stall") return stall(bytes => ws.send(bytes));
    ws.send(`got ${data.length}`);
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
