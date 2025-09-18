process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");
const path = require("path");

const asyncLocalStorage = new AsyncLocalStorage();
const testFile = path.join(fs.mkdtempSync("fstest"), "open-test-" + Date.now() + ".txt");

fs.writeFileSync(testFile, "test");

asyncLocalStorage.run({ test: "fs.open" }, () => {
  fs.open(testFile, "r", (err, fd) => {
    if (err) {
      console.error("ERROR:", err);
      process.exit(1);
    }

    if (asyncLocalStorage.getStore()?.test !== "fs.open") {
      console.error("FAIL: fs.open callback lost context");
      fs.closeSync(fd);
      fs.unlinkSync(testFile);
      process.exit(1);
    }

    // Test fs.close
    fs.close(fd, err => {
      if (asyncLocalStorage.getStore()?.test !== "fs.open") {
        console.error("FAIL: fs.close callback lost context");
        fs.unlinkSync(testFile);
        process.exit(1);
      }
      fs.unlinkSync(testFile);
      process.exit(0);
    });
  });
});
