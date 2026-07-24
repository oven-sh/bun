process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");

const asyncLocalStorage = new AsyncLocalStorage();

// A MessagePort's deferred 'close' event observes the async context that was
// active when the port was created, same as its 'message' handlers, not the
// context active at close() time.
const { port1 } = asyncLocalStorage.run({ test: "MessageChannel" }, () => new MessageChannel());

port1.addEventListener("close", () => {
  const store = asyncLocalStorage.getStore();
  if (store?.test !== "MessageChannel") {
    console.error("FAIL: MessagePort close handler lost context, got", store);
    process.exit(1);
  }
  process.exit(0);
});

asyncLocalStorage.run({ test: "close" }, () => {
  port1.close();
});
