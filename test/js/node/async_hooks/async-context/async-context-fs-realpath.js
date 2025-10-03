process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "fs.realpath" }, () => {
  fs.realpath("/tmp", (err, resolvedPath) => {
    if (asyncLocalStorage.getStore()?.test !== "fs.realpath") {
      console.error("FAIL: fs.realpath callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
