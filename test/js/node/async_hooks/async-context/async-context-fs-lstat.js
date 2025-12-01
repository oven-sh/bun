process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "fs.lstat" }, () => {
  fs.lstat(__filename, (err, stats) => {
    if (asyncLocalStorage.getStore()?.test !== "fs.lstat") {
      console.error("FAIL: fs.lstat callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
