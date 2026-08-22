import { dns, type DNSLookup, type udp } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows } from "harness";
import { isIP } from "node:net";
import { join } from "node:path";

type Backend = "system" | "libc" | "c-ares";
const backends: Backend[] = ["system", "libc", "c-ares"];

// `Bun.dns.setServers()` configures the c-ares channel that the c-ares backend (and resolve(),
// lookupService(), ...) query, so beforeAll() below points it at this in-process server and the
// c-ares cases never touch a real resolver. Every name under FAKE_ZONE gets exactly FAKE_V4 and
// FAKE_V6 (documentation addresses, RFC 5737 / RFC 3849); every other name gets NXDOMAIN.
//
// The system and libc backends are the OS resolver (getaddrinfo / mDNSResponder / libuv), which
// cannot be redirected. They keep resolving localhost (hosts file) and example.com: a real name is
// the only way to run them against DNS records at all, and the Windows IPv6 behavior asserted
// below only exists for names that are not in the hosts file.
const FAKE_ZONE = "resolve-dns.test";
const FAKE_V4 = { address: "192.0.2.1", family: 4, ttl: 300 } as const;
const FAKE_V6 = { address: "2001:db8::1", family: 6, ttl: 600 } as const;
const FAKE_RDATA = {
  1: { ttl: FAKE_V4.ttl, rdata: Buffer.from([192, 0, 2, 1]) }, // A
  28: { ttl: FAKE_V6.ttl, rdata: Buffer.from("20010db8000000000000000000000001", "hex") }, // AAAA
} as Record<number, { ttl: number; rdata: Buffer } | undefined>;

function fakeDnsReply(query: Buffer): Buffer {
  const labels: string[] = [];
  let i = 12; // the question section follows the 12 byte header
  while (query[i] !== 0) {
    labels.push(query.toString("latin1", i + 1, i + 1 + query[i]));
    i += query[i] + 1;
  }
  const question = query.subarray(12, i + 5); // labels, root label, QTYPE, QCLASS
  const qtype = query.readUInt16BE(i + 1);
  const served = labels.join(".").toLowerCase().endsWith(FAKE_ZONE);
  const record = served ? FAKE_RDATA[qtype] : undefined;
  const rcode = served ? 0 : 3; // NOERROR (NODATA when the type is not A/AAAA) : NXDOMAIN
  const header = Buffer.from([query[0], query[1], 0x81, 0x80 | rcode, 0, 1, 0, record ? 1 : 0, 0, 0, 0, 0]);
  if (!record) return Buffer.concat([header, question]);
  const rr = Buffer.alloc(10);
  rr.writeUInt16BE(0xc00c, 0); // name: pointer to the question's name
  rr.writeUInt16BE(qtype, 2);
  rr.writeUInt16BE(1, 4); // class IN
  rr.writeUInt32BE(record.ttl, 6);
  const rdlength = Buffer.alloc(2);
  rdlength.writeUInt16BE(record.rdata.length);
  return Buffer.concat([header, question, rr, rdlength, record.rdata]);
}

let fakeDns: udp.Socket<"buffer">;

beforeAll(async () => {
  fakeDns = await Bun.udpSocket({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket, query, port, address) {
        socket.send(fakeDnsReply(query), port, address);
      },
    },
  });
  // @ts-expect-error setServers() is not declared in bun-types
  dns.setServers([[4, "127.0.0.1", fakeDns.port]]);
});

afterAll(() => {
  fakeDns.close();
});

expect.extend({
  toBeIPOfFamily(received: unknown, family: number) {
    const pass = (family === 4 || family === 6) && typeof received === "string" && isIP(received) === family;
    return {
      pass,
      message: () => `expected ${Bun.inspect(received)} ${pass ? "not " : ""}to be an IPv${family} address`,
    };
  },
});
declare module "bun:test" {
  interface AsymmetricMatchers {
    toBeIPOfFamily(family: number): void;
  }
  interface Matchers<T> {
    toBeIPOfFamily(family: number): void;
  }
}

type Family = 4 | 6;
// `address` and `ttl` are either literal values or asymmetric matchers such as expect.any(Number).
type Answer = { address: any; family: Family; ttl: any };
type Host =
  // The addresses come from a resolver this test does not control; only their shape is checked.
  | { name: string; answers: null }
  | {
      name: string;
      /** The exact answer a lookup restricted to that family returns. */
      answers: Record<Family, Answer>;
      /** The families a lookup that does not pick one must return; the other family may come along. */
      unspecified: Family[];
    };
