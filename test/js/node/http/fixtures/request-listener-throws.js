// Runs an http server whose 'request' listener throws, sends one raw request
// over a plain socket, and prints the raw bytes the server wrote back.
// HANDLER selects which listener runs. RAW_REQUEST is the request text.
const http = require("node:http");
const net = require("node:net");

const handlers = {
  "throw-before-write": (req, res) => {
    throw new Error("boom");
  },
  "throw-after-write": (req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write("partial");
    res.flushHeaders();
    throw new Error("boom");
  },
};

const handler = handlers[process.env.HANDLER];
if (!handler) throw new Error(`unknown HANDLER: ${process.env.HANDLER}`);
const request = process.env.RAW_REQUEST;
if (!request) throw new Error("RAW_REQUEST is not set");

// The listener's throw must not kill the process; we want the bytes it wrote.
process.on("uncaughtException", () => {});

const server = http.createServer(handler);
server.listen(0, "127.0.0.1", () => {
  const socket = net.connect(server.address().port, "127.0.0.1", () => {
    socket.write(request);
  });
  let raw = "";
  socket.setEncoding("latin1");
  socket.on("data", c => (raw += c));
  socket.on("error", () => {});
  socket.on("close", () => {
    console.log(JSON.stringify({ raw }));
    server.close();
  });
});
