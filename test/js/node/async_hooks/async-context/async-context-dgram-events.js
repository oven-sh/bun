process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const dgram = require("dgram");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;

asyncLocalStorage.run({ test: "dgram.events" }, () => {
  const server = dgram.createSocket("udp4");
  const client = dgram.createSocket("udp4");

  server.on("message", (msg, rinfo) => {
    if (asyncLocalStorage.getStore()?.test !== "dgram.events") {
      console.error("FAIL: dgram message event lost context");
      failed = true;
    }
    server.close();
    client.close();
  });

  server.on("listening", () => {
    if (asyncLocalStorage.getStore()?.test !== "dgram.events") {
      console.error("FAIL: dgram listening event lost context");
      failed = true;
    }

    const port = server.address().port;
    client.send("test", port, "localhost");
  });

  server.on("close", () => {
    if (asyncLocalStorage.getStore()?.test !== "dgram.events") {
      console.error("FAIL: dgram close event lost context");
      failed = true;
    }
    process.exit(failed ? 1 : 0);
  });

  server.bind(0);
});
