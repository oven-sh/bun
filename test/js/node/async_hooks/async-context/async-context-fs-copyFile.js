process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");
const path = require("path");

const asyncLocalStorage = new AsyncLocalStorage();
const dir = fs.mkdtempSync("copy-test-");
const srcFile = path.join(dir, "copy-src-" + Date.now() + ".txt");
const destFile = path.join(dir, "copy-dest-" + Date.now() + ".txt");

fs.writeFileSync(srcFile, "test data");

asyncLocalStorage.run({ test: "fs.copyFile" }, () => {
  fs.copyFile(srcFile, destFile, err => {
    if (asyncLocalStorage.getStore()?.test !== "fs.copyFile") {
      console.error("FAIL: fs.copyFile callback lost context");
      try {
        fs.unlinkSync(srcFile);
        fs.unlinkSync(destFile);
      } catch {}
      process.exit(1);
    }
    fs.unlinkSync(srcFile);
    fs.unlinkSync(destFile);
    fs.rmdirSync(dir);
    process.exit(0);
  });
});
