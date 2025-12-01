process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");
const path = require("path");

const asyncLocalStorage = new AsyncLocalStorage();
const testFile = path.join(fs.mkdtempSync("fstest"), "appendfile-test-" + Date.now() + ".txt");

asyncLocalStorage.run({ test: "fs.appendFile" }, () => {
  fs.appendFile(testFile, "test data", err => {
    if (asyncLocalStorage.getStore()?.test !== "fs.appendFile") {
      console.error("FAIL: fs.appendFile callback lost context");
      try {
        fs.unlinkSync(testFile);
      } catch {}
      process.exit(1);
    }
    fs.unlinkSync(testFile);
    process.exit(0);
  });
});
