process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const { Writable } = require("stream");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;

asyncLocalStorage.run({ test: "stream.Writable" }, () => {
  const writable = new Writable({
    write(chunk, encoding, callback) {
      if (asyncLocalStorage.getStore()?.test !== "stream.Writable") {
        console.error("FAIL: Writable stream write method lost context");
        failed = true;
      }
      callback();
    },
  });

  writable.on("finish", () => {
    if (asyncLocalStorage.getStore()?.test !== "stream.Writable") {
      console.error("FAIL: Writable stream finish event lost context");
      failed = true;
    }
    process.exit(failed ? 1 : 0);
  });

  writable.write("test");
  writable.end();
});
