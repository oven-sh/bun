const net = require("node:net");

// A local server that accepts the connection and sends nothing keeps the
// socket connected without racing data delivery against process exit. Unref it
// so only the client socket's ref state decides whether the process stays alive.
const server = net.createServer(() => {});
server.listen(0, () => {
  server.unref();
  const { port } = server.address();
  const socket = net.connect(port, "localhost", () => {
    socket.on("data", () => {
      console.error("Received data. FAIL");
      process.exit(1);
    });
  });
  // The final unref must win: the process has no other pending work, so it
  // should exit cleanly instead of being kept alive by the connected socket.
  socket.unref();
  socket.ref();
  socket.ref();
  socket.ref();
  socket.unref();
});
