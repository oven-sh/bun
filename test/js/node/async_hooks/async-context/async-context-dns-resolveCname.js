process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const dns = require("dns");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "dns.resolveCname" }, () => {
  dns.resolveCname("www.example.com", (err, addresses) => {
    if (asyncLocalStorage.getStore()?.test !== "dns.resolveCname") {
      console.error("FAIL: dns.resolveCname callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
