process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");
const path = require("path");

const asyncLocalStorage = new AsyncLocalStorage();
const testFile = path.join(fs.mkdtempSync("fstest"), "read-test-" + Date.now() + ".txt");

fs.writeFileSync(testFile, "test data for read");

asyncLocalStorage.run({ test: "fs.read" }, () => {
  fs.open(testFile, "r", (err, fd) => {
    if (err) {
      console.error("ERROR:", err);
      process.exit(1);
    }

    const buffer = Buffer.alloc(10);
    fs.read(fd, buffer, 0, 10, 0, (err, bytesRead, buffer) => {
      if (asyncLocalStorage.getStore()?.test !== "fs.read") {
        console.error("FAIL: fs.read callback lost context");
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
