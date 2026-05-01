process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const zlib = require("zlib");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;

asyncLocalStorage.run({ test: "zlib.createGzip" }, () => {
  const gzip = zlib.createGzip();

  gzip.on("data", chunk => {
    if (asyncLocalStorage.getStore()?.test !== "zlib.createGzip") {
      console.error("FAIL: zlib.createGzip data event lost context");
      failed = true;
    }
  });

  gzip.on("end", () => {
    if (asyncLocalStorage.getStore()?.test !== "zlib.createGzip") {
      console.error("FAIL: zlib.createGzip end event lost context");
      failed = true;
    }
    process.exit(failed ? 1 : 0);
  });

  gzip.on("finish", () => {
    if (asyncLocalStorage.getStore()?.test !== "zlib.createGzip") {
      console.error("FAIL: zlib.createGzip finish event lost context");
      failed = true;
    }
  });

  gzip.write("test data");
  gzip.end();
});
