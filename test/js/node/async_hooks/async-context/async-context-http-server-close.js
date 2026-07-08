process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const http = require("http");

const asyncLocalStorage = new AsyncLocalStorage();
const order = [];
let failed = false;

const server = http.createServer((req, res) => res.end("ok"));

asyncLocalStorage.run({ test: "register" }, () => {
  server.on("close", () => {
    order.push("listener");
    if (asyncLocalStorage.getStore()?.test !== "close") {
      console.error("FAIL: http.Server 'close' event lost context:", asyncLocalStorage.getStore());
      failed = true;
    }
  });
});

asyncLocalStorage.run({ test: "listen" }, () => {
  server.listen(0, "127.0.0.1", () => {
    http.get({ port: server.address().port, host: "127.0.0.1", headers: { connection: "close" } }, res => {
      res.resume();
      res.on("end", () => {
        asyncLocalStorage.run({ test: "close" }, () => {
          server.close(() => {
            order.push("cb");
            if (asyncLocalStorage.getStore()?.test !== "close") {
              console.error("FAIL: http.Server close(cb) lost context:", asyncLocalStorage.getStore());
              failed = true;
            }
            // In Node.js the close callback is registered via once('close'),
            // so the earlier-registered 'close' listener runs first.
            if (order.join(",") !== "listener,cb") {
              console.error("FAIL: http.Server close ordering:", order.join(","));
              failed = true;
            }
            process.exit(failed ? 1 : 0);
          });
        });
      });
    });
  });
});
