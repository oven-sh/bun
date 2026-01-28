process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const zlib = require("zlib");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "zlib.gzip" }, () => {
  zlib.gzip("test data", (err, compressed) => {
    if (asyncLocalStorage.getStore()?.test !== "zlib.gzip") {
      console.error("FAIL: zlib.gzip callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
