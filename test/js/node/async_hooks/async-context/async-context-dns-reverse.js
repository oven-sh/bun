process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const dns = require("dns");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "dns.reverse" }, () => {
  dns.reverse("8.8.8.8", (err, hostnames) => {
    if (asyncLocalStorage.getStore()?.test !== "dns.reverse") {
      console.error("FAIL: dns.reverse callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
