process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const dns = require("dns");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "dns.resolve4" }, () => {
  dns.resolve4("localhost", (err, addresses) => {
    if (asyncLocalStorage.getStore()?.test !== "dns.resolve4") {
      console.error("FAIL: dns.resolve4 callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
