process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const net = require("net");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;
let sawConnection = false;

asyncLocalStorage.run({ test: "net.Server" }, () => {
  const server = net.createServer();

  server.on("connection", socket => {
    sawConnection = true;
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
    client.on("error", err => {
      console.error("ERROR:", err);
      process.exit(1);
    });
    client.on("close", () => {
      // The client only closes because the connection handler ended the
      // server side, so that handler has already run.
      if (!sawConnection) {
        console.error("ERROR: net.Server never emitted a connection event");
        failed = true;
      }
      server.close(() => {
        process.exit(failed ? 1 : 0);
      });
    });
  });

  server.listen(0);
});
