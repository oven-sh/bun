const { AsyncLocalStorage } = require("async_hooks");
const dns = require("dns");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "dns.resolveTxt" }, () => {
  dns.resolveTxt("google.com", (err, records) => {
    if (asyncLocalStorage.getStore()?.test !== "dns.resolveTxt") {
      console.error("FAIL: dns.resolveTxt callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
