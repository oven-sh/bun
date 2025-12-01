process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const http = require("http");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;

const server = http.createServer((req, res) => {
  res.end("ok");
});

server.listen(0, () => {
  const port = server.address().port;

  asyncLocalStorage.run({ test: "http.request" }, () => {
    const req = http.request(
      {
        port,
        method: "GET",
      },
      res => {
        if (asyncLocalStorage.getStore()?.test !== "http.request") {
          console.error("FAIL: http.request response callback lost context");
          failed = true;
        }

        res.on("data", chunk => {
          if (asyncLocalStorage.getStore()?.test !== "http.request") {
            console.error("FAIL: http response data event lost context");
            failed = true;
          }
        });

        res.on("end", () => {
          if (asyncLocalStorage.getStore()?.test !== "http.request") {
            console.error("FAIL: http response end event lost context");
            failed = true;
          }
          server.close();
          process.exit(failed ? 1 : 0);
        });
      },
    );

    req.on("error", () => {
      server.close();
      process.exit(1);
    });

    req.end();
  });
});
