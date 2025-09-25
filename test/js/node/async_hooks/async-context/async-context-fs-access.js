process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "fs.access" }, () => {
  fs.access(__filename, fs.constants.R_OK, err => {
    if (asyncLocalStorage.getStore()?.test !== "fs.access") {
      console.error("FAIL: fs.access callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
