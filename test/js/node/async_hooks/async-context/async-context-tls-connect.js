process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");
const path = require("path");
const tls = require("tls");

const asyncLocalStorage = new AsyncLocalStorage();

const fixtures = path.join(__dirname, "..", "..", "http", "fixtures");
const cert = fs.readFileSync(path.join(fixtures, "cert.pem"));
const key = fs.readFileSync(path.join(fixtures, "cert.key"));

const server = tls.createServer({ key, cert });

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;

  asyncLocalStorage.run({ test: "tls.connect" }, () => {
    const socket = tls.connect({ host: "127.0.0.1", port, ca: cert }, () => {
      socket.destroy();
      server.close();
      if (asyncLocalStorage.getStore()?.test !== "tls.connect") {
        console.error("FAIL: tls.connect callback lost context");
        process.exit(1);
      }
      process.exit(0);
    });

    socket.on("error", err => {
      console.error("ERROR:", err);
      process.exit(1);
    });
  });
});
