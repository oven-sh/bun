import { describe, expect, test, it } from "bun:test";
import * as dns from "node:dns";
import * as dns_promises from "node:dns/promises";
import * as fs from "node:fs";
import * as os from "node:os";
import * as util from "node:util";

const isWindows = process.platform === "win32";

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

test("dns.resolveSoa (empty string)", done => {
  dns.resolveSoa("", (err, result) => {
    expect(err).toBeNull();
    // one of root server
    expect(result).not.toBeUndefined();
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
    expect(results[0].exchange.includes("aspmx.l.google.com")).toBe(true);
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

test("dns.resolveNs (empty string) ", done => {
  dns.resolveNs("", (err, results) => {
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

test.skipIf(isWindows)("dns.getServers", done => {
  function parseResolvConf() {
    const servers = [];
    if (isWindows) {
      // TODO: fix this, is not working on CI
      const { stdout } = Bun.spawnSync(["ipconfig"], { stdout: "pipe" });
      for (const line of stdout.toString("utf8").split(os.EOL)) {
        if (line.indexOf("Default Gateway") !== -1) {
          servers.push(line.split(":")[1].trim());
        }
      }
      return servers;
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
  try {
    for (const server of expectServers) {
      expect(actualServers).toContain(server);
    }
  } catch (err) {
    return done(err);
  }
  done();
});

test("dns.reverse", done => {
  dns.reverse("8.8.8.8", (err, hostnames) => {
    try {
      expect(err).toBeNull();
      expect(hostnames).toContain("dns.google");
      done();
    } catch (err) {
      done(err);
    }
  });
  dns.reverse("1.1.1.1", (err, hostnames) => {
    try {
      expect(err).toBeNull();
      expect(hostnames).toContain("one.one.one.one");
      done();
    } catch (err) {
      done(err);
    }
  });
  dns.reverse("2606:4700:4700::1111", (err, hostnames) => {
    try {
      expect(err).toBeNull();
      expect(hostnames).toContain("one.one.one.one");
      done();
    } catch (err) {
      done(err);
    }
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
    }).toThrow("Expected address to be a invalid address for 'lookupService'.");
  });
});

describe("dns.lookupService", () => {
  it.each([
    ["1.1.1.1", 53, ["one.one.one.one", "domain"]],
    ["2606:4700:4700::1111", 53, ["one.one.one.one", "domain"]],
    ["2606:4700:4700::1001", 53, ["one.one.one.one", "domain"]],
    ["1.1.1.1", 80, ["one.one.one.one", "http"]],
    ["1.1.1.1", 443, ["one.one.one.one", "https"]],
  ])("lookupService(%s, %d)", (address, port, expected, done) => {
    dns.lookupService(address, port, (err, hostname, service) => {
      try {
        expect(err).toBeNull();
        expect(hostname).toStrictEqual(expected[0]);
        expect(service).toStrictEqual(expected[1]);
        done();
      } catch (err) {
        done(err);
      }
    });
  });

  it("lookupService(255.255.255.255, 443)", done => {
    dns.lookupService("255.255.255.255", 443, (err, hostname, service) => {
      if (process.platform == "darwin") {
        try {
          expect(err).toBeNull();
          expect(hostname).toStrictEqual("broadcasthost");
          expect(service).toStrictEqual("https");
          done();
        } catch (err) {
          done(err);
        }
      } else {
        try {
          expect(err).not.toBeNull();
          expect(hostname).toBeUndefined();
          expect(service).toBeUndefined();
          done();
        } catch (err) {
          done(err);
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
    const [hostname, service] = await dns.promises.lookupService(address, port);
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
    expect(await util.promisify(dns.lookup)("example.com")).toEqual(await dns.promises.lookup("example.com"));
  });
});
