// Worker hosting a wss:// server that freezes its event loop on the first message: TCP still ACKs, but close_notify is never answered.
import { tls } from "harness";

declare const self: Worker;

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  tls,
  fetch(req, server) {
    if (server.upgrade(req)) return;
    return new Response("expected websocket", { status: 400 });
  },
  websocket: {
    message() {
      self.postMessage("frozen");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    },
  },
});

self.postMessage(server.port);
