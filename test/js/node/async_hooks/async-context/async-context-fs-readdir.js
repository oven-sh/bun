process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "fs.readdir" }, () => {
  fs.readdir("/tmp", (err, files) => {
    if (asyncLocalStorage.getStore()?.test !== "fs.readdir") {
      console.error("FAIL: fs.readdir callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
