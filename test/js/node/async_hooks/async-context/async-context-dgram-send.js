process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const dgram = require("dgram");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "dgram.send" }, () => {
  const server = dgram.createSocket("udp4");
  const client = dgram.createSocket("udp4");

  server.on("message", () => {
    server.close();
    client.close();
  });

  server.bind(0, () => {
    const port = server.address().port;
    client.send("test", port, "localhost", err => {
      if (asyncLocalStorage.getStore()?.test !== "dgram.send") {
        console.error("FAIL: dgram.send callback lost context");
        process.exit(1);
      }
      setTimeout(() => process.exit(0), 100);
    });
  });
});
