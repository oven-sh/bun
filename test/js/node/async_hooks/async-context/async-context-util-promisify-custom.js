process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const util = require("util");

const asyncLocalStorage = new AsyncLocalStorage();

// Custom callback function
function customAsync(value, callback) {
  setTimeout(() => {
    callback(null, value * 2);
  }, 10);
}

const customPromise = util.promisify(customAsync);

asyncLocalStorage.run({ test: "util.promisify.custom" }, async () => {
  try {
    const result = await customPromise(21);
    if (asyncLocalStorage.getStore()?.test !== "util.promisify.custom") {
      console.error("FAIL: util.promisify with custom function lost context");
      process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    console.error("ERROR:", err);
    process.exit(1);
  }
});
