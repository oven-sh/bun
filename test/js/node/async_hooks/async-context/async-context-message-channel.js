process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");

const asyncLocalStorage = new AsyncLocalStorage();

// Message handlers observe the async context that was active when the
// MessageChannel was created, not the one active at addEventListener()
// or postMessage() time.
const { port1, port2 } = asyncLocalStorage.run({ test: "MessageChannel" }, () => new MessageChannel());

port1.onmessage = () => {
  const store = asyncLocalStorage.getStore();
  port1.close();
  port2.close();
  if (store?.test !== "MessageChannel") {
    console.error("FAIL: MessagePort message handler lost context, got", store);
    process.exit(1);
  }
  process.exit(0);
};

asyncLocalStorage.run({ test: "postMessage" }, () => {
  port2.postMessage("test");
});
