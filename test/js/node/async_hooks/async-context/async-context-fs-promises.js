process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs").promises;
const path = require("path");

const asyncLocalStorage = new AsyncLocalStorage();
const testFile = path.join(require("fs").mkdtempSync("fstest"), "promises-test-" + Date.now() + ".txt");

asyncLocalStorage.run({ test: "fs.promises" }, async () => {
  try {
    await fs.writeFile(testFile, "test");
    if (asyncLocalStorage.getStore()?.test !== "fs.promises") {
      console.error("FAIL: fs.promises.writeFile lost context");
      process.exit(1);
    }

    await fs.readFile(testFile);
    if (asyncLocalStorage.getStore()?.test !== "fs.promises") {
      console.error("FAIL: fs.promises.readFile lost context");
      process.exit(1);
    }

    await fs.unlink(testFile);
    process.exit(0);
  } catch (err) {
    console.error("ERROR:", err);
    process.exit(1);
  }
});
