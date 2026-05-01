process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const { EventEmitter, on } = require("events");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "events.on" }, async () => {
  const emitter = new EventEmitter();

  // Start async iterator in background
  (async () => {
    try {
      for await (const [value] of on(emitter, "data")) {
        if (asyncLocalStorage.getStore()?.test !== "events.on") {
          console.error("FAIL: events.on async iterator lost context");
          process.exit(1);
        }
        if (value === "end") break;
      }
      process.exit(0);
    } catch (err) {
      console.error("ERROR:", err);
      process.exit(1);
    }
  })();

  // Emit events after a delay
  setTimeout(() => {
    emitter.emit("data", "test1");
    emitter.emit("data", "test2");
    emitter.emit("data", "end");
  }, 10);
});
