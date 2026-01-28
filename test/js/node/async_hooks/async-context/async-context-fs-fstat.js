process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");
const path = require("path");

const asyncLocalStorage = new AsyncLocalStorage();
const testFile = path.join(fs.mkdtempSync("fstest"), "fstat-test-" + Date.now() + ".txt");

fs.writeFileSync(testFile, "test");

asyncLocalStorage.run({ test: "fs.fstat" }, () => {
  fs.open(testFile, "r", (err, fd) => {
    if (err) {
      console.error("ERROR:", err);
      process.exit(1);
    }

    fs.fstat(fd, (err, stats) => {
      if (asyncLocalStorage.getStore()?.test !== "fs.fstat") {
        console.error("FAIL: fs.fstat callback lost context");
        fs.closeSync(fd);
        fs.unlinkSync(testFile);
        process.exit(1);
      }

      fs.closeSync(fd);
      fs.unlinkSync(testFile);
      process.exit(0);
    });
  });
});