type Wanted = Family | "both";

const LOOPBACK_V4: Answer = { address: "127.0.0.1", family: 4, ttl: expect.any(Number) };
const LOOPBACK_V6: Answer = { address: "::1", family: 6, ttl: expect.any(Number) };
// A lookup restricted to either family gets that loopback address everywhere, but whether an
// unrestricted one also yields ::1 depends on the hosts file: Debian's maps ::1 to localhost, Ubuntu's
// only to ip6-localhost, and the lookup stops at the hosts file's 127.0.0.1 there.
const LOCALHOST: Host = { name: "localhost", answers: { 4: LOOPBACK_V4, 6: LOOPBACK_V6 }, unspecified: [4] };
const FAKE_HOST: Host = { name: `host.${FAKE_ZONE}`, answers: { 4: FAKE_V4, 6: FAKE_V6 }, unspecified: [4, 6] };
const EXAMPLE_COM: Host = { name: "example.com", answers: null };
const hostsFor = (backend: Backend): Host[] => [LOCALHOST, backend === "c-ares" ? FAKE_HOST : EXAMPLE_COM];

type LookupOptions = NonNullable<Parameters<typeof dns.lookup>[1]>;

// [options, the family (or families) those options must produce]
const familyOptions: [LookupOptions, Wanted][] = [
  [{}, "both"],
  [{ family: 4 }, 4],
  [{ family: "IPv4" }, 4],
  [{ family: 6 }, 6],
  [{ family: "IPv6" }, 6],
  [{ family: 0 }, "both"],
  [{ family: "any" }, "both"],
];

function expectAnswers(result: DNSLookup[], host: Host, wanted: Wanted) {
  // Resolvers return the families in whichever order they like (c-ares sorts by reachability), and
  // glibc's getaddrinfo() answers an IPv4-only lookup of localhost with 127.0.0.1 twice (the
  // "::1 localhost" hosts line is mapped to it too), so compare the distinct answers in a fixed order.
  const distinct = [...new Map(result.map(answer => [`${answer.family} ${answer.address}`, answer])).values()].sort(
    (a, b) => a.family - b.family || a.address.localeCompare(b.address),
  );
  if (host.answers !== null) {
    // The required families plus whichever optional one was returned, so a missing required answer
    // and a wrong or unexpected address both show up in the diff.
    const families: Family[] =
      wanted === "both"
        ? [...new Set([...host.unspecified, ...distinct.map(answer => answer.family)])].sort((a, b) => a - b)
        : [wanted];
    expect(distinct).toEqual(families.map(family => host.answers[family]));
    return;
  }
  expect(distinct).not.toBeEmpty();
  expect(distinct).toEqual(
    distinct.map((answer): Answer => {
      const family = wanted === "both" ? answer.family : wanted;
      return { address: expect.toBeIPOfFamily(family), family, ttl: expect.any(Number) };
    }),
  );
}

/**
 * Resolves to the rejection reason of `promise`; fails the test if it fulfills.
 *
 * Not `expect(promise).rejects`: that matcher blocks in a nested event loop until the promise
 * settles, which keeps the concurrent tests below from overlapping. The slow cases in this file are
 * the negative lookups the OS resolver takes seconds to answer, so overlapping them is the point.
 */
function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    value => {
      throw new Error(`expected a rejection, resolved with ${Bun.inspect(value)}`);
    },
    reason => reason,
  );
}

const NOT_FOUND = {
  name: "DNSException",
  code: "DNS_ENOTFOUND",
  syscall: "getaddrinfo",
  message: "getaddrinfo ENOTFOUND",
};

// Well-formed, but under the TLD that RFC 6761 reserves for never existing, so a resolver can answer
// it without asking anyone's authoritative servers. The c-ares backend gets its NXDOMAINs from the
// fake server instantly, so it also exercises the search-list retries; the OS resolver gets the
// absolute form (trailing dot), because on the debian CI machines every negative round trip takes
// about 4s and the search-list retry would make this lookup the file's critical path.
const nonexistentHostname = (backend: Backend) =>
  backend === "c-ares" ? "does-not-exist.invalid" : "does-not-exist.invalid.";
const malformedHostnames = [" ", ".", " .", "localhost:80", "this is not a hostname"];

