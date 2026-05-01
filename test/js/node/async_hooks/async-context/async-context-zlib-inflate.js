process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const zlib = require("zlib");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "zlib.inflate" }, () => {
  // First compress data
  const compressed = zlib.deflateSync("test data");

  zlib.inflate(compressed, (err, decompressed) => {
    if (asyncLocalStorage.getStore()?.test !== "zlib.inflate") {
      console.error("FAIL: zlib.inflate callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
