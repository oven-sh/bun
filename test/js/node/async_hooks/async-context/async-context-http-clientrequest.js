process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const http = require("http");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("ok");
});

server.listen(0, () => {
  const port = server.address().port;

  asyncLocalStorage.run({ test: "http.ClientRequest" }, () => {
    const req = http.request({
      port,
      method: "POST",
    });

    req.on("response", res => {
      if (asyncLocalStorage.getStore()?.test !== "http.ClientRequest") {
        console.error("FAIL: ClientRequest response event lost context");
        failed = true;
      }
      res.resume();
    });

    req.on("finish", () => {
      if (asyncLocalStorage.getStore()?.test !== "http.ClientRequest") {
        console.error("FAIL: ClientRequest finish event lost context");
        failed = true;
      }
    });

    req.on("close", () => {
      if (asyncLocalStorage.getStore()?.test !== "http.ClientRequest") {
        console.error("FAIL: ClientRequest close event lost context");
        failed = true;
      }
      server.close();
      process.exit(failed ? 1 : 0);
    });

    req.write("test data");
    req.end();
  });
});
