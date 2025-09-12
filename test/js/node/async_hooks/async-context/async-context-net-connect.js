process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const net = require("net");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;

const server = net.createServer();
server.listen(0, () => {
  const port = server.address().port;

  asyncLocalStorage.run({ test: "net.connect" }, () => {
    const client = net.connect(port, () => {
      if (asyncLocalStorage.getStore()?.test !== "net.connect") {
        console.error("FAIL: net.connect callback lost context");
        failed = true;
      }
      client.end();
    });

    client.on("close", () => {
      if (asyncLocalStorage.getStore()?.test !== "net.connect") {
        console.error("FAIL: net socket close event lost context");
        failed = true;
      }
      server.close(() => {
        process.exit(failed ? 1 : 0);
      });
    });
  });
});
