process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const zlib = require("zlib");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "zlib.deflate" }, () => {
  zlib.deflate("test data", (err, compressed) => {
    if (asyncLocalStorage.getStore()?.test !== "zlib.deflate") {
      console.error("FAIL: zlib.deflate callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