// getaddrinfo reports malformed names with whatever EAI code the platform picks, and bun maps the
// ones it does not know onto DNS_ENOTIMP. The c-ares backend rejects the malformed names itself
// (ARES_EBADNAME) and gets NXDOMAIN for "." from the fake server, so it is always ENOTFOUND.
const malformedCodes = (backend: Backend) =>
  backend === "c-ares" ? /^DNS_ENOTFOUND$/ : /^DNS_(ENOTFOUND|ESERVFAIL|ENOTIMP)$/;

describe("dns", () => {
  // Every lookup here is independent of the others, and only the slow ones (the OS resolver's
  // negative answers) decide how long the file takes, so the whole matrix runs concurrently.
  describe.concurrent.each(backends)("lookup() [backend: %s]", backend => {
    describe.each(hostsFor(backend))("$name", host => {
      test.each(familyOptions)("%j", async (options, wanted) => {
        const lookup = dns.lookup(host.name, { ...options, backend });
        // Matches node: on Windows, getaddrinfo() does not return AAAA records for names that are not
        // in the hosts file unless the machine has IPv6 connectivity, which the CI machines do not.
        if (isWindows && backend !== "c-ares" && wanted === 6 && host.answers === null) {
          expect(await rejectionOf(lookup)).toMatchObject(NOT_FOUND);
          return;
        }
        expectAnswers(await lookup, host, wanted);
      });

      test("10 lookups at once", async () => {
        const results = await Promise.all(Array.from({ length: 10 }, () => dns.lookup(host.name, { backend })));
        expect(results).toHaveLength(10);
        for (const result of results) expectAnswers(result, host, "both");
      });
    });

    test(`${nonexistentHostname(backend)} rejects with ENOTFOUND`, async () => {
      expect(await rejectionOf(dns.lookup(nonexistentHostname(backend), { backend }))).toMatchObject(NOT_FOUND);
    });

    test.each(malformedHostnames)("%j rejects", async hostname => {
      const error = (await rejectionOf(dns.lookup(hostname, { backend }))) as { code: string };
      expect(error).toMatchObject({
        name: "DNSException",
        code: expect.stringMatching(malformedCodes(backend)),
        syscall: "getaddrinfo",
        message: `getaddrinfo ${error.code.slice("DNS_".length)}`,
      });
    });

    // Hostnames longer than the fixed stack buffer used by the libc/system backends (bun.PathBuffer,
    // which is MAX_PATH_BYTES: 1024 on macOS, 4096 on Linux, ~98302 on Windows) previously overflowed
    // when writing the NUL terminator. They must reject cleanly on every backend. 100 000 bytes
    // exceeds the buffer on every platform so the doLookup guard is what fires.
    test("oversized hostname rejects", async () => {
      const long = Buffer.alloc(100_000, "a").toString();
      expect(await rejectionOf(dns.lookup(long, { backend }))).toMatchObject({
        ...NOT_FOUND,
        message: `getaddrinfo ENOTFOUND ${long}`,
        hostname: long,
      });
    });
  });

  test.concurrent("lookup() with oversized .local hostname rejects via system backend in subprocess", async () => {
    // A `.local` suffix forces the c-ares backend to fall through to the system resolver, which is
    // the path that wrote past its stack buffer. Run in a subprocess so the panic that the unfixed
    // debug build raises on the worker thread shows up as a non-zero exit instead of aborting the
    // whole test file.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const long = Buffer.alloc(100_000, "a").toString() + ".local";
          const settled = await Promise.allSettled([
            Bun.dns.lookup(long, { backend: "system" }),
            Bun.dns.lookup(long, { backend: "libc" }),
            Bun.dns.lookup(long),
          ]);
          console.log(JSON.stringify(settled.map(result => result.status === "rejected" ? result.reason.code : result.value)));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: JSON.stringify(["DNS_ENOTFOUND", "DNS_ENOTFOUND", "DNS_ENOTFOUND"]) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // The pending-host-cache slot holds a Box<[u8]> clone of the hostname so
  // concurrent lookups for the same name can coalesce. When process.exit()
  // tears the VM down (BUN_DESTRUCT_VM_ON_EXIT=1, set by the CI runner) while
  // a libc getaddrinfo is still on the work pool, the Resolver is dropped
  // with that slot still occupied. HiveArray used to skip Drop on its slots,
  // so the hostname Box leaked. Only observable via LSan, so ASAN-only.
  test.concurrent.skipIf(!isASAN || isWindows)(
    "pending-cache hostname is freed when VM tears down mid-lookup",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const net = require("net");
            const server = net.createServer(() => {});
            server.listen(0, "127.0.0.1", () => {
              const port = server.address().port;
              // node:net's connect("localhost") routes through Bun.dns.lookup
              // with the libc backend, which populates pending_host_cache_native.
              for (let i = 0; i < 20; i++) {
                const s = net.connect(port, "localhost");
                s.on("error", () => {});
                s.destroy();
              }
              process.exit(0);
            });
          `,
        ],
        env: {
          ...bunEnv,
          BUN_DESTRUCT_VM_ON_EXIT: "1",
          ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
          LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(import.meta.dirname, "../../../leaksan.supp")}`,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    },
    // LSan symbolizes the leak stack through llvm-symbolizer before the child
    // can exit, which is several seconds against the debug binary.
    30_000,
  );

  test.concurrent("lookup() ignores a non-object options argument", async () => {
    // @ts-expect-error a string is not a valid options argument; it used to crash instead of being ignored
    expectAnswers(await dns.lookup("localhost", "cat"), LOCALHOST, "both");
  });

  test.concurrent("lookup() with null flags treats them as unset", async () => {
    // `family: null` already meant unset; `flags: null` must too (node:dns
    // forwards a null `hints` here). https://github.com/oven-sh/bun/issues/37318
    // @ts-expect-error null is not in the declared type of flags
    expectAnswers(await dns.lookup("localhost", { flags: null }), LOCALHOST, "both");
  });

  describe.concurrent("UTF-16 string arguments", () => {
    // Builds a JSString backed by a 16-bit (UTF-16) buffer even though the
    // contents are plain ASCII. Passing such strings used to hit a debug
    // assertion (ZigString::slice() on UTF-16 string) instead of being
    // transcoded.
    const utf16 = (s: string) =>
      new TextDecoder("utf-16le").decode(new Uint8Array([...s].flatMap(c => [c.charCodeAt(0), 0])));

    test("lookupService() with a UTF-16 invalid address throws TypeError", () => {
      // @ts-expect-error lookupService() is not declared in bun-types
      expect(() => dns.lookupService(utf16("1,2,3"), 443)).toThrow(
        `The "address" argument is invalid. Received type string ('1,2,3')`,
      );
    });

    test("lookupService() with a UTF-16 valid address performs the reverse lookup", async () => {
      // 192.0.2.1 is in no hosts file, so the PTR query reaches the fake server, which has no answer.
      // @ts-expect-error lookupService() is not declared in bun-types
      expect(await rejectionOf(dns.lookupService(utf16("192.0.2.1"), 443))).toMatchObject({
        name: "DNSException",
        code: "DNS_ENOTFOUND",
        syscall: "getnameinfo",
        message: "getnameinfo ENOTFOUND 192.0.2.1|443",
      });
    });

    test("resolve() with a UTF-16 hostname and record type queries that record", async () => {
      // @ts-expect-error resolve() is not declared in bun-types
      expect(await dns.resolve(utf16(`utf16.${FAKE_ZONE}`), utf16("AAAA"))).toEqual([
        { address: FAKE_V6.address, ttl: FAKE_V6.ttl },
      ]);
    });

    test("resolve() with a UTF-16 invalid record type throws TypeError", () => {
      // @ts-expect-error resolve() is not declared in bun-types
      expect(() => dns.resolve("localhost", utf16("BOGUS"))).toThrow(
        `The property "record" is invalid. Expected one of: A, AAAA, ANY, CAA, CNAME, MX, NS, PTR, SOA, SRV, TXT, received type string ('BOGUS')`,
      );
    });
  });

  // These reconfigure the shared c-ares channel away from the fake server, so they stay sequential
  // (which also makes them wait for every concurrent test above) and last.
  describe("setServers", () => {
    test("triple with non-int32 family (double) throws TypeError", () => {
      // @ts-expect-error setServers() is not declared in bun-types
      expect(() => dns.setServers([[-9007199254740991, "8.8.8.8", 53]])).toThrow(TypeError);
    });

    test("triple with missing port (undefined) should not crash", () => {
      // undefined port coerces to 0, which is a valid int32
      // @ts-expect-error setServers() is not declared in bun-types
      expect(() => dns.setServers([[4, "8.8.8.8"]])).not.toThrow();
    });

    test("triple with missing family (undefined) throws TypeError", () => {
      // @ts-expect-error setServers() is not declared in bun-types
      expect(() => dns.setServers([["8.8.8.8"]])).toThrow(TypeError);
    });

    test("valid triple should succeed", () => {
      // @ts-expect-error setServers() is not declared in bun-types
      expect(() => dns.setServers([[4, "8.8.8.8", 53]])).not.toThrow();
    });
  });
});
