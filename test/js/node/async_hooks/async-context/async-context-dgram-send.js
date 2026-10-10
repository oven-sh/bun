process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const dgram = require("dgram");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "dgram.send" }, () => {
  const server = dgram.createSocket("udp4");
  const client = dgram.createSocket("udp4");

  // Exit once the send callback has run and the datagram has arrived, in
  // whichever order that happens.
  let pending = 2;
  function done() {
    if (--pending === 0) {
      server.close();
      client.close();
      process.exit(0);
    }
  }

  server.on("message", done);

  server.bind(0, () => {
    const port = server.address().port;
    client.send("test", port, "localhost", err => {
      if (err) {
        console.error("ERROR:", err);
        process.exit(1);
      }
      if (asyncLocalStorage.getStore()?.test !== "dgram.send") {
        console.error("FAIL: dgram.send callback lost context");
        process.exit(1);
      }
      done();
    });
  });
});
