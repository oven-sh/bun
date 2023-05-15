const server = require("http").createServer();
const ioc = require("socket.io-client");
const io = require("socket.io")(server);

const srv = server.listen(() => {
  const socket = ioc.connect("ws://localhost:" + server.address().port);
  socket.on("connect", () => {
    io.close();
    socket.close();
  });
});
