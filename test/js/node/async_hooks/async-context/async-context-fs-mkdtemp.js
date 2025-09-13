process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");
const path = require("path");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "fs.mkdtemp" }, () => {
  const dir = fs.mkdtempSync("test-");
  fs.mkdtemp(path.join(dir, "test-"), (err, directory) => {
    if (asyncLocalStorage.getStore()?.test !== "fs.mkdtemp") {
      console.error("FAIL: fs.mkdtemp callback lost context");
      try {
        fs.rmdirSync(directory);
      } catch {}
      process.exit(1);
    }
    fs.rmdirSync(directory);
    process.exit(0);
  });
});
