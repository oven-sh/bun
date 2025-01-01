// For this test to consistently reproduce the original issue, you need guard malloc enabled.
// DYLD_INSERT_LIBRARIES=(realpath  /usr/lib/libgmalloc.dylib)
// MALLOC_PROTECT_BEFORE=1
// MallocScribble=1
// MallocGuardEdges=1
// MALLOC_FILL_SPACE=1
// MALLOC_STRICT_SIZE=1

let pending = [];
using server = Bun.serve({
  port: 0,
  idleTimeout: 0,
  websocket: {
    open(ws) {
      globalThis.sockets ??= [];
      globalThis.sockets.push(ws);
      ws.data = Promise.withResolvers();
      pending.push(ws.data.promise);
      ws.subscribe("bye");
      setTimeout(() => {
        ws.close();
      });
    },
    close(ws, code, reason) {
      setTimeout(
        ws => {
          Bun.gc();
          for (let i = 0; i < 10; i++) {
            ws.publishText("bye", "ok");
            ws.publishBinary("bye", Buffer.from("ok"));
            ws.publish("bye", "ok");
            ws.subscribe("bye", "ok");
            ws.isSubscribed("bye", "ok");
            ws.send("bye");
            ws.sendText("bye");
            ws.sendBinary(Buffer.from("bye"));
          }
          ws.data.resolve();
        },
        10,
        ws,
      );
      Bun.gc();
    },
  },
  fetch(req, server) {
    return server.upgrade(req);
  },
});

for (let i = 0; i < 5; i++) {
  const ws = new WebSocket(`ws://${server.hostname}:${server.port}`);

  let { promise, resolve } = Promise.withResolvers();
  ws.addEventListener("open", () => {});
  ws.addEventListener("message", e => {});

  ws.addEventListener("close", () => {
    console.count("Closed");
    resolve();
  });
  pending.push(promise);
}

await Bun.sleep(1);
Bun.gc(true);
await Promise.all(pending);
Bun.gc(true);
console.log("Exiting");
