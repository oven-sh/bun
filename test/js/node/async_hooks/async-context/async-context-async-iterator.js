process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");

const asyncLocalStorage = new AsyncLocalStorage();

// Create an async generator
async function* asyncGenerator() {
  yield 1;
  yield 2;
  yield 3;
}

asyncLocalStorage.run({ test: "async.iterator" }, async () => {
  try {
    for await (const value of asyncGenerator()) {
      if (asyncLocalStorage.getStore()?.test !== "async.iterator") {
        console.error("FAIL: async iterator lost context at value", value);
        process.exit(1);
      }
    }
    process.exit(0);
  } catch (err) {
    console.error("ERROR:", err);
    process.exit(1);
  }
});
