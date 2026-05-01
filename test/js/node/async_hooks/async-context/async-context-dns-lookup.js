process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const dns = require("dns");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "dns.lookup" }, () => {
  dns.lookup("localhost", (err, address, family) => {
    if (asyncLocalStorage.getStore()?.test !== "dns.lookup") {
      console.error("FAIL: dns.lookup callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
