process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");
const https = require("https");
const path = require("path");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;

const fixtures = path.join(__dirname, "..", "..", "http", "fixtures");
const cert = fs.readFileSync(path.join(fixtures, "cert.pem"));
const key = fs.readFileSync(path.join(fixtures, "cert.key"));

const server = https.createServer({ key, cert }, (req, res) => {
  res.end("ok");
});

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;

  asyncLocalStorage.run({ test: "https.request" }, () => {
    const req = https.request({ host: "127.0.0.1", port, ca: cert }, res => {
      if (asyncLocalStorage.getStore()?.test !== "https.request") {
        console.error("FAIL: https.request response callback lost context");
        failed = true;
      }

      res.on("data", () => {
        if (asyncLocalStorage.getStore()?.test !== "https.request") {
          console.error("FAIL: https response data event lost context");
          failed = true;
        }
      });

      res.on("end", () => {
        if (asyncLocalStorage.getStore()?.test !== "https.request") {
          console.error("FAIL: https response end event lost context");
          failed = true;
        }
        server.close();
        process.exit(failed ? 1 : 0);
      });
    });

    req.on("error", err => {
      console.error("ERROR:", err);
      server.close();
      process.exit(1);
    });

    req.end();
  });
});
