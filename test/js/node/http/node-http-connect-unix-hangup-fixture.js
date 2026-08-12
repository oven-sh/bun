// N CONNECT clients over an AF_UNIX listener each destroy() once the server holds the handed-off
// socket; the server never ends its side. Prints per-target {ends, closes} once every server socket has closed.
const http = require("node:http");
const net = require("node:net");

const N = 8;
const clients = new Map();
const counts = {};
let closed = 0;

const server = http.createServer();
server.on("connect", (req, socket) => {
  const c = (counts[req.url] = { ends: 0, closes: 0 });
  socket.on("error", err => (c.error = err.code || String(err)));
  socket.on("end", () => c.ends++);
  socket.on("close", () => {
    c.closes++;
    if (++closed === N) {
      const sorted = Object.fromEntries(Object.keys(counts).sort().map(k => [k, counts[k]]));
      console.log(JSON.stringify(sorted));
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
    client.on("error", err => {
      console.error("client " + target + " error: " + (err.code || err));
      process.exitCode = 1;
    });
    clients.set(target, client);
  }
});
