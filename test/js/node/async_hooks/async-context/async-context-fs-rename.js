process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");
const path = require("path");

const asyncLocalStorage = new AsyncLocalStorage();
const dir = fs.mkdtempSync("rename-test-");
const oldPath = path.join(dir, "rename-old-" + Date.now() + ".txt");
const newPath = path.join(dir, "rename-new-" + Date.now() + ".txt");

fs.writeFileSync(oldPath, "test");

asyncLocalStorage.run({ test: "fs.rename" }, () => {
  fs.rename(oldPath, newPath, err => {
    if (asyncLocalStorage.getStore()?.test !== "fs.rename") {
      console.error("FAIL: fs.rename callback lost context");
      try {
        fs.unlinkSync(oldPath);
      } catch {}
      try {
        fs.unlinkSync(newPath);
      } catch {}
      process.exit(1);
    }
    fs.unlinkSync(newPath);
    fs.rmdirSync(dir);
    process.exit(0);
  });
});
