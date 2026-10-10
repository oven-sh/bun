// An http2 client whose socket closes before the session is ready, with no 'error' listener on
// the session. Prints what the process observes, one event per line. Runs under Node.js and Bun.
const http2 = require("node:http2");
const net = require("node:net");

const events = [];
// The monitor records the exception and leaves the default handling (exit code 1) in place.
process.on("uncaughtExceptionMonitor", error => events.push("uncaught " + error.code));
process.on("exit", () => console.log(events.join("\n")));

// The peer accepts the connection and never answers.
const peer = net.createServer(socket => socket.resume());
peer.listen(0, "127.0.0.1", () => {
  const port = peer.address().port;
  const socket = net.connect(port, "127.0.0.1");
  // Added before the session's listener, so it runs on every runtime and the process can end.
  socket.on("close", () => peer.close());
  const client = http2.connect(`http://127.0.0.1:${port}`, { createConnection: () => socket });
  client.on("close", () => events.push("session 'close'"));
  socket.on("close", () => events.push("socket 'close' listener added after the session"));
  socket.destroy();
});
