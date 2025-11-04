process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const net = require("net");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;

const server = net.createServer(socket => {
  socket.on("data", () => {
    socket.end();
  });
});

server.listen(0, () => {
  const port = server.address().port;

  asyncLocalStorage.run({ test: "net.Socket.write" }, () => {
    const client = net.connect(port);

    client.on("connect", () => {
      // Test write callback
      client.write("test data", err => {
        if (asyncLocalStorage.getStore()?.test !== "net.Socket.write") {
          console.error("FAIL: net.Socket write callback lost context");
          failed = true;
        }
      });

      // Test end callback
      client.end("final data", err => {
        if (asyncLocalStorage.getStore()?.test !== "net.Socket.write") {
          console.error("FAIL: net.Socket end callback lost context");
          failed = true;
        }
      });
    });

    client.on("close", () => {
      server.close();
      process.exit(failed ? 1 : 0);
    });
  });
});
