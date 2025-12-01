process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const zlib = require("zlib");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "zlib.gunzip" }, () => {
  // First compress data
  const compressed = zlib.gzipSync("test data");

  zlib.gunzip(compressed, (err, decompressed) => {
    if (asyncLocalStorage.getStore()?.test !== "zlib.gunzip") {
      console.error("FAIL: zlib.gunzip callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
