const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request, server) {
    return server.upgrade(request) ? undefined : new Response("not a WebSocket", { status: 400 });
  },
  websocket: {
    message(socket, message) {
      socket.send(typeof message === "string" ? message.toUpperCase() : message);
    },
  },
});

const socket = new WebSocket(`ws://127.0.0.1:${server.port}/`);
socket.binaryType = "arraybuffer";
const received: string[] = [];
const { promise: closed, resolve: didClose } = Promise.withResolvers<number>();
socket.onopen = () => {
  socket.send("text");
  socket.send(new Uint8Array([1, 2, 3]));
};
socket.onmessage = event => {
  received.push(typeof event.data === "string" ? event.data : `bytes ${new Uint8Array(event.data).join(",")}`);
  if (received.length === 2) socket.close(1000, "done");
};
socket.onclose = event => didClose(event.code);
console.log(await closed, received.join(" | "));
server.stop(true);
