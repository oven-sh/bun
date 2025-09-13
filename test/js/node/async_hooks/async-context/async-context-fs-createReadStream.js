process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");
const path = require("path");

const asyncLocalStorage = new AsyncLocalStorage();
const testFile = path.join(fs.mkdtempSync("fstest"), "readstream-test-" + Date.now() + ".txt");
let failed = false;

// Create test file
fs.writeFileSync(testFile, "test data for read stream");

asyncLocalStorage.run({ test: "fs.createReadStream" }, () => {
  const stream = fs.createReadStream(testFile);

  stream.on("data", chunk => {
    if (asyncLocalStorage.getStore()?.test !== "fs.createReadStream") {
      console.error("FAIL: fs.createReadStream data event lost context");
      failed = true;
    }
  });

  stream.on("end", () => {
    if (asyncLocalStorage.getStore()?.test !== "fs.createReadStream") {
      console.error("FAIL: fs.createReadStream end event lost context");
      failed = true;
    }
  });

  stream.on("close", () => {
    if (asyncLocalStorage.getStore()?.test !== "fs.createReadStream") {
      console.error("FAIL: fs.createReadStream close event lost context");
      failed = true;
    }
    fs.unlinkSync(testFile);
    process.exit(failed ? 1 : 0);
  });
});
