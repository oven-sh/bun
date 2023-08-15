import { expect, test } from "bun:test";
import * as dns from "node:dns";
import * as dns_promises from "node:dns/promises";
import * as fs from "node:fs";
import * as os from "node:os";

// TODO:
test("it exists", () => {
  expect(dns).toBeDefined();
  expect(dns.lookup).toBeDefined();
  expect(dns.lookupService).toBeDefined();
  expect(dns.resolve).toBeDefined();
  expect(dns.resolve4).toBeDefined();
  expect(dns.resolve6).toBeDefined();
  expect(dns.resolveSrv).toBeDefined();
  expect(dns.resolveTxt).toBeDefined();
  expect(dns.resolveSoa).toBeDefined();
  expect(dns.resolveNaptr).toBeDefined();
  expect(dns.resolveMx).toBeDefined();
  expect(dns.resolveCaa).toBeDefined();
  expect(dns.resolveNs).toBeDefined();
  expect(dns.resolvePtr).toBeDefined();
  expect(dns.resolveCname).toBeDefined();

  expect(dns.promises).toBeDefined();
  expect(dns.promises.lookup).toBeDefined();
  expect(dns.promises.lookupService).toBeDefined();
  expect(dns.promises.resolve).toBeDefined();
  expect(dns.promises.resolve4).toBeDefined();
  expect(dns.promises.resolve6).toBeDefined();
  expect(dns.promises.resolveSrv).toBeDefined();
  expect(dns.promises.resolveTxt).toBeDefined();
  expect(dns.promises.resolveSoa).toBeDefined();
  expect(dns.promises.resolveNaptr).toBeDefined();
  expect(dns.promises.resolveMx).toBeDefined();
  expect(dns.promises.resolveCaa).toBeDefined();
  expect(dns.promises.resolveNs).toBeDefined();
  expect(dns.promises.resolvePtr).toBeDefined();
  expect(dns.promises.resolveCname).toBeDefined();

  expect(dns_promises).toBeDefined();
  expect(dns_promises.lookup).toBeDefined();
  expect(dns_promises.lookupService).toBeDefined();
  expect(dns_promises.resolve).toBeDefined();
  expect(dns_promises.resolve4).toBeDefined();
  expect(dns_promises.resolve6).toBeDefined();
  expect(dns_promises.resolveSrv).toBeDefined();
  expect(dns_promises.resolveTxt).toBeDefined();
  expect(dns_promises.resolveSoa).toBeDefined();
  expect(dns_promises.resolveNaptr).toBeDefined();
  expect(dns_promises.resolveMx).toBeDefined();
  expect(dns_promises.resolveCaa).toBeDefined();
  expect(dns_promises.resolveNs).toBeDefined();
  expect(dns_promises.resolvePtr).toBeDefined();
  expect(dns_promises.resolveCname).toBeDefined();
});

// //TODO: use a bun.sh SRV for testing
test("dns.resolveSrv (_test._tcp.test.socketify.dev)", done => {
  dns.resolveSrv("_test._tcp.test.socketify.dev", (err, results) => {
    expect(err).toBeNull();
    expect(results instanceof Array).toBe(true);
    expect(results[0].name).toBe("_dc-srv.130c90ab9de1._test._tcp.test.socketify.dev");
    expect(results[0].priority).toBe(50);
    expect(results[0].weight).toBe(50);
    expect(results[0].port).toBe(80);
    done(err);
  });
});

test("dns.resolveSrv (_test._tcp.invalid.localhost)", done => {
  dns.resolveSrv("_test._tcp.invalid.localhost", (err, results) => {
    expect(err).toBeTruthy();
    expect(results).toBeUndefined(true);
    done();
  });
});

test("dns.resolveTxt (txt.socketify.dev)", done => {
  dns.resolveTxt("txt.socketify.dev", (err, results) => {
    expect(err).toBeNull();
    expect(results instanceof Array).toBe(true);
    expect(results[0][0]).toBe("bun_test;test");
    done(err);
  });
});

