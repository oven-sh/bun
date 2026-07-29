process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");

const asyncLocalStorage = new AsyncLocalStorage();

// Message handlers observe the async context that was active when the
// receiving BroadcastChannel was created, not the one active at
// addEventListener() or postMessage() time.
const receiver = asyncLocalStorage.run(
  { test: "BroadcastChannel" },
  () => new BroadcastChannel("async-context-broadcast-channel"),
);
const sender = new BroadcastChannel("async-context-broadcast-channel");

receiver.onmessage = () => {
  const store = asyncLocalStorage.getStore();
  receiver.close();
  sender.close();
  if (store?.test !== "BroadcastChannel") {
    console.error("FAIL: BroadcastChannel message handler lost context, got", store);
    process.exit(1);
  }
  process.exit(0);
};

asyncLocalStorage.run({ test: "postMessage" }, () => {
  sender.postMessage("test");
});
