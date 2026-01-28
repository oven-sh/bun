process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");
const path = require("path");

const asyncLocalStorage = new AsyncLocalStorage();
const testFile = path.join(fs.mkdtempSync("fstest"), "writestream-test-" + Date.now() + ".txt");
let failed = false;

asyncLocalStorage.run({ test: "fs.createWriteStream" }, () => {
  const stream = fs.createWriteStream(testFile);

  stream.on("finish", () => {
    if (asyncLocalStorage.getStore()?.test !== "fs.createWriteStream") {
      console.error("FAIL: fs.createWriteStream finish event lost context");
      failed = true;
    }
  });

  stream.on("close", () => {
    if (asyncLocalStorage.getStore()?.test !== "fs.createWriteStream") {
      console.error("FAIL: fs.createWriteStream close event lost context");
      failed = true;
    }
    fs.unlinkSync(testFile);
    process.exit(failed ? 1 : 0);
  });

  stream.write("test data");
  stream.end();
});
