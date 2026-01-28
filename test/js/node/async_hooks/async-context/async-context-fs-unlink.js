process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");
const path = require("path");

const asyncLocalStorage = new AsyncLocalStorage();
const testFile = path.join(fs.mkdtempSync("unlink-test"), "unlink-test-" + Date.now() + ".txt");

fs.writeFileSync(testFile, "test");

asyncLocalStorage.run({ test: "fs.unlink" }, () => {
  fs.unlink(testFile, err => {
    if (asyncLocalStorage.getStore()?.test !== "fs.unlink") {
      console.error("FAIL: fs.unlink callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
