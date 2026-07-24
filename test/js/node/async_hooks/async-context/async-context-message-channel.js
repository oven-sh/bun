process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");

const asyncLocalStorage = new AsyncLocalStorage();

// Message handlers observe the async context that was active when the
// MessageChannel was created, not the one active at addEventListener()
// or postMessage() time. Continuations registered inside the handler
// (await, queueMicrotask) keep it too.
const { port1, port2 } = asyncLocalStorage.run({ test: "MessageChannel" }, () => new MessageChannel());

port1.onmessage = async () => {
  const stores = [asyncLocalStorage.getStore()];
  await Promise.resolve();
  stores.push(asyncLocalStorage.getStore());
  await new Promise(resolve =>
    queueMicrotask(() => {
      stores.push(asyncLocalStorage.getStore());
      resolve();
    }),
  );
  port1.close();
  port2.close();
  if (!stores.every(store => store?.test === "MessageChannel")) {
    console.error("FAIL: MessagePort message handler lost context, got", stores);
    process.exit(1);
  }
  process.exit(0);
};

asyncLocalStorage.run({ test: "postMessage" }, () => {
  port2.postMessage("test");
});
