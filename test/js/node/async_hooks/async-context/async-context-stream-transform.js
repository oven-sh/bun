process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const { Transform } = require("stream");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;

asyncLocalStorage.run({ test: "stream.Transform" }, () => {
  const transform = new Transform({
    transform(chunk, encoding, callback) {
      if (asyncLocalStorage.getStore()?.test !== "stream.Transform") {
        console.error("FAIL: Transform stream transform method lost context");
        failed = true;
      }
      callback(null, chunk);
    },
  });

  transform.on("data", chunk => {
    if (asyncLocalStorage.getStore()?.test !== "stream.Transform") {
      console.error("FAIL: Transform stream data event lost context");
      failed = true;
    }
  });

  transform.on("end", () => {
    if (asyncLocalStorage.getStore()?.test !== "stream.Transform") {
      console.error("FAIL: Transform stream end event lost context");
      failed = true;
    }
    process.exit(failed ? 1 : 0);
  });

  transform.write("test");
  transform.end();
});
