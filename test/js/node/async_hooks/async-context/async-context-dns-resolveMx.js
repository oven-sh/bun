process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const dns = require("dns");
const { startLocalDnsServer } = require("./local-dns-server");

const asyncLocalStorage = new AsyncLocalStorage();

startLocalDnsServer((server, address) => {
  dns.setServers([address]);

  asyncLocalStorage.run({ test: "dns.resolveMx" }, () => {
    dns.resolveMx("context.test", err => {
      server.close();
      if (err) {
        console.error("ERROR:", err);
        process.exit(1);
      }
      if (asyncLocalStorage.getStore()?.test !== "dns.resolveMx") {
        console.error("FAIL: dns.resolveMx callback lost context");
        process.exit(1);
      }
      process.exit(0);
    });
  });
});
