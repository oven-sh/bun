process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");
const path = require("path");

const asyncLocalStorage = new AsyncLocalStorage();
const dir = fs.mkdtempSync("mkdir-test-");
const testDir = path.join(dir, "mkdir-test-" + Date.now());

asyncLocalStorage.run({ test: "fs.mkdir" }, () => {
  fs.mkdir(testDir, err => {
    if (asyncLocalStorage.getStore()?.test !== "fs.mkdir") {
      console.error("FAIL: fs.mkdir callback lost context");
      try {
        fs.rmdirSync(testDir);
      } catch {}
      process.exit(1);
    }
    fs.rmdirSync(testDir);
    fs.rmdirSync(dir);
    process.exit(0);
  });
});
