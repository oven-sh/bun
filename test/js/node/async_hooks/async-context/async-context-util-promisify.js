process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const util = require("util");
const fs = require("fs");

const asyncLocalStorage = new AsyncLocalStorage();

// Test util.promisify with a built-in callback function
const readFilePromise = util.promisify(fs.readFile);

asyncLocalStorage.run({ test: "util.promisify" }, async () => {
  try {
    await readFilePromise(__filename, "utf8");
    if (asyncLocalStorage.getStore()?.test !== "util.promisify") {
      console.error("FAIL: util.promisify lost context");
      process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    console.error("ERROR:", err);
    process.exit(1);
  }
});
