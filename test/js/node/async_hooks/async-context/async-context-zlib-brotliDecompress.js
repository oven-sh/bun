process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const zlib = require("zlib");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "zlib.brotliDecompress" }, () => {
  // First compress data
  const compressed = zlib.brotliCompressSync("test data");

  zlib.brotliDecompress(compressed, (err, decompressed) => {
    if (asyncLocalStorage.getStore()?.test !== "zlib.brotliDecompress") {
      console.error("FAIL: zlib.brotliDecompress callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
