import { beforeAll, describe, expect, it, setDefaultTimeout, test } from "bun:test";
import { isWindows } from "harness";
import * as dns from "node:dns";
import * as dns_promises from "node:dns/promises";
import * as fs from "node:fs";
import * as os from "node:os";
import * as util from "node:util";

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
});

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
test("dns.resolveSrv (_test._tcp.test.socketify.dev)", () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  dns.resolveSrv("_test._tcp.test.socketify.dev", (err, results) => {
    try {
      expect(err).toBeNull();
      expect(results instanceof Array).toBe(true);
      expect(results[0].name).toBe("_dc-srv.130c90ab9de1._test._tcp.test.socketify.dev");
      expect(results[0].priority).toBe(10);
      expect(results[0].weight).toBe(50);
      expect(results[0].port).toBe(80);
      resolve();
    } catch (error) {
      reject(err || error);
    }
  });
  return promise;
});

test("dns.resolveSrv (_test._tcp.invalid.localhost)", () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  dns.resolveSrv("_test._tcp.invalid.localhost", (err, results) => {
    try {
      expect(err).toBeTruthy();
      expect(results).toBeUndefined(true);
      resolve();
    } catch (error) {
      reject(err || error);
    }
  });
  return promise;
});

test("dns.resolveTxt (txt.socketify.dev)", () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  dns.resolveTxt("txt.socketify.dev", (err, results) => {
    try {
      expect(err).toBeNull();
      expect(results instanceof Array).toBe(true);
      expect(results[0][0]).toBe("bun_test;test");
      resolve();
    } catch (error) {
      reject(err || error);
    }
  });
  return promise;
});

test("dns.resolveSoa (bun.sh)", () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  dns.resolveSoa("bun.sh", (err, result) => {
    try {
      expect(err).toBeNull();
      expect(typeof result.serial).toBe("number");
      expect(result.refresh).toBe(10000);
      expect(result.retry).toBe(2400);
      expect(result.expire).toBe(604800);

      // Cloudflare might randomly change min TTL
      expect(result.minttl).toBeNumber();

      expect(result.nsname).toBe("hans.ns.cloudflare.com");
      expect(result.hostmaster).toBe("dns.cloudflare.com");
      resolve();
    } catch (error) {
      reject(err || error);
    }
  });
  return promise;
});

test("dns.resolveSoa (empty string)", () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  dns.resolveSoa("", (err, result) => {
    try {
      expect(err).toBeNull();
      // one of root server
      expect(result).not.toBeUndefined();
      resolve();
    } catch (error) {
      reject(err || error);
    }
  });
  return promise;
});

test("dns.resolveNaptr (naptr.socketify.dev)", () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  dns.resolveNaptr("naptr.socketify.dev", (err, results) => {
    try {
      expect(err).toBeNull();
      expect(results instanceof Array).toBe(true);
      expect(results[0].flags).toBe("S");
      expect(results[0].service).toBe("test");
      expect(results[0].regexp).toBe("");
      expect(results[0].replacement).toBe("");
      expect(results[0].order).toBe(1);
      expect(results[0].preference).toBe(12);
      resolve();
    } catch (error) {
      reject(err || error);
    }
  });
  return promise;
});

test("dns.resolveCaa (caa.socketify.dev)", () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  dns.resolveCaa("caa.socketify.dev", (err, results) => {
    try {
      expect(err).toBeNull();
      expect(results instanceof Array).toBe(true);
      expect(results[0].critical).toBe(0);
      expect(results[0].issue).toBe("bun.sh");
      resolve();
    } catch (error) {
      reject(err || error);
    }
  });
  return promise;
});

test("dns.resolveMx (bun.sh)", () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  dns.resolveMx("bun.sh", (err, results) => {
    try {
      expect(err).toBeNull();
      expect(results instanceof Array).toBe(true);
      const priority = results[0].priority;
      expect(priority >= 0 && priority < 65535).toBe(true);
      expect(results[0].exchange.includes("aspmx.l.google.com")).toBe(true);
      resolve();
    } catch (error) {
      reject(err || error);
    }
  });
  return promise;
});

test("dns.resolveNs (bun.sh) ", () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  dns.resolveNs("bun.sh", (err, results) => {
    try {
      expect(err).toBeNull();
      expect(results instanceof Array).toBe(true);
      expect(results[0].includes(".ns.cloudflare.com")).toBe(true);
      resolve();
    } catch (error) {
      reject(err || error);
    }
  });
  return promise;
});

