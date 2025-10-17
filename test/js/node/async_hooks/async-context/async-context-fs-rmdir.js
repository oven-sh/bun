process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");
const path = require("path");

const asyncLocalStorage = new AsyncLocalStorage();
const dir = fs.mkdtempSync("rmdir-test-");
const testDir = path.join(dir, "rmdir-test-" + Date.now());

fs.mkdirSync(testDir);

asyncLocalStorage.run({ test: "fs.rmdir" }, () => {
  fs.rmdir(testDir, err => {
    if (asyncLocalStorage.getStore()?.test !== "fs.rmdir") {
      console.error("FAIL: fs.rmdir callback lost context");
      process.exit(1);
    }
    fs.rmdirSync(dir);
    process.exit(0);
  });
});
