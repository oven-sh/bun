process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const dns = require("dns");
const { startLocalDnsServer } = require("./local-dns-server");

const asyncLocalStorage = new AsyncLocalStorage();

startLocalDnsServer((server, address) => {
  dns.setServers([address]);

  asyncLocalStorage.run({ test: "dns.reverse" }, () => {
    // 192.0.2.1 (TEST-NET-1) is never in /etc/hosts, so the PTR query reaches
    // the local server instead of being answered from the hosts file.
    dns.reverse("192.0.2.1", err => {
      server.close();
      if (err) {
        console.error("ERROR:", err);
        process.exit(1);
      }
      if (asyncLocalStorage.getStore()?.test !== "dns.reverse") {
        console.error("FAIL: dns.reverse callback lost context");
        process.exit(1);
      }
      process.exit(0);
    });
  });
});
