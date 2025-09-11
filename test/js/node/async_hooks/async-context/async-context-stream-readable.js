process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const { Readable } = require("stream");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;

asyncLocalStorage.run({ test: "stream.Readable" }, () => {
  const readable = new Readable({
    read() {
      this.push("test");
      this.push(null);
    },
  });

  readable.on("data", chunk => {
    if (asyncLocalStorage.getStore()?.test !== "stream.Readable") {
      console.error("FAIL: Readable stream data event lost context");
      failed = true;
    }
  });

  readable.on("end", () => {
    if (asyncLocalStorage.getStore()?.test !== "stream.Readable") {
      console.error("FAIL: Readable stream end event lost context");
      failed = true;
    }
    process.exit(failed ? 1 : 0);
  });

  readable.on("close", () => {
    if (asyncLocalStorage.getStore()?.test !== "stream.Readable") {
      console.error("FAIL: Readable stream close event lost context");
      failed = true;
    }
  });
});
