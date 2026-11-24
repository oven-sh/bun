import { dnsGetaddrinfoError } from "bun:internal-for-testing";
import { beforeAll, describe, expect, it, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, bunRun, isLinux, isWindows, runWithError, tempDir } from "harness";
import * as dgram from "node:dgram";
import * as dns from "node:dns";
import * as dns_promises from "node:dns/promises";
import { once } from "node:events";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
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

// RFC 2782 (SRV) and RFC 3403 (NAPTR) say the names in RDATA must not be
// compressed, but a lot of deployed resolvers (dnsmasq, mDNSResponder, older
// BIND, various corporate forwarders) still compress them, and RFC 3597
// section 4 says to accept that.
//
// Serves one answer of the given type for every query. The answer's RDATA is
// built by `rdata`, which receives a compression pointer to QNAME so the name
// it emits decompresses to <label>.<query-name>.
async function withCompressedAnswerServer(type, rdata, fn) {
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

      const body = rdata(Buffer.from([0xc0, 0x0c])); // pointer -> QNAME at offset 12
      const answer = Buffer.concat([
        Buffer.from([0xc0, 0x0c, 0x00, type, 0x00, 0x01, 0x00, 0x00, 0x00, 0x3c]),
        Buffer.from([body.length >> 8, body.length & 0xff]),
        body,
      ]);
      socket.send(Buffer.concat([header, question, answer]), rinfo.port, rinfo.address);
    });
    socket.bind(0, "127.0.0.1");
    await once(socket, "listening");
    const { port } = socket.address();

    const resolver = new dns.Resolver({ timeout: 1000, tries: 1 });
    resolver.setServers(["127.0.0.1:" + port]);
    return await fn(resolver);
  } finally {
    socket.close();
  }
}

test.skipIf(isWindows)("dns.resolveSrv accepts compressed target in RDATA", async () => {
  // priority=10, weight=50, port=80, target = "srv" + pointer to QNAME.
  // After decompression the target is srv.<query-name>.
  const rdata = ptr => Buffer.concat([Buffer.from([0x00, 0x0a, 0x00, 0x32, 0x00, 0x50, 0x03, 0x73, 0x72, 0x76]), ptr]);
  const records = await withCompressedAnswerServer(0x21, rdata, resolver => {
    const { promise, resolve, reject } = Promise.withResolvers();
    resolver.resolveSrv("_test._tcp.example.test", (err, records) => (err ? reject(err) : resolve(records)));
    return promise;
  });
  expect(records).toEqual([{ name: "srv._test._tcp.example.test", priority: 10, weight: 50, port: 80 }]);
});

