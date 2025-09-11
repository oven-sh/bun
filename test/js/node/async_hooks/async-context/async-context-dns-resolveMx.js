process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const dns = require("dns");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "dns.resolveMx" }, () => {
  dns.resolveMx("example.com", (err, addresses) => {
    if (asyncLocalStorage.getStore()?.test !== "dns.resolveMx") {
      console.error("FAIL: dns.resolveMx callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
