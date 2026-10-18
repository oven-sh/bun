// Server for the "a buffer for a received message cannot grow" tests in
// websocket-server-fail-close-codes.test.ts. The parent caps every allocation in this
// process (ASAN_OPTIONS=max_allocation_size_mb) and drives raw clients against the port
// printed below. Every line of stdout is one JSON event.
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req, server) {
    if (server.upgrade(req)) return;
    return new Response("upgrade failed", { status: 400 });
  },
  websocket: {
    perMessageDeflate: true,
    message(ws, message) {
      if (message === "stop") return void server.stop(true);
      ws.send(`got ${message.length}`);
    },
    close(ws, code, reason) {
      console.log(JSON.stringify({ close: code, reason }));
    },
  },
});
console.log(JSON.stringify({ port: server.port }));