test("dns.resolveSoa (bun.sh)", done => {
  dns.resolveSoa("bun.sh", (err, result) => {
    expect(err).toBeNull();
    expect(typeof result.serial).toBe("number");
    expect(result.refresh).toBe(10000);
    expect(result.retry).toBe(2400);
    expect(result.expire).toBe(604800);

    // Cloudflare might randomly change min TTL
    expect(result.minttl).toBeNumber();

    expect(result.nsname).toBe("hans.ns.cloudflare.com");
    expect(result.hostmaster).toBe("dns.cloudflare.com");
    done(err);
  });
});

test("dns.resolveNaptr (naptr.socketify.dev)", done => {
  dns.resolveNaptr("naptr.socketify.dev", (err, results) => {
    expect(err).toBeNull();
    expect(results instanceof Array).toBe(true);
    expect(results[0].flags).toBe("S");
    expect(results[0].service).toBe("test");
    expect(results[0].regexp).toBe("");
    expect(results[0].replacement).toBe("");
    expect(results[0].order).toBe(1);
    expect(results[0].preference).toBe(12);
    done(err);
  });
});

test("dns.resolveCaa (caa.socketify.dev)", done => {
  dns.resolveCaa("caa.socketify.dev", (err, results) => {
    expect(err).toBeNull();
    expect(results instanceof Array).toBe(true);
    expect(results[0].critical).toBe(0);
    expect(results[0].issue).toBe("bun.sh");
    done(err);
  });
});

test("dns.resolveMx (bun.sh)", done => {
  dns.resolveMx("bun.sh", (err, results) => {
    expect(err).toBeNull();
    expect(results instanceof Array).toBe(true);
    const priority = results[0].priority;
    expect(priority >= 0 && priority < 65535).toBe(true);
    expect(results[0].exchange.includes(".registrar-servers.com")).toBe(true);
    done(err);
  });
});

test("dns.resolveNs (bun.sh) ", done => {
  dns.resolveNs("bun.sh", (err, results) => {
    expect(err).toBeNull();
    expect(results instanceof Array).toBe(true);
    expect(results[0].includes(".ns.cloudflare.com")).toBe(true);
    done(err);
  });
});

test("dns.resolvePtr (ptr.socketify.dev)", done => {
  dns.resolvePtr("ptr.socketify.dev", (err, results) => {
    expect(err).toBeNull();
    expect(results instanceof Array).toBe(true);
    expect(results[0]).toBe("bun.sh");
    done(err);
  });
});

test("dns.resolveCname (cname.socketify.dev)", done => {
  dns.resolveCname("cname.socketify.dev", (err, results) => {
    expect(err).toBeNull();
    expect(results instanceof Array).toBe(true);
    expect(results[0]).toBe("bun.sh");
    done(err);
  });
});

test("dns.lookup (example.com)", done => {
  dns.lookup("example.com", (err, address, family) => {
    expect(err).toBeNull();
    expect(typeof address).toBe("string");
    done(err);
  });
});

test("dns.lookup (example.com) with { all: true } #2675", done => {
  dns.lookup("example.com", { all: true }, (err, address, family) => {
    expect(err).toBeNull();
    expect(Array.isArray(address)).toBe(true);
    done(err);
  });
});

test("dns.lookup (localhost)", done => {
  dns.lookup("localhost", (err, address, family) => {
    expect(err).toBeNull();
    if (family === 6) {
      expect(address).toBe("::1");
    } else {
      expect(address).toBe("127.0.0.1");
    }

    done(err);
  });
});

test("dns.getServers", done => {
  function parseResolvConf() {
    let servers = [];
    try {
      const content = fs.readFileSync("/etc/resolv.conf", "utf-8");
      const lines = content.split(os.EOL);

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2 && parts[0] === "nameserver") {
          servers.push(parts[1]);
        }
      }
    } catch (err) {
      done(err);
    }
    return servers;
  }

  const expectServers = parseResolvConf();
  const actualServers = dns.getServers();
  try {
    for (const server of expectServers) {
      expect(actualServers).toContain(server);
    }
  } catch (err) {
    return done(err);
  }
  done();
});
