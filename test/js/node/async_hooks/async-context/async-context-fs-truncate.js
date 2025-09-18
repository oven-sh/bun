process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");
const path = require("path");

const asyncLocalStorage = new AsyncLocalStorage();
const testFile = path.join(fs.mkdtempSync("fstest"), "truncate-test-" + Date.now() + ".txt");

fs.writeFileSync(testFile, "test data for truncation");

asyncLocalStorage.run({ test: "fs.truncate" }, () => {
  fs.truncate(testFile, 5, err => {
    if (asyncLocalStorage.getStore()?.test !== "fs.truncate") {
      console.error("FAIL: fs.truncate callback lost context");
      try {
        fs.unlinkSync(testFile);
      } catch {}
      process.exit(1);
    }
    fs.unlinkSync(testFile);
    process.exit(0);
  });
});