test.skipIf(isWindows)("dns.resolveNaptr accepts compressed replacement in RDATA", async () => {
  // order=100, preference=10, flags="s", service="SIP+D2T", regexp="",
  // replacement = "sip" + pointer to QNAME.
  const rdata = ptr =>
    Buffer.concat([
      Buffer.from([0x00, 0x64, 0x00, 0x0a]),
      Buffer.from([0x01, 0x73]), // "s"
      Buffer.from([0x07, 0x53, 0x49, 0x50, 0x2b, 0x44, 0x32, 0x54]), // "SIP+D2T"
      Buffer.from([0x00]), // ""
      Buffer.from([0x03, 0x73, 0x69, 0x70]), // "sip"
      ptr,
    ]);
  const records = await withCompressedAnswerServer(0x23, rdata, resolver => {
    const { promise, resolve, reject } = Promise.withResolvers();
    resolver.resolveNaptr("naptr.example.test", (err, records) => (err ? reject(err) : resolve(records)));
    return promise;
  });
  expect(records).toEqual([
    { flags: "s", service: "SIP+D2T", regexp: "", replacement: "sip.naptr.example.test", order: 100, preference: 10 },
  ]);
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
// resolver, not the "c-ares" backend, which reads /etc/resolv.conf directly and bypasses
// NSS/systemd-resolved on split-DNS hosts (#37378). "127.1" is a legacy IPv4
// literal: getaddrinfo resolves it locally with no DNS traffic, while "c-ares"
// does not, and its configured servers are a local
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

// On Windows, the resolver closes the UDP socket from inside its uv_poll_t's poll callback. A nested uv_run
// must not run the close callback that frees the handle while libuv is still dispatching to it.
test("dns.Resolver: a query's promise reaction can re-enter the event loop", async () => {
  const rounds = 20;
  const fixture = `
    const dns = require("node:dns");
    // Echoes the question back with one A record.
    function answer(query) {
      let off = 12;
      while (off < query.length && query[off] !== 0) off += query[off] + 1;
      off += 1 + 2 + 2;
      const header = Buffer.alloc(12);
      header[0] = query[0];
      header[1] = query[1];
      header[2] = 0x81; // QR=1, RD=1
      header[3] = 0x80; // RA=1
      header[5] = 1; // QDCOUNT
      header[7] = 1; // ANCOUNT
      const record = Buffer.from([
        0xc0, 0x0c, // NAME: pointer to the question name
        0x00, 0x01, // TYPE A
        0x00, 0x01, // CLASS IN
        0x00, 0x00, 0x00, 0x3c, // TTL 60
        0x00, 0x04, // RDLENGTH
        127, 0, 0, 1,
      ]);
      return Buffer.concat([header, query.subarray(12, off), record]);
    }
    const server = await Bun.udpSocket({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data(sock, buf, port, addr) { sock.send(answer(Buffer.from(buf)), port, addr); } },
    });
    const resolver = new dns.promises.Resolver({ timeout: 5000, tries: 1 });
    resolver.setServers(["127.0.0.1:" + server.port]);

    const { runEventLoopUntil } = require("bun:internal-for-testing");
    let reentries = 0;

    // Each round uses a new name, because the resolver answers a repeated name from its cache without opening a socket.
    for (let i = 0; i < ${rounds}; i++) {
      const addresses = await resolver.resolve4("round" + i + ".example.test").then(addresses => {
        runEventLoopUntil(new Promise(setImmediate).then(() => reentries++));
        return addresses;
      });
      if (addresses[0] !== "127.0.0.1") throw new Error("unexpected answer: " + addresses);
    }
    server.close();
    console.log("reentries=" + reentries);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: `reentries=${rounds}\n`, stderr: "", exitCode: 0 });
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

function encodeName(name) {
  const labels = name === "" ? [] : name.split(".");
  return Buffer.concat([
    ...labels.map(label => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)])),
    Buffer.from([0]),
  ]);
}

// A resolver keeps a 32-slot pending cache per query kind. The first in-flight
// query for a name owns a slot; identical queries issued in the same turn of the
// loop are chained onto it and settled together when it completes, so the server
// sees one query per distinct name. Queries issued while all 32 slots are taken
// get no slot and settle on their own. The fake server below records every
// query it receives and answers an A query for "a<n>.pending.test" with
// 10.0.0.<n>, so a promise settled from the wrong slot shows up as the wrong
// address.
describe("pending cache", () => {
  async function startFakeServer() {
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
      queries.push(`${qtype === 1 ? "A" : qtype === 12 ? "PTR" : qtype} ${qname}`);

      const rdata =
        qtype === 1 ? Buffer.from([10, 0, 0, Number(/\d+/.exec(labels[0])[0])]) : encodeName("ptr.pending.test");
      const header = Buffer.from([query[0], query[1], 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0]);
      const answer = Buffer.from([0xc0, 0x0c, 0, qtype, 0, 1, 0, 0, 0, 60, rdata.length >> 8, rdata.length & 0xff]);
      socket.send(Buffer.concat([header, question, answer, rdata]), rinfo.port, rinfo.address);
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
  // dot keeps it from also trying the host's search domains.
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
});

describe("resolve record types", () => {
  const NAME = "rr.example.test";
  // prettier-ignore
  const WIRE = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, NAPTR: 35, ANY: 255, CAA: 257 };

  function u16(n) {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(n);
    return b;
  }
  function u32(n) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  }
  function charString(s) {
    return Buffer.concat([Buffer.from([Buffer.byteLength(s)]), Buffer.from(s)]);
  }
  // One answer RR: <owner> 60 IN <rrtype> <rdata>
  function rr(owner, rrtype, rdata) {
    return Buffer.concat([encodeName(owner), u16(WIRE[rrtype]), u16(1), u32(60), u16(rdata.length), rdata]);
  }

  const aRdata = Buffer.from([10, 0, 0, 1]);
  const mxRdata = Buffer.concat([u16(10), encodeName("mx.example.test")]);
  const soaRdata = Buffer.concat([
    encodeName("ns1.example.test"),
    encodeName("hostmaster.example.test"),
    u32(2024010101),
    u32(7200),
    u32(900),
    u32(1209600),
    u32(300),
  ]);

  // `method` and resolve(name, rrtype) both return `expected`, unless there is a `methodExpected`.
  const cases = [
    {
      rrtype: "A",
      syscall: "queryA",
      answers: owner => [rr(owner, "A", aRdata)],
      method: (r, name) => r.resolve4(name, { ttl: true }),
      expected: ["10.0.0.1"],
      methodExpected: [{ address: "10.0.0.1", ttl: 60 }],
    },
    {
      rrtype: "AAAA",
      syscall: "queryAaaa",
      answers: owner => [rr(owner, "AAAA", Buffer.from("20010db8000000000000000000000001", "hex"))],
      method: (r, name) => r.resolve6(name, { ttl: true }),
      expected: ["2001:db8::1"],
      methodExpected: [{ address: "2001:db8::1", ttl: 60 }],
    },
    {
      rrtype: "CNAME",
      syscall: "queryCname",
      answers: owner => [
        rr(owner, "CNAME", encodeName("canonical.example.test")),
        rr("canonical.example.test", "A", aRdata),
      ],
      method: (r, name) => r.resolveCname(name),
      expected: ["canonical.example.test"],
    },
    {
      rrtype: "NS",
      syscall: "queryNs",
      answers: owner => [
        rr(owner, "NS", encodeName("ns1.example.test")),
        rr(owner, "NS", encodeName("ns2.example.test")),
      ],
      method: (r, name) => r.resolveNs(name),
      expected: ["ns1.example.test", "ns2.example.test"],
    },
    {
      rrtype: "PTR",
      syscall: "queryPtr",
      answers: owner => [rr(owner, "PTR", encodeName("host.example.test"))],
      method: (r, name) => r.resolvePtr(name),
      expected: ["host.example.test"],
    },
    {
      rrtype: "MX",
      syscall: "queryMx",
      answers: owner => [rr(owner, "MX", mxRdata)],
      method: (r, name) => r.resolveMx(name),
      expected: [{ priority: 10, exchange: "mx.example.test" }],
    },
    {
      rrtype: "TXT",
      syscall: "queryTxt",
      answers: owner => [rr(owner, "TXT", charString("v=spf1 -all"))],
      method: (r, name) => r.resolveTxt(name),
      expected: [["v=spf1 -all"]],
    },
    {
      rrtype: "SRV",
      syscall: "querySrv",
      answers: owner => [rr(owner, "SRV", Buffer.concat([u16(10), u16(5), u16(8080), encodeName("srv.example.test")]))],
      method: (r, name) => r.resolveSrv(name),
      expected: [{ name: "srv.example.test", priority: 10, weight: 5, port: 8080 }],
    },
    {
      rrtype: "NAPTR",
      syscall: "queryNaptr",
      answers: owner => [
        rr(
          owner,
          "NAPTR",
          Buffer.concat([u16(1), u16(12), charString("S"), charString("SIP+D2T"), charString(""), encodeName("")]),
        ),
      ],
      method: (r, name) => r.resolveNaptr(name),
      expected: [{ flags: "S", service: "SIP+D2T", regexp: "", replacement: "", order: 1, preference: 12 }],
    },
    {
      rrtype: "SOA",
      syscall: "querySoa",
      answers: owner => [rr(owner, "SOA", soaRdata)],
      method: (r, name) => r.resolveSoa(name),
      expected: {
        nsname: "ns1.example.test",
        hostmaster: "hostmaster.example.test",
        serial: 2024010101,
        refresh: 7200,
        retry: 900,
        expire: 1209600,
        minttl: 300,
      },
    },
    {
      rrtype: "CAA",
      syscall: "queryCaa",
      answers: owner => [
        rr(owner, "CAA", Buffer.concat([Buffer.from([0]), charString("issue"), Buffer.from("ca.example.test")])),
      ],
      method: (r, name) => r.resolveCaa(name),
      expected: [{ critical: 0, issue: "ca.example.test" }],
    },
    {
      rrtype: "ANY",
      syscall: "queryAny",
      answers: owner => [rr(owner, "A", aRdata), rr(owner, "MX", mxRdata)],
      method: (r, name) => r.resolveAny(name),
      expected: [
        { address: "10.0.0.1", ttl: 60, type: "A" },
        { priority: 10, exchange: "mx.example.test", type: "MX" },
      ],
    },
  ];
  const byType = Object.fromEntries(cases.map(c => [c.rrtype, c]));

  // `answersFor` returns the answers or an rcode. No answers is NXDOMAIN.
  function respond(query, queries, answersFor = (qname, rrtype) => byType[rrtype].answers(qname)) {
    const labels = [];
    let off = 12;
    while (query[off] !== 0) {
      labels.push(query.toString("latin1", off + 1, off + 1 + query[off]));
      off += query[off] + 1;
    }
    const rrtype = Object.keys(WIRE).find(rrtype => WIRE[rrtype] === query.readUInt16BE(off + 1));
    const qname = labels.join(".");
    queries.push(`${rrtype} ${qname || "."}`);

    const result = answersFor(qname, rrtype);
    const [rcode, answers] = typeof result === "number" ? [result, []] : [result.length ? 0 : 3, result];
    const header = [query.subarray(0, 2), u16(0x8180 | rcode), u16(1), u16(answers.length), u32(0)];
    return Buffer.concat([...header, query.subarray(12, off + 5), ...answers]);
  }

  async function startFakeServer(answersFor) {
    const socket = dgram.createSocket("udp4");
    const queries = [];
    const seen = new Set();
    socket.on("message", (query, rinfo) => {
      // A datagram that is repeated keeps its id.
      const isRepeated = seen.size === seen.add(query.toString("hex")).size;
      socket.send(respond(query, isRepeated ? [] : queries, answersFor), rinfo.port, rinfo.address);
    });
    socket.bind(0, "127.0.0.1");
    await once(socket, "listening");
    const resolver = new dns_promises.Resolver({ timeout: 5000, tries: 1 });
    resolver.setServers(["127.0.0.1:" + socket.address().port]);
    return { socket, queries, resolver };
  }

  test.concurrent("each type goes out as its own RR type and decodes into its own shape", async () => {
    const { socket, queries, resolver } = await startFakeServer();
    try {
      // One name for all: the two calls of a type share a query, and two types must not.
      const results = await Promise.all(
        cases.map(async c => {
          return [c.rrtype, await Promise.all([resolver.resolve(NAME, c.rrtype), c.method(resolver, NAME)])];
        }),
      );
      expect(Object.fromEntries(results)).toEqual(
        Object.fromEntries(cases.map(c => [c.rrtype, [c.expected, c.methodExpected ?? c.expected]])),
      );
      expect(queries.sort()).toEqual(cases.map(c => `${c.rrtype} ${NAME}`).sort());
    } finally {
      socket.close();
    }
  });

  test.concurrent("each type names its own syscall in errors", async () => {
    const { socket, queries, resolver } = await startFakeServer(() => []);
    try {
      const errors = await Promise.all(
        cases.map(c =>
          c.method(resolver, NAME).then(
            result => result,
            err => ({ code: err.code, syscall: err.syscall, hostname: err.hostname }),
          ),
        ),
      );
      expect(errors).toEqual(cases.map(c => ({ code: "ENOTFOUND", syscall: c.syscall, hostname: NAME })));
      expect(queries.sort()).toEqual(cases.map(c => `${c.rrtype} ${NAME}`).sort());
    } finally {
      socket.close();
    }
  });

  test.concurrent("resolveNs('') and resolveSoa('') query the root zone", async () => {
    const { socket, queries, resolver } = await startFakeServer();
    try {
      const [ns, soa] = await Promise.all([resolver.resolveNs(""), resolver.resolveSoa("")]);
      expect(ns).toEqual(byType.NS.expected);
      expect(soa).toEqual(byType.SOA.expected);
      expect(queries.sort()).toEqual(["NS .", "SOA ."]);
    } finally {
      socket.close();
    }
  });

  test.concurrent.each([
    { withCname: "nothing else", records: [], expected: [] },
    {
      withCname: "an address",
      records: [rr("c.test", "A", aRdata)],
      expected: [{ address: "10.0.0.1", ttl: 60, type: "A" }],
    },
    {
      withCname: "an MX",
      records: [rr("c.test", "MX", mxRdata)],
      expected: [{ priority: 10, exchange: "mx.example.test", type: "MX" }],
    },
  ])("resolveAny() has no holes for a CNAME and $withCname", async ({ records, expected }) => {
    const { socket, resolver } = await startFakeServer(qname => [rr(qname, "CNAME", encodeName("c.test")), ...records]);
    try {
      expect(await resolver.resolveAny(NAME)).toStrictEqual(expected);
    } finally {
      socket.close();
    }
  });

  // lookupService() asks the servers of the default resolver.
  test.concurrent("lookupService() names the address in its error, and asks once for all ports", async () => {
    const { socket, queries } = await startFakeServer(qname =>
      qname === "1.2.0.192.in-addr.arpa" ? byType.PTR.answers(qname) : [],
    );
    try {
      const script = `
        const dns = require("node:dns");
        dns.setServers(["127.0.0.1:${socket.address().port}"]);
        const services = [61001, 61002, 61001].map(port => dns.promises.lookupService("192.0.2.1", port));
        for (const { service } of await Promise.all(services)) console.log(service);
        const { message, hostname } = await dns.promises.lookupService("192.0.2.2", 80).catch(e => e);
        console.log(message, hostname);
      `;
      // The longest that it waits before it asks again.
      expect(await bunRun(["-e", script], { RES_OPTIONS: "timeout:5" })).toSpawn(
        "61001\n61002\n61001\ngetnameinfo ENOTFOUND 192.0.2.2 192.0.2.2",
      );
      expect(queries).toEqual(["PTR 1.2.0.192.in-addr.arpa", "PTR 2.2.0.192.in-addr.arpa"]);
    } finally {
      socket.close();
    }
  });

  test.concurrent.each([
    [0, "ENODATA"],
    [1, "EFORMERR"],
    [2, "ESERVFAIL"],
    [3, "ENOTFOUND"],
    [4, "ENOTIMP"],
    [5, "EREFUSED"],
  ])("rcode %d without answers is %s", async (rcode, code) => {
    const { socket, resolver } = await startFakeServer(() => rcode);
    try {
      expect(await resolver.resolve4(NAME).catch(err => err.code)).toBe(code);
    } finally {
      socket.close();
    }
  });

  test.concurrent.each([
    ["A", []],
    ["AAAA", []],
    ["CAA", []],
    ["MX", []],
    ["NAPTR", []],
    ["NS", "ENODATA"],
    ["PTR", "ENODATA"],
    ["SOA", "EBADRESP"],
    ["SRV", []],
    ["TXT", []],
  ])("%s of an alias whose target has none is %j", async (rrtype, expected) => {
    const { socket, resolver } = await startFakeServer(qname => [rr(qname, "CNAME", encodeName("c.test"))]);
    try {
      expect(await resolver.resolve(NAME, rrtype).catch(err => err.code)).toEqual(expected);
    } finally {
      socket.close();
    }
  });

  // https://github.com/oven-sh/bun/issues/44777
  test.concurrent("a record shows as soon as the server has it", async () => {
    let exists = false;
    const { socket, resolver } = await startFakeServer(qname => (exists ? byType.TXT.answers(qname) : 0));
    try {
      expect(await resolver.resolveTxt(NAME).catch(err => err.code)).toBe("ENODATA");
      exists = true;
      expect(await resolver.resolveTxt(NAME)).toEqual(byType.TXT.expected);
    } finally {
      socket.close();
    }
  });

  test.concurrent("the regexp of a NAPTR record is UTF-8", async () => {
    const rdata = [u16(1), u16(2), charString("U"), charString("E2U"), charString("!.*!é!"), encodeName("")];
    const { socket, resolver } = await startFakeServer(qname => [rr(qname, "NAPTR", Buffer.concat(rdata))]);
    try {
      expect(await resolver.resolveNaptr(NAME)).toEqual([
        { flags: "U", service: "E2U", regexp: "!.*!é!", replacement: "", order: 1, preference: 2 },
      ]);
    } finally {
      socket.close();
    }
  });

  test.concurrent("the strings of a TXT record stay together", async () => {
    const records = [["a", "", "b"], ["c"]];
    const { socket, resolver } = await startFakeServer(qname =>
      records.map(strings => rr(qname, "TXT", Buffer.concat(strings.map(charString)))),
    );
    try {
      expect(await Promise.all([resolver.resolveTxt(NAME), resolver.resolveAny(NAME)])).toEqual([
        records,
        records.map(entries => ({ entries, type: "TXT" })),
      ]);
    } finally {
      socket.close();
    }
  });

  test.concurrent("resolve4() has the ttl of each of 260 addresses", async () => {
    const addresses = Array.from({ length: 260 }, (_, i) => [10, 0, i >> 8, i & 255]);
    const { socket, resolver } = await startFakeServer(qname => addresses.map(it => rr(qname, "A", Buffer.from(it))));
    try {
      expect(await resolver.resolve4(NAME, { ttl: true })).toEqual(
        addresses.map(it => ({ address: it.join("."), ttl: 60 })),
      );
    } finally {
      socket.close();
    }
  });

  test.concurrent("150 queries at once get their own answers", async () => {
    const { socket, resolver } = await startFakeServer(qname => [rr(qname, "PTR", encodeName("to." + qname))]);
    try {
      const names = Array.from({ length: 150 }, (_, i) => `${i}.test`);
      expect(await Promise.all(names.map(name => resolver.resolvePtr(name)))).toEqual(
        names.map(name => ["to." + name]),
      );
    } finally {
      socket.close();
    }
  });

  test.concurrent("the next server is asked if nothing listens on the first", async () => {
    const [gone, { socket, resolver: other }] = await Promise.all([startFakeServer(), startFakeServer()]);
    const servers = [...gone.resolver.getServers(), ...other.getServers()];
    await new Promise(closed => gone.socket.close(closed));
    try {
      const resolver = new dns_promises.Resolver({ timeout: 250 });
      resolver.setServers(servers);
      expect(await resolver.resolve4(NAME)).toEqual(byType.A.expected);
      expect(resolver.getServers()).toEqual(servers.toReversed());
    } finally {
      socket.close();
    }
  });

  const manyNames = Array.from({ length: 24 }, (_, i) => `${i}.test`);

  // Nothing is answered until all of them were asked twice.
  function afterALoss() {
    const lost = new Set();
    const replies = new Map();
    return (query, send) => {
      const question = query.toString("latin1", 12);
      if (!lost.has(question)) return lost.add(question);
      replies.set(question, () => send(respond(query, [])));
      if (replies.size === manyNames.length) for (const reply of replies.values()) reply();
    };
  }

  function resolverFor(...servers) {
    const resolver = new dns_promises.Resolver({ timeout: 500, tries: 6 });
    resolver.setServers(servers.map(it => "127.0.0.1:" + it.address().port));
    return resolver;
  }

  async function resolveMany(resolver) {
    expect(await Promise.all(manyNames.map(name => resolver.resolve4(name).catch(err => err.code)))).toEqual(
      manyNames.map(() => byType.A.expected),
    );
  }

  test.concurrent("many lost queries are asked again if the first server takes no datagrams", async () => {
    const [{ socket: closed }, { socket }] = await Promise.all([startFakeServer(), startFakeServer()]);
    const answer = afterALoss();
    socket.removeAllListeners("message");
    socket.on("message", (query, rinfo) => answer(query, reply => socket.send(reply, rinfo.port, rinfo.address)));
    try {
      // It keeps its port, which is closed to all others.
      closed.connect(socket.address().port, "127.0.0.1");
      await once(closed, "connect");
      await resolveMany(resolverFor(closed, socket));
    } finally {
      closed.close();
      socket.close();
    }
  });

  test.concurrent("many lost queries are asked again if the first server takes no connections", async () => {
    const { socket: first } = await startFakeServer();
    const answer = afterALoss();
    await using server = net.createServer(socket => {
      let input = Buffer.alloc(0);
      socket.on("error", () => {});
      socket.on("data", chunk => {
        input = Buffer.concat([input, chunk]);
        while (input.length >= 2 && input.length >= 2 + input.readUInt16BE(0)) {
          const end = 2 + input.readUInt16BE(0);
          answer(input.subarray(2, end), reply => socket.write(Buffer.concat([u16(reply.length), reply])));
          input = input.subarray(end);
        }
      });
    });
    try {
      await once(server.listen(0, "127.0.0.1"), "listening");
      const resolver = resolverFor(first, server);
      await resolver.resolve4(NAME);
      first.removeAllListeners("message");
      first.on("message", (query, rinfo) => {
        // QR and TC
        query[2] |= 0x82;
        first.send(query, rinfo.port, rinfo.address);
      });
      await resolveMany(resolver);
    } finally {
      first.close();
    }
  });

  test.concurrent("fast answers do not shorten the timeout that was asked for", async () => {
    const { socket, resolver: other } = await startFakeServer();
    try {
      const resolver = new dns_promises.Resolver({ timeout: 60_000, tries: 1 });
      resolver.setServers(other.getServers());
      for (const name of ["a.test", "b.test", "c.test"]) await resolver.resolve4(name);
      const [answer] = socket.listeners("message");
      socket.off("message", answer);
      const slow = resolver.resolve4(NAME).catch(err => err.code);
      const query = await once(socket, "message");
      socket.on("message", answer);
      // An estimate from those three is over by then, which the resolver sees with the next answer.
      await Bun.sleep(300);
      await resolver.resolve4("d.test");
      answer(...query);
      expect(await slow).toEqual(byType.A.expected);
    } finally {
      socket.close();
    }
  });

  test.concurrent("a lost query is asked again long before a timeout of a minute", async () => {
    const { socket, resolver: other } = await startFakeServer();
    try {
      const resolver = new dns_promises.Resolver({ timeout: 60_000 });
      resolver.setServers(other.getServers());
      for (const name of ["a.test", "b.test", "c.test"]) await resolver.resolve4(name);
      const [answer] = socket.listeners("message");
      socket.off("message", answer);
      socket.once("message", () => socket.on("message", answer));
      expect(await resolver.resolve4(NAME)).toEqual(byType.A.expected);
    } finally {
      socket.close();
    }
  });

  test.concurrent("a lost query is asked again for those that come later", async () => {
    const { socket, resolver: other } = await startFakeServer();
    const calls = [];
    let timer;
    try {
      const resolver = new dns_promises.Resolver({ timeout: 60_000, tries: 1 });
      resolver.setServers(other.getServers());
      const [answer] = socket.listeners("message");
      socket.off("message", answer);
      socket.once("message", () => socket.on("message", answer));
      const call = () => calls.push(resolver.resolve4(NAME).catch(err => err.code));
      call();
      timer = setInterval(call, 20);
      await calls[0];
      clearInterval(timer);
      expect(await Promise.all(calls)).toEqual(calls.map(() => byType.A.expected));
    } finally {
      clearInterval(timer);
      socket.close();
    }
  });

  test.concurrent("queries that overlap share a socket", async () => {
    // SERVFAIL does not make the timeout any shorter.
    const { socket, resolver } = await startFakeServer(() => 2);
    const ask = name => resolver.resolve4(name).catch(err => err.code);
    const ports = new Set();
    try {
      const [answer] = socket.listeners("message");
      socket.off("message", answer);
      let last;
      // Each is answered once the next has come.
      socket.on("message", (...query) => {
        ports.add(query[1].port);
        if (last) answer(...last);
        last = query;
      });
      let pending = ask("first.test");
      for (let i = 0; i < 150; i++) {
        const next = ask(`${i}.test`);
        expect(await pending).toBe("ESERVFAIL");
        pending = next;
      }
      answer(...last);
      expect(await pending).toBe("ESERVFAIL");
      expect(ports.size).toBe(1);
    } finally {
      socket.close();
    }
  });

  test("all of 150 queries get to a server that has yet to answer", async () => {
    const { socket, resolver: other } = await startFakeServer();
    try {
      const resolver = new dns_promises.Resolver({ timeout: 1000, tries: 1 });
      resolver.setServers(other.getServers());
      const [answer] = socket.listeners("message");
      socket.off("message", answer);
      const names = Array.from({ length: 150 }, (_, i) => `${i}.test`);
      const queries = [];
      socket.on("message", (...query) => {
        if (queries.push(query) === names.length) for (const it of queries) answer(...it);
      });
      expect(await Promise.all(names.map(name => resolver.resolve4(name).catch(err => err.code)))).toEqual(
        names.map(() => byType.A.expected),
      );
    } finally {
      socket.close();
    }
  });

  test.concurrent("answers that have arrived are found among copies after the timeout", async () => {
    using dir = tempDir("dns-copies", {});
    const flag = path.join(String(dir), "sent");
    const { socket, resolver } = await startFakeServer();
    try {
      socket.removeAllListeners("message");
      let left = 60 * 4;
      socket.on("message", (query, { port, address }) => {
        for (let i = 0; i < 4; i++) socket.send(respond(query, []), port, address, () => --left || Bun.write(flag, ""));
      });
      const script = `
        const resolver = new dns.promises.Resolver({ timeout: 250, tries: 1 });
        resolver.setServers(${JSON.stringify(resolver.getServers())});
        const all = Array.from({ length: 60 }, (_, i) => resolver.resolve4(i + ".test").then(String, err => err.code));
        const deadline = Date.now() + 30_000;
        while (!fs.existsSync(${JSON.stringify(flag)}) && Date.now() < deadline) Bun.sleepSync(1);
        Bun.sleepSync(250);
        console.log(...new Set(await Promise.all(all)));
      `;
      expect(await bunRun(["-e", script])).toSpawn(String(byType.A.expected));
    } finally {
      socket.close();
    }
  });

  test.concurrent("an answer over TCP counts after the query was asked again", async () => {
    let answerFirst;
    await using server = net.createServer(socket => {
      socket.on("error", () => {});
      socket.on("data", chunk => {
        if (answerFirst) return answerFirst();
        const reply = respond(chunk.subarray(2), []);
        answerFirst = () => socket.write(Buffer.concat([u16(reply.length), reply]));
      });
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const script = `
      const resolver = new dns.promises.Resolver({ timeout: 250, tries: 6 });
      resolver.setServers(["127.0.0.1:${server.address().port}"]);
      console.log(await resolver.resolve4("${NAME}").then(String, err => err.code));
    `;
    expect(await bunRun(["-e", script], { RES_OPTIONS: "use-vc" })).toSpawn(String(byType.A.expected));
  });

  const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
  test.concurrent.skipIf(!isLinux || !cc)("a preloaded fopen() can supply the configuration", async () => {
    using dir = tempDir("dns-fopen", {
      "etc/resolv.conf": "nameserver 192.0.2.53\n",
      "etc/hosts": "192.0.2.80 from-the-file.test\n",
      "etc/nsswitch.conf": "hosts: files\n",
      "shim.c": `
        #define _GNU_SOURCE
        #include <dlfcn.h>
        #include <string.h>
        void *fopen(const char *path, const char *mode) {
          void *(*next)(const char *, const char *) = dlsym(RTLD_NEXT, "fopen");
          return next(strncmp(path, "/etc/", 5) ? path : path + 1, mode);
        }
      `,
    });
    const shim = path.join(String(dir), "shim.so");
    await Bun.$`${cc} -shared -fPIC -o ${shim} ${path.join(String(dir), "shim.c")} -ldl`.env(bunEnv).quiet();
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `console.log(...dns.getServers(), ...(await dns.promises.reverse("192.0.2.80")))`],
      env: { ...bunEnv, LD_PRELOAD: [shim, bunEnv.LD_PRELOAD].filter(Boolean).join(":") },
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "192.0.2.53 from-the-file.test\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent.skipIf(!isLinux || !cc)("the last descriptor is enough on a system without getrandom()", async () => {
    using dir = tempDir("dns-getrandom", {
      "shim.c": `
        #include <errno.h>
        long getrandom(void) { errno = ENOSYS; return -1; }
      `,
    });
    const shim = path.join(String(dir), "shim.so");
    await Bun.$`${cc} -shared -fPIC -o ${shim} ${path.join(String(dir), "shim.c")}`.env(bunEnv).quiet();
    const { socket, resolver } = await startFakeServer();
    try {
      const script = `
        const resolver = new dns.promises.Resolver({ timeout: 5000, tries: 1 });
        resolver.setServers(${JSON.stringify(resolver.getServers())});
        const taken = [];
        try {
          for (;;) taken.push(fs.openSync("/dev/null"));
        } catch {}
        fs.closeSync(taken.pop());
        console.log(String(await resolver.resolve4("${NAME}")));
      `;
      await using proc = Bun.spawn({
        cmd: ["sh", "-c", `ulimit -n 128 && exec "$@"`, "sh", bunExe(), "-e", script],
        env: { ...bunEnv, LD_PRELOAD: [shim, bunEnv.LD_PRELOAD].filter(Boolean).join(":") },
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: `${byType.A.expected}\n`, stderr: "", exitCode: 0 });
    } finally {
      socket.close();
    }
  });

  test.concurrent.each([
    { timeout: 250, tries: 1 },
    { timeout: 60_000, tries: 1, maxTimeout: 50 },
    { tries: 1, maxTimeout: 50 },
  ])("Resolver(%j) gives up within a second", async options => {
    const { socket, resolver: other } = await startFakeServer();
    socket.removeAllListeners("message");
    const late = Promise.withResolvers();
    let timer;
    try {
      const resolver = new dns_promises.Resolver(options);
      resolver.setServers(other.getServers());
      const query = resolver.resolve4(NAME).catch(err => err.code);
      timer = setTimeout(setImmediate, 900, late.resolve, "late");
      expect(await Promise.race([query, late.promise])).toBe("ETIMEOUT");
    } finally {
      clearTimeout(timer);
      socket.close();
    }
  });

  test.concurrent("Resolver makes as many tries as it is told to", async () => {
    const { socket, resolver: other } = await startFakeServer();
    const last = Promise.withResolvers();
    let tries = 0;
    socket.removeAllListeners("message");
    socket.on("message", message => (message.length === 1 ? last.resolve() : tries++));
    try {
      const resolver = new dns_promises.Resolver({ tries: 70, maxTimeout: 1 });
      resolver.setServers(other.getServers());
      expect(await resolver.resolve4(NAME).catch(err => err.code)).toBe("ETIMEOUT");
      socket.send("!", socket.address().port, "127.0.0.1");
      await last.promise;
      expect(tries).toBe(70);
    } finally {
      socket.close();
    }
  });

  test.concurrent("reverse() and setLocalAddress() drop the zone of an IPv6 address", async () => {
    const { socket, queries, resolver } = await startFakeServer(() => []);
    try {
      resolver.setLocalAddress("::1%lo");
      const { code, hostname } = await resolver.reverse("2001:db8::1%lo").catch(err => err);
      expect({ code, hostname }).toEqual({ code: "ENOTFOUND", hostname: "2001:db8::1%lo" });
      expect(queries).toEqual([`PTR 1.${"0.".repeat(23)}8.b.d.0.1.0.0.2.ip6.arpa`]);
      expect(await resolver._handle.reverse("2001:db8::1%\0").catch(err => err.code)).toBe("DNS_ENOTIMP");
    } finally {
      socket.close();
    }
  });

  // Not every system has all of 127.0.0.0/8 on its loopback interface.
  test.concurrent.skipIf(!isLinux)("queries come from the address given to setLocalAddress()", async () => {
    const { socket, resolver } = await startFakeServer();
    try {
      resolver.setLocalAddress("127.0.0.2");
      const [[, rinfo], addresses] = await Promise.all([once(socket, "message"), resolver.resolve4(NAME)]);
      expect([rinfo.address, addresses]).toEqual(["127.0.0.2", byType.A.expected]);
    } finally {
      socket.close();
    }
  });

  test.concurrent("RES_OPTIONS=use-vc sends the queries over one TCP connection", async () => {
    const strings = Array.from({ length: 200 }, (_, i) => Buffer.alloc(255, String(i)).toString());
    const answersFor = qname => [rr(qname, "TXT", Buffer.concat(strings.map(charString)))];
    const queries = [];
    let connections = 0;
    await using server = net.createServer(socket => {
      connections++;
      let input = Buffer.alloc(0);
      socket.on("error", () => {});
      socket.on("data", chunk => {
        input = Buffer.concat([input, chunk]);
        while (input.length >= 2 && input.length >= 2 + input.readUInt16BE(0)) {
          const end = 2 + input.readUInt16BE(0);
          const reply = respond(input.subarray(2, end), queries, answersFor);
          socket.write(u16(reply.length));
          socket.write(reply);
          input = input.subarray(end);
        }
      });
    });
    const gone = net.createServer();
    await Promise.all([server, gone].map(it => once(it.listen(0, "127.0.0.1"), "listening")));
    const gonePort = gone.address().port;
    await once(gone.close(), "close");
    const script = `
      const { Resolver } = require("node:dns/promises");
      const resolver = new Resolver({ timeout: 5000, tries: 1 });
      resolver.setServers(["127.0.0.1:${server.address().port}"]);
      for (const records of await Promise.all(["a.test", "b.test", "c.test"].map(name => resolver.resolveTxt(name))))
        console.log(Bun.hash(records.join()));
      resolver.setServers(["127.0.0.1:${gonePort}"]);
      console.log(await resolver.resolveTxt("a.test").catch(err => err.code));
    `;
    const hash = Bun.hash(strings.join()) + "n";
    expect(await bunRun(["-e", script], { RES_OPTIONS: "use-vc" })).toSpawn(
      [hash, hash, hash, "ECONNREFUSED"].join("\n"),
    );
    expect({ queries, connections }).toEqual({ queries: ["TXT a.test", "TXT b.test", "TXT c.test"], connections: 1 });
  });

  test.concurrent.each([
    { host: "one", env: {}, expected: ["A one.search.test", "A one"] },
    { host: "one.two", env: {}, expected: ["A one.two", "A one.two.search.test"] },
    { host: "one.two", env: { RES_OPTIONS: "ndots:2" }, expected: ["A one.two.search.test", "A one.two"] },
    { host: "one.", env: {}, expected: ["A one"] },
    { host: "no.data.", env: {}, expected: ["A no.data"] },
    { host: "Alias", env: {}, expected: ["A real.test"] },
    { host: "one.LocalHost", env: {}, expected: [], output: "127.0.0.1" },
  ])("Bun.dns.lookup($host) with $env asks for $expected", async ({ host, env, expected, output }) => {
    using dir = tempDir("dns-hostaliases", { aliases: "other other.test\nalias real.test\n" });
    const { socket, queries } = await startFakeServer(qname => (qname === "no.data" ? 0 : 3));
    try {
      const script = `
        require("node:dns").setServers(["127.0.0.1:${socket.address().port}"]);
        const lookup = Bun.dns.lookup("${host}", { backend: "c-ares", family: 4 });
        console.log(await lookup.then(([{ address }]) => address, err => err.code));
      `;
      const HOSTALIASES = path.join(String(dir), "aliases");
      env = { LOCALDOMAIN: "search.test", RES_OPTIONS: "ndots:1", HOSTALIASES, ...env };
      expect(await bunRun(["-e", script], env)).toSpawn(output ?? "DNS_ENOTFOUND");
      expect([...new Set(queries)]).toEqual(expected);
    } finally {
      socket.close();
    }
  });
});

describe('errors inherit the name "Error", like Node', () => {
  const viaCallback = (fn, argument) => new Promise(resolve => fn(argument, resolve));

  test.each([
    { api: "lookup", fail: () => viaCallback(dns.lookup, "a b"), string: "Error: getaddrinfo ENOTFOUND a b" },
    { api: "resolve4", fail: () => viaCallback(dns.resolve4, "a\0"), string: "Error: queryA ENOTFOUND a\0" },
    { api: "promises.resolve4", fail: () => dns_promises.resolve4("a b"), string: "Error: queryA ENOTFOUND a b" },
    { api: "reverse", fail: () => viaCallback(dns.reverse, "nope"), string: "Error: getHostByAddr EINVAL nope" },
    { api: "promises.reverse", fail: () => dns_promises.reverse("nope"), string: "Error: getHostByAddr EINVAL nope" },
  ])("$api", async ({ fail, string }) => {
    const err = await fail().catch(err => err);
    expect({ string: String(err), ownName: Object.hasOwn(err, "name") }).toEqual({ string, ownName: false });
  });

  test("in the first line of stack", async () => {
    const { stack } = await dns_promises.resolve4("a b").catch(err => err);
    expect(stack).toStartWith("Error: queryA ENOTFOUND a b\n");
  });

  test("lookup finds no address", async () => {
    const script = `
      Bun.dns.lookup = async () => [];
      const dns = require("node:dns");
      console.log(String(await dns.promises.lookup("a.test").catch(e => e)));
      dns.lookup("a.test", e => console.log(String(e)));
    `;
    expect(await bunRun(["-e", script])).toSpawn("Error: No records found\nError: getaddrinfo ENODATA a.test");
  });

  test("a sealed error keeps its name and still gets Node's code", async () => {
    const script = `
      const sealed = () => Object.seal(Object.assign(new Error("mocked"), { name: "DNSException", code: "DNS_ENOTFOUND" }));
      Bun.dns.lookup = async () => { throw sealed(); };
      const dns = require("node:dns");
      const show = e => console.log(String(e), e.code);
      show(await dns.promises.lookup("a.test").catch(e => e));
      dns.lookup("a.test", show);
    `;
    expect(await bunRun(["-e", script])).toSpawn("DNSException: mocked ENOTFOUND\nDNSException: mocked ENOTFOUND");
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

it.each(["nope", "", "10.0.0", "10.0.0.1/8", "10.0.0.1%lo", "[::1]"])(
  "%j is no address for reverse() and setLocalAddress()",
  async text => {
    const expected = {
      message: `getHostByAddr EINVAL ${text}`.trimEnd(),
      code: "EINVAL",
      errno: isWindows ? -4071 : -22,
      syscall: "getHostByAddr",
      ...(text && { hostname: text }),
    };
    const fields = err => ({ ...err, message: err.message });
    for (const resolver of [dns, new dns.Resolver()]) {
      expect(fields(runWithError(() => resolver.reverse(text, () => {})))).toEqual(expected);
    }
    for (const resolver of [dns_promises, new dns_promises.Resolver()]) {
      expect(await resolver.reverse(text).catch(fields)).toEqual(expected);
    }
    for (const addresses of [[text], ["::1", text]]) {
      expect(runWithError(() => new dns.Resolver().setLocalAddress(...addresses))).toMatchObject({
        name: "TypeError",
        code: "ERR_INVALID_ARG_VALUE",
        message: "Invalid IP address.",
      });
    }
  },
);

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
    name: [1, "\0"].flatMap(ip =>
      [dns, new dns.Resolver(), dns.promises, new dns.promises.Resolver()].map(it => message(() => it.reverse(ip))),
    ),
    localAddresses: [["\0"], ["127.0.0.1", "\0"]].flatMap(addresses =>
      [dns, dns.promises].map(({ Resolver }) => message(() => new Resolver().setLocalAddress(...addresses))),
    ),
    lookupService: message(() => dns.lookupService(1, 80, () => {})),
    promisesLookupService: message(() => dns.promises.lookupService(1, 80)),
    maxTimeout: ["1", -1, 2 ** 32, 0, 2 ** 32 - 1].map(maxTimeout => message(() => new dns.Resolver({ maxTimeout }))),
  }).toEqual({
    all: 'The "options.all" property must be of type boolean. Received type number (1)',
    verbatim: 'The "options.verbatim" property must be of type boolean. Received type number (1)',
    ipv4: 'The "ipv4" argument must be of type string. Received type number (1)',
    ipv6: 'The "ipv6" argument must be of type string. Received type number (1)',
    name: [
      ...Array(4).fill('The "name" argument must be of type string. Received type number (1)'),
      ...Array(4).fill("The argument 'name' must be a string without null bytes. Received '\\x00'"),
    ],
    localAddresses: [
      ...Array(2).fill("The argument 'ipv4' must be a string without null bytes. Received '\\x00'"),
      ...Array(2).fill("The argument 'ipv6' must be a string without null bytes. Received '\\x00'"),
    ],
    lookupService: "The argument 'address' is invalid. Received 1",
    promisesLookupService: "The argument 'address' is invalid. Received 1",
    maxTimeout: [
      `The "options.maxTimeout" property must be of type number. Received type string ('1')`,
      'The value of "options.maxTimeout" is out of range. It must be >= 0 && <= 4294967295. Received -1',
      'The value of "options.maxTimeout" is out of range. It must be >= 0 && <= 4294967295. Received 4294967296',
      undefined,
      undefined,
    ],
  });
});
