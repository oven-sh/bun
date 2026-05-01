process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "fs.stat" }, () => {
  fs.stat(__filename, (err, stats) => {
    if (asyncLocalStorage.getStore()?.test !== "fs.stat") {
      console.error("FAIL: fs.stat callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
