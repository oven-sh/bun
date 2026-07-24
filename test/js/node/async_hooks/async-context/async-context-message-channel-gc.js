process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");

const asyncLocalStorage = new AsyncLocalStorage();

// The captured creation context must survive a full GC that runs after
// asyncLocalStorage.run() has returned but before either port has ever been
// read (at which point no MessagePort JS wrapper exists yet to root it).
function makeChannel() {
  return asyncLocalStorage.run({ test: "MessageChannel" }, () => new MessageChannel());
}
const channel = makeChannel();

if (typeof Bun !== "undefined") {
  Bun.gc(true);
  Bun.gc(true);
  Bun.gc(true);
}

channel.port1.onmessage = () => {
  const store = asyncLocalStorage.getStore();
  channel.port1.close();
  channel.port2.close();
  if (store?.test !== "MessageChannel") {
    console.error("FAIL: MessagePort message handler lost context after GC, got", store);
    process.exit(1);
  }
  process.exit(0);
};

channel.port2.postMessage("test");
