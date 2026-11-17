const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request, server) {
    if (server.upgrade(request)) return;
    return new Response("not a WebSocket request");
  },
  websocket: {
    message(socket, message) {
      socket.send(`echoed ${message}`);
    },
  },
});

function maskedTextFrame(text: string) {
  const mask = [1, 2, 3, 4];
  const payload = Buffer.from(text).map((byte, index) => byte ^ mask[index % 4]);
  return Buffer.concat([Buffer.from([0x81, 0x80 | payload.length, ...mask]), payload]);
}

const handshake = [
  "GET / HTTP/1.1",
  "Host: localhost",
  "Upgrade: websocket",
  "Connection: Upgrade",
  "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
  "Sec-WebSocket-Version: 13",
  "",
  "",
].join("\r\n");

const answer = Promise.withResolvers<string>();
let received = Buffer.alloc(0);
let hasSentFrame = false;
const client = await Bun.connect({
  hostname: "127.0.0.1",
  port: server.port!,
  socket: {
    open(socket) {
      socket.write(handshake);
    },
    data(socket, chunk) {
      received = Buffer.concat([received, chunk]);
      const endOfHeaders = received.indexOf("\r\n\r\n");
      if (endOfHeaders < 0) return;
      if (!hasSentFrame) {
        hasSentFrame = true;
        socket.write(maskedTextFrame("hello"));
      }
      const frame = received.subarray(endOfHeaders + 4);
      if (frame.length >= 2 && frame.length >= 2 + frame[1]) answer.resolve(frame.subarray(2, 2 + frame[1]).toString());
    },
  },
});
const echoed = await answer.promise;
console.log(received.toString().split("\r\n")[0], echoed);
client.end();
server.stop(true);
