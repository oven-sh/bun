process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");
const path = require("path");
if (process.execPath.endsWith("bun-asan")) process.exit(0); // TODO: BUN

const asyncLocalStorage = new AsyncLocalStorage();
const testFile = path.join(fs.mkdtempSync("watch-test"), "watch-test-" + Date.now() + ".txt");

asyncLocalStorage.run({ test: "fs.watch" }, () => {
  fs.writeFileSync(testFile, "initial");

  const watcher = fs.watch(testFile, (eventType, filename) => {
    if (asyncLocalStorage.getStore()?.test !== "fs.watch") {
      console.error("FAIL: fs.watch callback lost context");
      watcher.close();
      try {
        fs.unlinkSync(testFile);
      } catch {}
      process.exit(1);
    }
    watcher.close();
    try {
      fs.unlinkSync(testFile);
    } catch {}
    process.exit(0);
  });

  // Some backends (FSEvents) start delivering events a little after watch()
  // returns, so a single write could be missed. Keep modifying the file until
  // the listener fires (it exits the process).
  let content = "initial";
  setInterval(() => fs.writeFileSync(testFile, (content += "+")), 20);
});
