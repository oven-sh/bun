process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const { EventEmitter } = require("events");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;

asyncLocalStorage.run({ test: "EventEmitter" }, () => {
  const emitter = new EventEmitter();

  // Test regular event
  emitter.on("test", () => {
    if (asyncLocalStorage.getStore()?.test !== "EventEmitter") {
      console.error("FAIL: EventEmitter listener lost context");
      failed = true;
    }
  });

  // Test once event
  emitter.once("once-test", () => {
    if (asyncLocalStorage.getStore()?.test !== "EventEmitter") {
      console.error("FAIL: EventEmitter once listener lost context");
      failed = true;
    }
  });

  // Test async event handler
  emitter.on("async-test", async () => {
    await new Promise(resolve => setImmediate(resolve));
    if (asyncLocalStorage.getStore()?.test !== "EventEmitter") {
      console.error("FAIL: EventEmitter async listener lost context");
      failed = true;
    }
  });

  // Emit events
  emitter.emit("test");
  emitter.emit("once-test");
  emitter.emit("async-test");

  setTimeout(() => {
    process.exit(failed ? 1 : 0);
  }, 100);
});