test("dns.resolveNs (empty string) ", () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  dns.resolveNs("", (err, results) => {
    try {
      expect(err).toBeNull();
      expect(results instanceof Array).toBe(true);
      // root servers
      expect(results.sort()).toStrictEqual(
        [
          "e.root-servers.net",
          "h.root-servers.net",
          "l.root-servers.net",
          "i.root-servers.net",
          "a.root-servers.net",
          "d.root-servers.net",
          "c.root-servers.net",
          "b.root-servers.net",
          "j.root-servers.net",
          "k.root-servers.net",
          "g.root-servers.net",
          "m.root-servers.net",
          "f.root-servers.net",
        ].sort(),
      );
      resolve();
    } catch (error) {
      reject(err || error);
    }
  });
  return promise;
});

test("dns.resolvePtr (ptr.socketify.dev)", () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  dns.resolvePtr("ptr.socketify.dev", (err, results) => {
    try {
      expect(err).toBeNull();
      expect(results instanceof Array).toBe(true);
      expect(results[0]).toBe("bun.sh");
      resolve();
    } catch (error) {
      reject(err || error);
    }
  });
  return promise;
});

test("dns.resolveCname (cname.socketify.dev)", () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  dns.resolveCname("cname.socketify.dev", (err, results) => {
    try {
      expect(err).toBeNull();
      expect(results instanceof Array).toBe(true);
      expect(results[0]).toBe("bun.sh");
      resolve();
    } catch (error) {
      reject(err || error);
    }
  });
  return promise;
});

test("dns.lookup (example.com)", () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  dns.lookup("example.com", (err, address, family) => {
    try {
      expect(err).toBeNull();
      expect(typeof address).toBe("string");
      resolve();
    } catch (error) {
      reject(err || error);
    }
  });
  return promise;
});

test("dns.lookup bad (qedjp3f4q4jgjh4d6vaf3fd2hbfhg6upt2bscrfe.com)", () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  dns.lookup("qedjp3f4q4jgjh4d6vaf3fd2hbfhg6upt2bscrfe.com", (err, address, family) => {
    try {
      expect(err).not.toBeNull();
      expect(err.syscall).toEqual("getaddrinfo");
      expect(err.code).toEqual("ENOTFOUND");
      expect(address).toBeUndefined();
      expect(family).toBeUndefined();
      resolve();
    } catch (error) {
      reject(err || error);
    }
  });
  return promise;
});

test("dns.lookup (example.com) with { all: true } #2675", () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  dns.lookup("example.com", { all: true }, (err, address, family) => {
    try {
      expect(err).toBeNull();
      expect(Array.isArray(address)).toBe(true);
      resolve();
    } catch (error) {
      reject(err || error);
    }
  });
  return promise;
});

test("dns.lookup (localhost)", () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  dns.lookup("localhost", (err, address, family) => {
    expect(err).toBeNull();
    if (family === 6) {
      expect(address).toBe("::1");
    } else {
      expect(address).toBe("127.0.0.1");
    }

    err ? reject(err) : resolve();
  });

  return promise;
});

