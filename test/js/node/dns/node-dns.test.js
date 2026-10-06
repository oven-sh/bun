import { dnsGetaddrinfoError } from "bun:internal-for-testing";
import { beforeAll, describe, expect, it, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows } from "harness";
import * as dgram from "node:dgram";
import * as dns from "node:dns";
import * as dns_promises from "node:dns/promises";
import { once } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as util from "node:util";
import { Worker } from "node:worker_threads";

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

// RFC 2782 says SRV targets must not be compressed, but a lot of deployed
// resolvers (dnsmasq, mDNSResponder, older BIND, various corporate forwarders)
// still compress them. c-ares 1.34.8 started rejecting these responses with
// EBADRESP; make sure we keep accepting them.
test.skipIf(isWindows)("dns.resolveSrv accepts compressed target in RDATA", async () => {
  const socket = dgram.createSocket("udp4");
  try {
    socket.on("message", (query, rinfo) => {
      // Find end of question section: QNAME + QTYPE(2) + QCLASS(2).
      let off = 12;
      while (off < query.length && query[off] !== 0) off += query[off] + 1;
      off += 1 + 2 + 2;
      const question = query.subarray(12, off);

      const header = Buffer.alloc(12);
      header[0] = query[0];
      header[1] = query[1];
      header[2] = 0x81; // QR=1, RD=1
      header[3] = 0x80; // RA=1
      header[5] = 1; // QDCOUNT
      header[7] = 1; // ANCOUNT

      // RDATA: priority=10, weight=50, port=80, target = "srv" + pointer to
      // QNAME at offset 12. After decompression the target is
      // srv.<query-name>.
      const rdata = Buffer.from([
        0x00,
        0x0a, // priority
        0x00,
        0x32, // weight
        0x00,
        0x50, // port
        0x03,
        0x73,
        0x72,
        0x76, // "srv"
        0xc0,
        0x0c, // compression pointer -> offset 12
      ]);
      const answer = Buffer.concat([
        Buffer.from([0xc0, 0x0c, 0x00, 0x21, 0x00, 0x01, 0x00, 0x00, 0x00, 0x3c]),
        Buffer.from([rdata.length >> 8, rdata.length & 0xff]),
        rdata,
      ]);
      socket.send(Buffer.concat([header, question, answer]), rinfo.port, rinfo.address);
    });
    socket.bind(0, "127.0.0.1");
    await once(socket, "listening");
    const { port } = socket.address();

    const resolver = new dns.Resolver({ timeout: 1000, tries: 1 });
    resolver.setServers(["127.0.0.1:" + port]);
    const { promise, resolve, reject } = Promise.withResolvers();
    resolver.resolveSrv("_test._tcp.example.test", (err, records) => (err ? reject(err) : resolve(records)));
    const records = await promise;
    expect(records).toEqual([{ name: "srv._test._tcp.example.test", priority: 10, weight: 50, port: 80 }]);
  } finally {
    socket.close();
  }
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

test.skipIf(isWindows)("dns.Resolver#resolveCaa keeps a numeric CAA tag reachable by index", async () => {
  const socket = dgram.createSocket("udp4");
  try {
    socket.on("message", (query, rinfo) => {
      let off = 12;
      while (off < query.length && query[off] !== 0) off += query[off] + 1;
      off += 1 + 2 + 2;
      const question = query.subarray(12, off);
      const header = Buffer.alloc(12);
      header[0] = query[0];
      header[1] = query[1];
      header[2] = 0x81;
      header[3] = 0x80;
      header[5] = 1;
      header[7] = 1;
      const tag = Buffer.from("128");
      const value = Buffer.from("issue.example");
      const rdata = Buffer.concat([Buffer.from([0x00, tag.length]), tag, value]);
      const answer = Buffer.concat([
        Buffer.from([0xc0, 0x0c, 0x01, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x3c]),
        Buffer.from([rdata.length >> 8, rdata.length & 0xff]),
        rdata,
      ]);
      socket.send(Buffer.concat([header, question, answer]), rinfo.port, rinfo.address);
    });
    socket.bind(0, "127.0.0.1");
    await once(socket, "listening");
    const { port } = socket.address();

    const resolver = new dns.Resolver({ timeout: 1000, tries: 1 });
    resolver.setServers(["127.0.0.1:" + port]);
    const { promise, resolve, reject } = Promise.withResolvers();
    resolver.resolveCaa("caa.example.test", (err, records) => (err ? reject(err) : resolve(records)));
    const records = await promise;
    expect(records.length).toBe(1);
    expect(records[0].critical).toBe(0);
    expect(records[0][128]).toBe("issue.example");
    expect(Object.keys(records[0])).toEqual(["128", "critical"]);
  } finally {
    socket.close();
  }
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

// dns.lookup()'s contract is getaddrinfo(3), so it must use the system
// resolver, not c-ares, which reads /etc/resolv.conf directly and bypasses
// NSS/systemd-resolved on split-DNS hosts (#37378). "127.1" is a legacy IPv4
// literal: getaddrinfo resolves it locally with no DNS traffic, while c-ares
// treats it as a hostname and queries the configured servers, here a local
// responder that REFUSEs every query. Linux-only: it is the one platform
// where the default Bun.dns backend is c-ares.
test.skipIf(!isLinux)("dns.lookup uses getaddrinfo, not the c-ares resolver", async () => {
  const fixture = `
    const dns = require("node:dns");
    function refused(msg) {
      const r = Buffer.from(msg);
      r[2] = 0x81; // QR + RD
      r[3] = 0x85; // RA + rcode REFUSED
      r.fill(0, 6, 12); // zero the answer counts
      return r;
    }
    const server = await Bun.udpSocket({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data(sock, buf, port, addr) { sock.send(refused(buf), port, addr); } },
    });
    dns.setServers(["127.0.0.1:" + server.port]);
    const fromPromises = await dns.promises.lookup("127.1").then(
      ({ address, family }) => ({ address, family }),
      e => ({ code: e.code }),
    );
    const fromCallback = await new Promise(resolve => {
      dns.lookup("127.1", (e, address, family) => resolve(e ? { code: e.code } : { address, family }));
    });
    server.close();
    console.log(JSON.stringify({ fromPromises, fromCallback }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    fromPromises: { address: "127.0.0.1", family: 4 },
    fromCallback: { address: "127.0.0.1", family: 4 },
  });
  expect(exitCode).toBe(0);
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

  // https://github.com/oven-sh/bun/issues/36892
  describe.each([
    ["dns.resolve", hostname => dns.resolve(hostname, undefined, () => {})],
    ["Resolver#resolve", hostname => new dns.Resolver().resolve(hostname, undefined, () => {})],
  ])("%s", (_, fn) => {
    it("with undefined rrtype throws ERR_INVALID_ARG_TYPE", () => {
      expect(() => fn("localhost")).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
          message: expect.stringContaining('The "rrtype" argument must be of type string'),
        }),
      );
    });
  });

  it("dns.promises.resolve with undefined rrtype does not throw", async () => {
    // Node's promises API treats undefined rrtype as "A"
    const promise = dns_promises.resolve("localhost", undefined);
    expect(promise).toBeInstanceOf(Promise);
    await promise.catch(() => {}); // result depends on the environment's resolver
  });

  it("dns.lookupService", async () => {
    expect(() => {
      dns.lookupService("", 443, (err, hostname, service) => {});
    }).toThrow("The argument 'address' is invalid. Received ''");
    expect(() => {
      dns.lookupService("google.com", 443, (err, hostname, service) => {});
    }).toThrow("The argument 'address' is invalid. Received 'google.com'");
  });
});

// https://github.com/oven-sh/bun/issues/39550
// Node treats a third argument as the callback: query(name, options, callback).
describe("a third argument shifts the callback", () => {
  const resolvers = [
    ["dns.resolve4", dns.resolve4],
    ["dns.resolve6", dns.resolve6],
    ["dns.resolveAny", dns.resolveAny],
    ["dns.resolveCname", dns.resolveCname],
    ["dns.resolveCaa", dns.resolveCaa],
    ["dns.resolveMx", dns.resolveMx],
    ["dns.resolveNaptr", dns.resolveNaptr],
    ["dns.resolveNs", dns.resolveNs],
    ["dns.resolvePtr", dns.resolvePtr],
    ["dns.resolveSoa", dns.resolveSoa],
    ["dns.resolveSrv", dns.resolveSrv],
    ["dns.resolveTxt", dns.resolveTxt],
    ["dns.reverse", dns.reverse],
  ];

  it.each(resolvers)("%s throws when the third argument is not a function", (_, fn) => {
    expect(() => fn("localhost", () => {}, "ignored-value")).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        message: expect.stringContaining('The "callback" argument must be of type function'),
      }),
    );
  });

  it.each(resolvers.filter(([name]) => name !== "dns.reverse"))(
    "%s accepts an options argument before the callback",
    (_, fn, done) => {
      // The overlong name fails locally, so the callback runs without network access.
      fn(Buffer.alloc(2000, "a").toString(), {}, () => done());
    },
  );
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

  // https://github.com/oven-sh/bun/issues/37486
  it("treats an IPv4-mapped IPv6 address like its embedded IPv4 address", async () => {
    // getnameinfo for 127.0.0.1 may ENOTFOUND on Windows, so assert the
    // mapped form yields the same outcome rather than a specific result.
    const settle = p =>
      p.then(
        v => ({ ok: v }),
        e => ({ err: e.code }),
      );
    const [mapped, v4] = await Promise.all([
      settle(dns_promises.lookupService("::ffff:127.0.0.1", 53)),
      settle(dns_promises.lookupService("127.0.0.1", 53)),
    ]);
    expect(mapped).toEqual(v4);
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
    // Use a name that resolves locally: a public name with several A records
    // behind round-robin DNS can return a different first address per call.
    expect(await util.promisify(dns.lookup)("localhost")).toEqual(await dns.promises.lookup("localhost"));
  });
});

describe("hostnames containing NUL bytes", () => {
  const hostnameWithNul = "localhost\0.example.invalid";

  it("dns.promises.lookup rejects instead of truncating at the NUL", async () => {
    await expect(dns_promises.lookup(hostnameWithNul)).rejects.toThrow();
  });

  it("dns.lookup (callback) passes an error instead of truncating at the NUL", async () => {
    const { promise, resolve, reject } = Promise.withResolvers();
    dns.lookup(hostnameWithNul, (err, address, family) => {
      try {
        expect(err).toBeTruthy();
        expect(address).toBeUndefined();
        resolve();
      } catch (e) {
        reject(e);
      }
    });
    await promise;
  });

  it("plain localhost still resolves", async () => {
    const { address } = await dns_promises.lookup("localhost");
    expect(["127.0.0.1", "::1"]).toContain(address);
  });
});

// Node treats a null option field the same as an absent one (its guards are
// `!= null`), so e.g. `{ hints: null }` must not throw. https://github.com/oven-sh/bun/issues/37318
describe("dns.lookup null option fields are treated as unset", () => {
  const fields = ["hints", "all", "verbatim", "order", "family"];

  it.each(fields)("dns.lookup with {%s: null} resolves", async field => {
    const { promise, resolve, reject } = Promise.withResolvers();
    dns.lookup("localhost", { [field]: null }, (err, address, family) => {
      if (err) reject(err);
      else resolve({ address, family });
    });
    const { address } = await promise;
    expect(["127.0.0.1", "::1"]).toContain(address);
  });

  it.each(fields)("dns.promises.lookup with {%s: null} resolves", async field => {
    const { address } = await dns_promises.lookup("localhost", { [field]: null });
    expect(["127.0.0.1", "::1"]).toContain(address);
  });
});

describe("dns.Resolver options validation", () => {
  describe.each([
    ["dns.Resolver", dns.Resolver],
    ["dns.promises.Resolver", dns_promises.Resolver],
  ])("%s", (_name, Resolver) => {
    it.each([0, -1, 2.5, -0.5, 2 ** 31])("{tries: %p} throws ERR_OUT_OF_RANGE", tries => {
      expect(() => new Resolver({ tries })).toThrow(expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }));
    });

    it("{tries: 'x'} throws ERR_INVALID_ARG_TYPE", () => {
      expect(() => new Resolver({ tries: "x" })).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    });

    it.each([-2, 1.5, 2 ** 31])("{timeout: %p} throws ERR_OUT_OF_RANGE", timeout => {
      expect(() => new Resolver({ timeout })).toThrow(expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }));
    });

    it.each([1, 4, 2 ** 31 - 1])("{tries: %p} is accepted", tries => {
      expect(() => new Resolver({ tries })).not.toThrow();
    });

    it.each([-1, 0, 100, 2 ** 31 - 1])("{timeout: %p} is accepted", timeout => {
      expect(() => new Resolver({ timeout })).not.toThrow();
    });

    it.each([undefined, null, 42, "hello", true])("non-object options %p uses defaults", options => {
      expect(() => new Resolver(options)).not.toThrow();
    });
  });
});

describe("dns.Resolver#setServers with IPv6 zone identifiers", () => {
  describe.each([
    ["dns.Resolver", dns.Resolver],
    ["dns.promises.Resolver", dns_promises.Resolver],
  ])("%s", (_name, Resolver) => {
    it("accepts and strips the zone id", () => {
      const r = new Resolver();
      r.setServers(["fe80::1%lo"]);
      expect(r.getServers()).toEqual(["fe80::1"]);
    });

    it("accepts a bracketed zone id with a port", () => {
      const r = new Resolver();
      r.setServers(["[fe80::1%lo]:5353"]);
      expect(r.getServers()).toEqual(["[fe80::1]:5353"]);
    });
  });
});

describe("dns.lookupService with a numeric-string port", () => {
  // getnameinfo for 127.0.0.1 resolves on Linux/macOS but may ENOTFOUND on
  // Windows, so assert that "22" yields the same outcome as 22 rather than a
  // specific result.
  const settle = p =>
    p.then(
      v => ({ ok: v }),
      e => ({ err: e.code }),
    );

  it("callback API coerces a numeric-string port", async () => {
    const run = port => {
      const { promise, resolve } = Promise.withResolvers();
      dns.lookupService("127.0.0.1", port, (err, hostname, service) => {
        resolve(err ? { err: err.code } : { ok: { hostname, service } });
      });
      return promise;
    };
    const [asString, asNumber] = await Promise.all([run("22"), run(22)]);
    expect(asString).toEqual(asNumber);
    expect(asString.err).not.toBe("ERR_SOCKET_BAD_PORT");
  });

  it("promises API coerces a numeric-string port", async () => {
    const [asString, asNumber] = await Promise.all([
      settle(dns_promises.lookupService("127.0.0.1", "22")),
      settle(dns_promises.lookupService("127.0.0.1", 22)),
    ]);
    expect(asString).toEqual(asNumber);
    expect(asString.err).not.toBe("ERR_SOCKET_BAD_PORT");
  });

  it("promises API still throws ERR_SOCKET_BAD_PORT synchronously for a truly bad port", () => {
    expect(() => dns_promises.lookupService("127.0.0.1", "nope")).toThrow(
      expect.objectContaining({ code: "ERR_SOCKET_BAD_PORT" }),
    );
  });
});

// The order that "localhost" has on this host with no sort applied. The two
// orders of dns.lookup() differ only where it has an IPv4 and an IPv6 address.
const localhostVerbatim = await dns_promises.lookup("localhost", { all: true, order: "verbatim" }).catch(() => []);

// A resolver keeps a 32-slot pending cache per query kind. The first in-flight
// query for a name owns a slot; identical queries issued while it is in flight
// are chained onto it and settled together when it completes, so the server
// sees one query per distinct name. Queries issued while all 32 slots are taken
// get no slot and settle on their own. The fake server below records every
// query it receives and answers an A query for "a<n>.pending.test" with
// 10.0.0.<n>, so a promise settled from the wrong slot shows up as the wrong
// address. It answers MX with two records, TXT with one, and every other type
// with the name "ptr.pending.test".
describe("pending cache", () => {
  function encodeName(name) {
    return Buffer.concat([
      ...name.split(".").map(label => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)])),
      Buffer.from([0]),
    ]);
  }

  async function startFakeServer(onReplied) {
    const socket = dgram.createSocket("udp4");
    const queries = [];
    socket.on("message", (query, rinfo) => {
      const labels = [];
      let off = 12;
      while (query[off] !== 0) {
        labels.push(query.toString("latin1", off + 1, off + 1 + query[off]));
        off += query[off] + 1;
      }
      const qtype = query.readUInt16BE(off + 1);
      const question = query.subarray(12, off + 5);
      const qname = labels.join(".");
      queries.push(`${{ 1: "A", 12: "PTR", 15: "MX", 16: "TXT" }[qtype] ?? qtype} ${qname}`);

      const records = {
        1: () => [Buffer.from([10, 0, 0, Number(/\d+/.exec(labels[0])[0])])],
        15: () =>
          [20, 10].map(priority =>
            Buffer.concat([Buffer.from([0, priority]), encodeName(`mx${priority}.pending.test`)]),
          ),
        16: () => [Buffer.from("\x02hi")],
      }[qtype]?.() ?? [encodeName("ptr.pending.test")];
      const header = Buffer.from([query[0], query[1], 0x81, 0x80, 0, 1, 0, records.length, 0, 0, 0, 0]);
      const answers = records.flatMap(rdata => [
        Buffer.from([0xc0, 0x0c, 0, qtype, 0, 1, 0, 0, 0, 60, rdata.length >> 8, rdata.length & 0xff]),
        rdata,
      ]);
      socket.send(Buffer.concat([header, question, ...answers]), rinfo.port, rinfo.address, onReplied);
    });
    socket.bind(0, "127.0.0.1");
    await once(socket, "listening");
    const resolver = new dns_promises.Resolver({ timeout: 1000, tries: 1 });
    resolver.setServers(["127.0.0.1:" + socket.address().port]);
    return { socket, queries, resolver, port: socket.address().port };
  }

  test.concurrent("concurrent resolve4() of the same names share one query per name", async () => {
    const { socket, queries, resolver } = await startFakeServer();
    try {
      const names = Array.from({ length: 3 }, (_, i) => `a${i}.pending.test`);
      const results = await Promise.all(
        names.flatMap(name =>
          Array.from({ length: 4 }, () => resolver.resolve4(name).then(addresses => [name, addresses])),
        ),
      );
      expect(results).toEqual(names.flatMap((name, i) => Array(4).fill([name, ["10.0.0." + i]])));
      expect(queries.sort()).toEqual(names.map(name => "A " + name));
    } finally {
      socket.close();
    }
  });

  test.concurrent("more distinct resolve4() than pending-cache slots all settle with their own answers", async () => {
    const { socket, queries, resolver } = await startFakeServer();
    try {
      const names = Array.from({ length: 40 }, (_, i) => `a${i}.pending.test`);
      const results = await Promise.all(names.map(name => resolver.resolve4(name)));
      expect(results).toEqual(names.map((_, i) => ["10.0.0." + i]));
      expect(queries.sort()).toEqual(names.map(name => "A " + name).sort());
    } finally {
      socket.close();
    }
  });

  test.concurrent("concurrent reverse() of the same address share one PTR query", async () => {
    const { socket, queries, resolver } = await startFakeServer();
    try {
      const results = await Promise.all(Array.from({ length: 4 }, () => resolver.reverse("192.0.2.7")));
      expect(results).toEqual(Array(4).fill(["ptr.pending.test"]));
      expect(queries).toEqual(["PTR 7.2.0.192.in-addr.arpa"]);
    } finally {
      socket.close();
    }
  });

  // Bun.dns.lookup with the c-ares backend goes through the default resolver,
  // so point that resolver at the fake server in a child process. The trailing
  // dot keeps c-ares from also trying the host's search domains.
  test.concurrent("concurrent c-ares lookup() of the same name share one query", async () => {
    const { socket, queries, port } = await startFakeServer();
    try {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `require("node:dns").setServers(["127.0.0.1:" + process.argv[1]]);
           const lookups = Array.from({ length: 4 }, () => Bun.dns.lookup("a5.pending.test.", { backend: "c-ares", family: 4 }));
           Promise.all(lookups).then(results => console.log(JSON.stringify(results.map(r => r.map(({ address, family }) => ({ address, family }))))));`,
          String(port),
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual(Array(4).fill([{ address: "10.0.0.5", family: 4 }]));
      expect(exitCode).toBe(0);
      expect(queries).toEqual(["A a5.pending.test"]);
    } finally {
      socket.close();
    }
  });

  // dns.lookup() uses the OS resolver, which answers "localhost" from the hosts
  // file, so this stays offline while still coalescing onto one slot.
  test.concurrent("concurrent lookup() of the same name all settle", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => dns_promises.lookup("localhost", { family: 4 })));
    expect(results).toEqual(Array(8).fill({ address: "127.0.0.1", family: 4 }));
  });

  // One reply settles every caller chained onto a query, but each caller gets
  // a result of its own, as in Node: what one caller does to its array, or to
  // a record in it, must not show in another caller's answer.
  const inFlight = ask => Promise.all([ask(), ask(), ask()]);
  // The calls whose callers were handed the same array or the same record.
  const shared = results =>
    Object.keys(results).filter(call => {
      const cells = results[call].flatMap(answer => [answer, ...answer.filter(record => typeof record === "object")]);
      return new Set(cells).size !== cells.length;
    });

  test.concurrent("callers that share one query each get their own result", async () => {
    const { socket, queries, resolver, port } = await startFakeServer();
    try {
      const callbacks = new dns.Resolver({ timeout: 1000, tries: 1 });
      callbacks.setServers(["127.0.0.1:" + port]);
      const resolveMxWithCallback = name =>
        new Promise((resolve, reject) =>
          callbacks.resolveMx(name, (err, records) => (err ? reject(err) : resolve(records))),
        );

      const results = {
        "resolve4 ttl": await inFlight(() => resolver.resolve4("a1.pending.test", { ttl: true })),
        resolveMx: await inFlight(() => resolver.resolveMx("mx.pending.test")),
        "resolveMx callback": await inFlight(() => resolveMxWithCallback("mx-callback.pending.test")),
        resolveTxt: await inFlight(() => resolver.resolveTxt("txt.pending.test")),
        reverse: await inFlight(() => resolver.reverse("192.0.2.7")),
        // The OS resolver answers "localhost" from the hosts file.
        "Bun.dns.lookup": await inFlight(() => Bun.dns.lookup("localhost", { family: 4 })),
      };
      expect(shared(results)).toEqual([]);
      const mx = [
        { priority: 20, exchange: "mx20.pending.test" },
        { priority: 10, exchange: "mx10.pending.test" },
      ];
      expect(results).toEqual({
        "resolve4 ttl": Array(3).fill([{ address: "10.0.0.1", ttl: 60 }]),
        resolveMx: Array(3).fill(mx),
        "resolveMx callback": Array(3).fill(mx),
        resolveTxt: Array(3).fill([["hi"]]),
        reverse: Array(3).fill(["ptr.pending.test"]),
        "Bun.dns.lookup": Array(3).fill(
          expect.arrayContaining([expect.objectContaining({ address: "127.0.0.1", family: 4 })]),
        ),
      });

      // Three senders each take the best mail host off their own list.
      const bestMailHost = async () => {
        const records = await resolver.resolveMx("mail.pending.test");
        return records.sort((a, b) => a.priority - b.priority).shift().exchange;
      };
      expect(await Promise.all([bestMailHost(), bestMailHost(), bestMailHost()])).toEqual(
        Array(3).fill("mx10.pending.test"),
      );

      // Still one query per name and resolver.
      expect(queries).toEqual([
        "A a1.pending.test",
        "MX mx.pending.test",
        "MX mx-callback.pending.test",
        "TXT txt.pending.test",
        "PTR 7.2.0.192.in-addr.arpa",
        "MX mail.pending.test",
      ]);
    } finally {
      socket.close();
    }
  });

  // The default resolver, in a child process as above: c-ares lookup(),
  // lookupService(), a callback caller and a promise caller of one query, a
  // caller in another realm, whose answer is built in that realm, and the
  // host beside two Bun.ModuleGraph instances of one program.
  test.concurrent("default-resolver callers that share one query each get their own result", async () => {
    const { socket, queries, port } = await startFakeServer();
    try {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const dns = require("node:dns");
           dns.setServers(["127.0.0.1:" + process.argv[1]]);
           const inFlight = ask => Promise.all([ask(), ask(), ask()]);
           const distinct = values => new Set(values).size === values.length;
           (async () => {
             const lookup = await inFlight(() => Bun.dns.lookup("a5.pending.test.", { backend: "c-ares", family: 4 }));
             const lookupService = await inFlight(() => Bun.dns.lookupService("192.0.2.7", 80));
             const mx = await Promise.all([
               new Promise(resolve => dns.resolveMx("mx.pending.test", (err, records) => resolve(records))),
               dns.promises.resolveMx("mx.pending.test"),
             ]);
             const inRealm = new ShadowRealm().evaluate(
               "(name, done) => { Bun.dns.resolveTxt(name).then(records => done(records instanceof Array && records[0] instanceof Array)); }",
             );
             const txt = await Promise.all([
               Bun.dns.resolveTxt("txt.pending.test"),
               new Promise(resolve => inRealm("txt.pending.test", resolve)),
               Bun.dns.resolveTxt("txt.pending.test"),
             ]);
             const graphs = [new Bun.ModuleGraph(), new Bun.ModuleGraph()];
             const askFromGraph = () => Bun.dns.resolveMx("graphs.pending.test");
             const sideBySide = await Promise.all([askFromGraph(), ...graphs.map(graph => graph.run(askFromGraph))]);
             for (const graph of graphs) graph.dispose();
             console.log(JSON.stringify({
               lookup: {
                 own: distinct(lookup) && distinct(lookup.map(answer => answer[0])),
                 addresses: lookup.map(answer => answer.map(record => record.address)),
               },
               lookupService: { own: distinct(lookupService), hostnames: lookupService.map(answer => answer[0]) },
               mx: {
                 own: distinct(mx) && distinct(mx.flat()),
                 exchanges: mx.map(answer => answer.map(record => record.exchange)),
               },
               txt: { own: distinct([txt[0], txt[2], txt[0][0], txt[2][0]]), builtInItsRealm: txt[1], main: [txt[0], txt[2]] },
               graphs: {
                 own: distinct(sideBySide) && distinct(sideBySide.flat()),
                 exchanges: sideBySide.map(answer => answer.map(record => record.exchange)),
               },
             }));
           })();`,
          String(port),
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        lookup: { own: true, addresses: Array(3).fill(["10.0.0.5"]) },
        lookupService: { own: true, hostnames: Array(3).fill("ptr.pending.test") },
        mx: { own: true, exchanges: Array(2).fill(["mx20.pending.test", "mx10.pending.test"]) },
        txt: { own: true, builtInItsRealm: true, main: Array(2).fill([["hi"]]) },
        graphs: { own: true, exchanges: Array(3).fill(["mx20.pending.test", "mx10.pending.test"]) },
      });
      expect(exitCode).toBe(0);
      expect(queries).toEqual([
        "A a5.pending.test",
        "PTR 7.2.0.192.in-addr.arpa",
        "MX mx.pending.test",
        "TXT txt.pending.test",
        "MX graphs.pending.test",
      ]);
    } finally {
      socket.close();
    }
  });

  // dns.lookup() sorts the list it gets by `order`, and lookups that differ
  // only in `order` share one query: the sort of one must not reach another.
  test.concurrent.skipIf(new Set(localhostVerbatim.map(record => record.family)).size < 2)(
    "lookup() keeps its own order behind a lookup with another order",
    async () => {
      const otherOrder = localhostVerbatim[0].family === 4 ? "ipv6first" : "ipv4first";
      const [, all, first] = await Promise.all([
        dns_promises.lookup("localhost", { all: true, order: otherOrder }),
        dns_promises.lookup("localhost", { all: true, order: "verbatim" }),
        dns_promises.lookup("localhost", { order: "verbatim" }),
      ]);
      expect({ all, first }).toEqual({ all: localhostVerbatim, first: localhostVerbatim[0] });
    },
  );

  // Resolving a promise with an array reads the array's "then", so this getter
  // runs a full collection inside every settle, between the callers of one
  // query. Each answer goes from its conversion straight into its promise.
  test.concurrent("a collection inside every settle leaves each caller's answer intact", async () => {
    const { socket, queries, port } = await startFakeServer();
    try {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const dns = require("node:dns");
           dns.setServers(["127.0.0.1:" + process.argv[1]]);
           let collections = 0;
           Object.defineProperty(Array.prototype, "then", {
             configurable: true,
             get() {
               collections++;
               Bun.gc(true);
             },
           });
           const collectionsPerCall = {};
           const inFlight = async (call, ask) => {
             const before = collections;
             const answers = await Promise.all([ask(), ask(), ask()]);
             collectionsPerCall[call] = collections - before;
             return answers;
           };
           (async () => {
             // Callers chain only on a query that goes to the server: each call needs a name of its own.
             const answers = {
               resolveMx: await inFlight("resolveMx", () => Bun.dns.resolveMx("mx.pending.test")),
               resolveTxt: await inFlight("resolveTxt", () => Bun.dns.resolveTxt("txt.pending.test")),
               reverse: await inFlight("reverse", () => Bun.dns.reverse("192.0.2.7")),
               lookupService: (await inFlight("lookupService", () => Bun.dns.lookupService("192.0.2.8", 80))).map(
                 answer => answer[0],
               ),
               "c-ares lookup": (
                 await inFlight("c-ares lookup", () => Bun.dns.lookup("a5.pending.test.", { backend: "c-ares", family: 4 }))
               ).map(answer => answer.map(record => record.address)),
               lookup: (await inFlight("lookup", () => Bun.dns.lookup("localhost", { family: 4 }))).map(
                 answer => answer[0].address,
               ),
             };
             delete Array.prototype.then;
             console.log(JSON.stringify({ collectionsPerCall, answers }));
           })();`,
          String(port),
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        // Three settles and the list that Promise.all resolves with.
        collectionsPerCall: {
          resolveMx: 4,
          resolveTxt: 4,
          reverse: 4,
          lookupService: 4,
          "c-ares lookup": 4,
          lookup: 4,
        },
        answers: {
          resolveMx: Array(3).fill([
            { priority: 20, exchange: "mx20.pending.test" },
            { priority: 10, exchange: "mx10.pending.test" },
          ]),
          resolveTxt: Array(3).fill([["hi"]]),
          reverse: Array(3).fill(["ptr.pending.test"]),
          lookupService: Array(3).fill("ptr.pending.test"),
          "c-ares lookup": Array(3).fill(["10.0.0.5"]),
          lookup: Array(3).fill("127.0.0.1"),
        },
      });
      expect(exitCode).toBe(0);
      expect(queries).toEqual([
        "MX mx.pending.test",
        "TXT txt.pending.test",
        "PTR 7.2.0.192.in-addr.arpa",
        "PTR 8.2.0.192.in-addr.arpa",
        "A a5.pending.test",
      ]);
    } finally {
      socket.close();
    }
  });

  // A worker that asked for its own exit still reads the replies that are
  // already there. The conversion for the first caller of the MX query meets
  // the termination: no later caller of that query is converted or settled.
  // A settle reads the answer's "then", which this getter counts. The TXT
  // query has one caller and a reply of its own, and is still settled.
  test.concurrent("after a termination the rest of a chain settles nobody", async () => {
    const state = new Int32Array(new SharedArrayBuffer(12)); // the gate, settled MX answers, settled TXT answers
    let replies = 0;
    const { socket, queries, port } = await startFakeServer(() => {
      if (++replies !== 2) return;
      Atomics.store(state, 0, 1);
      Atomics.notify(state, 0);
    });
    try {
      const worker = new Worker(
        `const { port, state } = require("node:worker_threads").workerData;
         require("node:dns").setServers(["127.0.0.1:" + port]);
         Object.defineProperty(Array.prototype, "then", {
           get() {
             if (this[0]?.exchange) Atomics.add(state, 1, 1);
             else if (Array.isArray(this[0])) Atomics.add(state, 2, 1);
           },
         });
         setImmediate(() => {
           for (let i = 0; i < 3; i++) Bun.dns.resolveMx("mx.pending.test");
           Bun.dns.resolveTxt("txt.pending.test");
           Atomics.wait(state, 0, 0); // until both replies have left the server
           process.reallyExit(0); // in a worker: asks for the termination and returns
         });`,
        { eval: true, workerData: { port, state } },
      );
      const [exitCode] = await once(worker, "exit");
      expect({ settled: { mx: Atomics.load(state, 1), txt: Atomics.load(state, 2) }, queries, exitCode }).toEqual({
        settled: { mx: 0, txt: 1 },
        queries: ["MX mx.pending.test", "TXT txt.pending.test"],
        exitCode: 0,
      });
    } finally {
      socket.close();
    }
  });
});

// The socket never answers. The QTYPE that reaches it and the syscall the
// cancelled query reports pin resolve()'s rrtype dispatch to the query that
// resolveNaptr() issues; decoding is covered by the resolveNaptr() tests.
test.concurrent.each(["NAPTR", "naptr"])("resolve(hostname, %p) issues a NAPTR query", async rrtype => {
  const socket = dgram.createSocket("udp4");
  try {
    socket.bind(0, "127.0.0.1");
    await once(socket, "listening");
    const resolver = new dns_promises.Resolver();
    resolver.setServers(["127.0.0.1:" + socket.address().port]);
    const received = once(socket, "message");
    const promise = resolver.resolve("naptr.example.test", rrtype);
    const [query] = await received;
    // QNAME ends at the first zero byte after the 12-byte header; QTYPE follows it.
    expect(query.readUInt16BE(query.indexOf(0, 12) + 1)).toBe(35);
    resolver.cancel();
    expect(await promise.catch(err => err)).toMatchObject({ code: "ECANCELLED", syscall: "queryNaptr" });
  } finally {
    socket.close();
  }
});

// dns.lookup() is getaddrinfo(3). Node reports a temporary resolver failure
// (every nameserver timed out or answered SERVFAIL) as `EAI_AGAIN` with
// libuv's errno, and retry libraries key on that code. Bun used to report it
// as the c-ares code `ETIMEOUT`. CI cannot point getaddrinfo at a failing
// resolver, so this drives the same mapping the system backend, fetch() and
// Bun.connect() use with the raw EAI_* status.
describe("getaddrinfo status mapping", () => {
  test("EAI_AGAIN is reported as EAI_AGAIN, like Node", () => {
    const err = dnsGetaddrinfoError("EAI_AGAIN", "redis.example");
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({
      message: "getaddrinfo EAI_AGAIN redis.example",
      code: "EAI_AGAIN",
      errno: -3001,
      syscall: "getaddrinfo",
      hostname: "redis.example",
    });
  });

  test("EAI_NONAME is still reported as ENOTFOUND, like Node", () => {
    expect(dnsGetaddrinfoError("EAI_NONAME", "redis.example")).toMatchObject({
      message: "getaddrinfo ENOTFOUND redis.example",
      code: "ENOTFOUND",
      syscall: "getaddrinfo",
      hostname: "redis.example",
    });
  });
});

it("argument validation errors name the argument", () => {
  const message = fn => {
    try {
      fn();
    } catch (e) {
      return e.message;
    }
  };
  expect({
    all: message(() => dns.lookup("localhost", { all: 1 }, () => {})),
    verbatim: message(() => dns.lookup("localhost", { verbatim: 1 }, () => {})),
    ipv4: message(() => new dns.Resolver().setLocalAddress(1)),
    ipv6: message(() => new dns.Resolver().setLocalAddress("127.0.0.1", 1)),
    lookupService: message(() => dns.lookupService(1, 80, () => {})),
    promisesLookupService: message(() => dns.promises.lookupService(1, 80)),
  }).toEqual({
    all: 'The "options.all" property must be of type boolean. Received type number (1)',
    verbatim: 'The "options.verbatim" property must be of type boolean. Received type number (1)',
    ipv4: 'The "ipv4" argument must be of type string. Received type number (1)',
    ipv6: 'The "ipv6" argument must be of type string. Received type number (1)',
    lookupService: "The argument 'address' is invalid. Received 1",
    promisesLookupService: "The argument 'address' is invalid. Received 1",
  });
});
