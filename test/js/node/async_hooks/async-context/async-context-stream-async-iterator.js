process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const { Readable } = require("stream");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "stream.async.iterator" }, async () => {
  const readable = new Readable({
    read() {
      this.push("a");
      this.push("b");
      this.push("c");
      this.push(null);
    },
  });

  try {
    for await (const chunk of readable) {
      if (asyncLocalStorage.getStore()?.test !== "stream.async.iterator") {
        console.error("FAIL: stream async iterator lost context");
        process.exit(1);
      }
    }
    process.exit(0);
  } catch (err) {
    console.error("ERROR:", err);
    process.exit(1);
  }
});
