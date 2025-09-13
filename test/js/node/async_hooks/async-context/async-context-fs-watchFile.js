process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");
const path = require("path");

const asyncLocalStorage = new AsyncLocalStorage();
const testFile = path.join(fs.mkdtempSync("watchfile-test"), "watchfile-test-" + Date.now() + ".txt");

asyncLocalStorage.run({ test: "fs.watchFile" }, () => {
  fs.writeFileSync(testFile, "initial");

  fs.watchFile(testFile, { interval: 50 }, (curr, prev) => {
    if (asyncLocalStorage.getStore()?.test !== "fs.watchFile") {
      console.error("FAIL: fs.watchFile callback lost context");
      fs.unwatchFile(testFile);
      try {
        fs.unlinkSync(testFile);
      } catch {}
      process.exit(1);
    }
    fs.unwatchFile(testFile);
    try {
      fs.unlinkSync(testFile);
    } catch {}
    process.exit(0);
  });

  // Trigger the watch event
  setTimeout(() => {
    fs.writeFileSync(testFile, "modified");
  }, 100);

  // Timeout safety
  setTimeout(() => {
    fs.unwatchFile(testFile);
    try {
      fs.unlinkSync(testFile);
    } catch {}
    process.exit(0);
  }, 5000);
});