test("dns.getServers", () => {
  function parseResolvConf() {
    const servers = [];
    if (isWindows) {
      const { stdout } = Bun.spawnSync(["node", "-e", "dns.getServers().forEach(x => console.log(x))"], {
        stdout: "pipe",
      });
      return stdout.toString("utf8").trim().split("\n");
    }

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
  for (const server of expectServers) {
    expect(actualServers).toContain(server);
  }
});

describe("dns.reverse", () => {
  const inputs = [
    ["8.8.8.8", "dns.google"],
    ["2606:4700:4700::1111", "one.one.one.one"],
    ["2606:4700:4700::1001", "one.one.one.one"],
    ["1.1.1.1", "one.one.one.one"],
  ];
  it.each(inputs)("%s <- %s", (ip, expected) => {
    const { promise, resolve, reject } = Promise.withResolvers();
    dns.reverse(ip, (err, hostnames) => {
      try {
        expect(err).toBeNull();
        expect(hostnames).toContain(expected);
        resolve();
      } catch (error) {
        reject(err || error);
      }
    });
    return promise;
  });
});

test("dns.promises.reverse", async () => {
  {
    let hostnames = await dns.promises.reverse("8.8.8.8");
    expect(hostnames).toContain("dns.google");
  }
  {
    let hostnames = await dns.promises.reverse("1.1.1.1");
    expect(hostnames).toContain("one.one.one.one");
  }
  {
    let hostnames = await dns.promises.reverse("2606:4700:4700::1111");
    expect(hostnames).toContain("one.one.one.one");
  }
});

describe("test invalid arguments", () => {
  it.each([
    // TODO: dns.resolveAny is not implemented yet
    ["dns.resolveCname", dns.resolveCname],
    ["dns.resolveCaa", dns.resolveCaa],
    ["dns.resolveMx", dns.resolveMx],
    ["dns.resolveNaptr", dns.resolveNaptr],
    ["dns.resolveNs", dns.resolveNs],
    ["dns.resolvePtr", dns.resolvePtr],
    ["dns.resolveSoa", dns.resolveSoa],
    ["dns.resolveSrv", dns.resolveSrv],
    ["dns.resolveTxt", dns.resolveTxt],
  ])("%s", (_, fn, done) => {
    fn("a".repeat(2000), (err, results) => {
      try {
        expect(err).not.toBeNull();
        expect(results).toBeUndefined();
        // Assert we convert our error codes to Node.js error codes
        expect(err.code).not.toStartWith("DNS_");
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  it("dns.lookupService", async () => {
    expect(() => {
      dns.lookupService("", 443, (err, hostname, service) => {});
    }).toThrow("Expected address to be a non-empty string for 'lookupService'.");
    expect(() => {
      dns.lookupService("google.com", 443, (err, hostname, service) => {});
    }).toThrow(`The "address" argument is invalid. Received type string ('google.com')`);
  });
});

describe("dns.lookupService", () => {
  it.each([
    ["1.1.1.1", 53, ["one.one.one.one", "domain"]],
    ["2606:4700:4700::1111", 53, ["one.one.one.one", "domain"]],
    ["2606:4700:4700::1001", 53, ["one.one.one.one", "domain"]],
    ["1.1.1.1", 80, ["one.one.one.one", "http"]],
    ["1.1.1.1", 443, ["one.one.one.one", "https"]],
  ])("lookupService(%s, %d)", (address, port, expected) => {
    const { promise, resolve, reject } = Promise.withResolvers();
    dns.lookupService(address, port, (err, hostname, service) => {
      try {
        expect(err).toBeNull();
        expect(hostname).toStrictEqual(expected[0]);
        expect(service).toStrictEqual(expected[1]);
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    return promise;
  });

  it("lookupService(255.255.255.255, 443)", () => {
    const { promise, resolve, reject } = Promise.withResolvers();
    dns.lookupService("255.255.255.255", 443, (err, hostname, service) => {
      if (process.platform == "darwin") {
        try {
          expect(err).toBeNull();
          expect(hostname).toStrictEqual("broadcasthost");
          expect(service).toStrictEqual("https");
          resolve();
        } catch (err) {
          reject(err);
        }
      } else {
        try {
          expect(err).not.toBeNull();
          expect(hostname).toBeUndefined();
          expect(service).toBeUndefined();
          resolve();
        } catch (err) {
          reject(err);
        }
      }
    });
  });

  it.each([
    ["1.1.1.1", 53, ["one.one.one.one", "domain"]],
    ["2606:4700:4700::1111", 53, ["one.one.one.one", "domain"]],
    ["2606:4700:4700::1001", 53, ["one.one.one.one", "domain"]],
    ["1.1.1.1", 80, ["one.one.one.one", "http"]],
    ["1.1.1.1", 443, ["one.one.one.one", "https"]],
  ])("promises.lookupService(%s, %d)", async (address, port, expected) => {
    const { hostname, service } = await dns.promises.lookupService(address, port);
    expect(hostname).toStrictEqual(expected[0]);
    expect(service).toStrictEqual(expected[1]);
  });
});

// Deprecated reference: https://nodejs.org/api/deprecations.html#DEP0118
describe("lookup deprecated behavior", () => {
  it.each([undefined, false, null, NaN, ""])("dns.lookup", domain => {
    dns.lookup(domain, (error, address, family) => {
      expect(error).toBeNull();
      expect(address).toBeNull();
      expect(family).toBe(4);
    });
  });
});

describe("uses `dns.promises` implementations for `util.promisify` factory", () => {
  it.each([
    "lookup",
    "lookupService",
    "resolve",
    "reverse",
    "resolve4",
    "resolve6",
    "resolveAny",
    "resolveCname",
    "resolveCaa",
    "resolveMx",
    "resolveNs",
    "resolvePtr",
    "resolveSoa",
    "resolveSrv",
    "resolveTxt",
    "resolveNaptr",
  ])("%s", method => {
    expect(dns[method][util.promisify.custom]).toBe(dns_promises[method]);
    expect(dns.promises[method]).toBe(dns_promises[method]);
  });

  it("util.promisify(dns.lookup) acts like dns.promises.lookup", async () => {
    // This test previously used example.com, but that domain has multiple A records, which can cause this test to fail.
    // As of this writing, google.com has only one A record. If that changes, update this test with a domain that has only one A record.
    expect(await util.promisify(dns.lookup)("google.com")).toEqual(await dns.promises.lookup("google.com"));
  });
});
