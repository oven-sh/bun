process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const net = require("net");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;

asyncLocalStorage.run({ test: "net.Server" }, () => {
  const server = net.createServer();

  server.on("connection", socket => {
    if (asyncLocalStorage.getStore()?.test !== "net.Server") {
      console.error("FAIL: net.Server connection event lost context");
      failed = true;
    }
    socket.end();
  });

  server.on("listening", () => {
    if (asyncLocalStorage.getStore()?.test !== "net.Server") {
      console.error("FAIL: net.Server listening event lost context");
      failed = true;
    }

    // Connect to trigger connection event
    const client = net.connect(server.address().port);
    client.on("close", () => {
      // Give time for server connection event to fire
      setTimeout(() => {
        server.close(() => {
          process.exit(failed ? 1 : 0);
        });
      }, 50);
    });
  });

  server.listen(0);
});
