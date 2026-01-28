process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");
const path = require("path");

const asyncLocalStorage = new AsyncLocalStorage();
const testFile = path.join(fs.mkdtempSync("fstest"), "chmod-test-" + Date.now() + ".txt");

fs.writeFileSync(testFile, "test");

asyncLocalStorage.run({ test: "fs.chmod" }, () => {
  fs.chmod(testFile, 0o644, err => {
    if (asyncLocalStorage.getStore()?.test !== "fs.chmod") {
      console.error("FAIL: fs.chmod callback lost context");
      fs.unlinkSync(testFile);
      process.exit(1);
    }
    fs.unlinkSync(testFile);
    process.exit(0);
  });
});
