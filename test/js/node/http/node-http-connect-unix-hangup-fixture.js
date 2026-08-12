// N CONNECT clients over an AF_UNIX listener each destroy() once the server holds the handed-off
// socket; the server never ends its side. Prints {ends, closes} once every server socket has closed.
const http = require("node:http");
const net = require("node:net");

const N = 8;
const clients = new Map();
let ends = 0;
let closes = 0;

const server = http.createServer();
server.on("connect", (req, socket) => {
  socket.on("error", () => {});
  socket.on("end", () => ends++);
  socket.on("close", () => {
    if (++closes === N) {
      console.log(JSON.stringify({ ends, closes }));
      server.close();
    }
  });
  clients.get(req.url).destroy();
});
server.listen(process.env.SOCK, () => {
  for (let i = 0; i < N; i++) {
    const target = "peer-" + i + ":443";
    const client = net.connect(process.env.SOCK, () => {
      client.write("CONNECT " + target + " HTTP/1.1\r\nHost: " + target + "\r\n\r\n");
    });
    client.on("error", () => {});
    clients.set(target, client);
  }
});
