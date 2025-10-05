process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const https = require("https");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "https.request" }, () => {
  const req = https.request("https://httpbin.org/get", res => {
    if (asyncLocalStorage.getStore()?.test !== "https.request") {
      console.error("FAIL: https.request response callback lost context");
      process.exit(1);
    }

    res.on("data", () => {});
    res.on("end", () => {
      process.exit(0);
    });
  });

  req.on("error", () => {
    // Skip test if network is unavailable
    process.exit(0);
  });

  req.end();
});
