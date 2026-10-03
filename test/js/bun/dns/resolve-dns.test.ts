import { SystemError, dns } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isMacOS, isWindows, tempDir, withoutAggressiveGC } from "harness";
import { isIP, isIPv4, isIPv6 } from "node:net";
import { join } from "node:path";
import type { Answer, Answers } from "./mdnsresponder-fixture";

const cc = Bun.which("cc") || Bun.which("clang");
const backends = ["system", "libc", "c-ares"];
const validHostnames = ["localhost", "example.com"];
const invalidHostnames = ["adsfa.asdfasdf.asdf.com"]; // known invalid
// Not host names at all: rejected before any resolver is asked, so the answer
// does not depend on what the network's DNS server does with a label that has
// a space in it (some never answer, and mDNSResponder then waits out its 5s or
// 30s timeout).
const malformedHostnames = [" ", ".", " .", "localhost:80", "this is not a hostname", "a..b", "foo bar.example.com"];

describe("dns", () => {
  describe.each(backends)("lookup() [backend: %s]", backend => {
    describe.each(validHostnames)("%s", hostname => {
      test.each([
        {
          options: { backend },
          address: isIP,
        },
        {
          options: { backend, family: 4 },
          address: isIPv4,
          family: 4,
        },
        {
          options: { backend, family: "IPv4" },
          address: isIPv4,
          family: 4,
        },
        {
          options: { backend, family: 6 },
          address: isIPv6,
          family: 6,
        },
        {
          options: { backend, family: "IPv6" },
          address: isIPv6,
          family: 6,
        },
        {
          options: { backend, family: 0 },
          address: isIP,
        },
        {
          options: { backend, family: "any" },
          address: isIP,
        },
      ])("%j", async ({ options, address: expectedAddress, family: expectedFamily }) => {
        // this behavior matchs nodejs
        const expect_to_fail =
          isWindows &&
          backend !== "c-ares" &&
          (options.family === "IPv6" || options.family === 6) &&
          hostname !== "localhost";
        if (expect_to_fail) {
          try {
            // @ts-expect-error
            await dns.lookup(hostname, options);
            expect.unreachable();
          } catch (err: unknown) {
            expect(err).toBeDefined();
            expect((err as SystemError).code).toBe("DNS_ENOTFOUND");
          }
          return;
        }
        // @ts-expect-error
        const result = await dns.lookup(hostname, options);
        expect(result).toBeArray();
        expect(result.length).toBeGreaterThan(0);
        withoutAggressiveGC(() => {
          for (const { family, address, ttl } of result) {
            expect(address).toBeString();
            expect(expectedAddress(address)).toBeTruthy();
            expect(family).toBeInteger();
            if (expectedFamily !== undefined) {
              expect(family).toBe(expectedFamily);
            }
            expect(ttl).toBeInteger();
          }
        });
      });
    });
    test.each(validHostnames)("%s [parallel x 10]", async hostname => {
      const results = await Promise.all(
        // @ts-expect-error
        Array.from({ length: 10 }, () => dns.lookup(hostname, { backend })),
      );
      const answers = results.flat();
      expect(answers).toBeArray();
      expect(answers.length).toBeGreaterThanOrEqual(10);
      withoutAggressiveGC(() => {
        for (const { family, address, ttl } of answers) {
          expect(address).toBeString();
          expect(isIP(address)).toBeTruthy();
          expect(family).toBeInteger();
          expect(ttl).toBeInteger();
        }
      });
    });
    // These negative lookups are independent (distinct hostname+backend, no shared
    // state); run them concurrently so the system resolver's ~4s negative-lookup
    // timeouts overlap instead of stacking.
    test.concurrent.each(invalidHostnames)("%s", async hostname => {
      // @ts-expect-error
      await expect(dns.lookup(hostname, { backend })).rejects.toMatchObject({
        code: "DNS_ENOTFOUND",
        name: "DNSException",
      });
    });

    test.concurrent.each(malformedHostnames)("'%s'", async hostname => {
      // @ts-expect-error
      await expect(dns.lookup(hostname, { backend })).rejects.toMatchObject({
        code: "DNS_ENOTFOUND",
        name: "DNSException",
        syscall: "getaddrinfo",
        hostname,
      });
    });
  });

  // Hostnames longer than the fixed stack buffer used by the libc/system
  // backends (bun.PathBuffer, which is MAX_PATH_BYTES: 1024 on macOS, 4096 on
  // Linux, ~98302 on Windows) previously overflowed when writing the NUL
  // terminator. They must reject cleanly on every backend. 100 000 bytes
  // exceeds the buffer on every platform so the doLookup guard (a host name is
  // at most 253 bytes) is what fires.
  test.each(backends)("lookup() with oversized hostname rejects [backend: %s]", async backend => {
    const long = Buffer.alloc(100_000, "a").toString();
    // @ts-expect-error
    await expect(dns.lookup(long, { backend })).rejects.toMatchObject({
      name: "DNSException",
      code: "DNS_ENOTFOUND",
      syscall: "getaddrinfo",
    });
  });

  test("lookup() with oversized .local hostname rejects via system backend in subprocess", async () => {
    // A `.local` suffix forces the c-ares backend to fall through to the
    // system resolver, which is the path that wrote past its stack buffer.
    // Run in a subprocess so the panic that the unfixed debug build raises on
    // the worker thread shows up as a non-zero exit instead of aborting the
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
          for (const result of settled) {
            if (result.status !== "rejected") throw new Error("expected rejection");
            if (result.reason?.code !== "DNS_ENOTFOUND") {
              throw new Error("expected DNS_ENOTFOUND, got " + result.reason?.code);
            }
          }
          console.log("ok");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });

  // The pending-host-cache slot holds a Box<[u8]> clone of the hostname so
  // concurrent lookups for the same name can coalesce. When process.exit()
  // tears the VM down (BUN_DESTRUCT_VM_ON_EXIT=1, set by the CI runner) while
  // a libc getaddrinfo is still on the work pool, the Resolver is dropped
  // with that slot still occupied. HiveArray used to skip Drop on its slots,
  // so the hostname Box leaked. Only observable via LSan, so ASAN-only.
  test.skipIf(!isASAN || isWindows)(
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

  test("lookup with non-object second argument should not crash", async () => {
    // Non-object cell values (like strings) passed as options should be ignored, not crash.
    // @ts-expect-error
    const result = await dns.lookup("localhost", "cat");
    expect(result).toBeArray();
    expect(result.length).toBeGreaterThan(0);
    expect(isIP(result[0].address)).toBeGreaterThan(0);
  });

  test("lookup with null flags treats them as unset", async () => {
    // `family: null` already meant unset; `flags: null` must too (node:dns
    // forwards a null `hints` here). https://github.com/oven-sh/bun/issues/37318
    // @ts-expect-error
    const result = await dns.lookup("localhost", { flags: null });
    expect(result).toBeArray();
    expect(result.length).toBeGreaterThan(0);
    expect(isIP(result[0].address)).toBeGreaterThan(0);
  });

  describe("setServers", () => {
    test("triple with non-int32 family (double) throws TypeError", () => {
      // @ts-expect-error
      expect(() => dns.setServers([[-9007199254740991, "8.8.8.8", 53]])).toThrow(TypeError);
    });

    test("triple with missing port (undefined) should not crash", () => {
      // undefined port coerces to 0, which is a valid int32
      // @ts-expect-error
      expect(() => dns.setServers([[4, "8.8.8.8"]])).not.toThrow();
    });

    test("triple with missing family (undefined) throws TypeError", () => {
      // @ts-expect-error
      expect(() => dns.setServers([["8.8.8.8"]])).toThrow(TypeError);
    });

    test("valid triple should succeed", () => {
      expect(() => dns.setServers([[4, "8.8.8.8", 53]])).not.toThrow();
    });
  });

  describe("UTF-16 string arguments", () => {
    // Builds a JSString backed by a 16-bit (UTF-16) buffer even though the
    // contents are plain ASCII. Passing such strings used to hit a debug
    // assertion (ZigString::slice() on UTF-16 string) instead of being
    // transcoded.
    const utf16 = (s: string) =>
      new TextDecoder("utf-16le").decode(new Uint8Array([...s].flatMap(c => [c.charCodeAt(0), 0])));

    test("lookupService() with a UTF-16 invalid address throws TypeError", () => {
      // @ts-expect-error
      expect(() => Bun.dns.lookupService(utf16("1,2,3"), 443)).toThrow(
        `The "address" argument is invalid. Received type string ('1,2,3')`,
      );
    });

    test("lookupService() with a UTF-16 valid address does not crash", async () => {
      // The reverse lookup result is environment-dependent; the assertion is
      // that the address parses (no synchronous throw) and nothing panics.
      // @ts-expect-error
      await Bun.dns.lookupService(utf16("127.0.0.1"), 443).catch(() => {});
    });

    test("resolve() with a UTF-16 record type does not crash", async () => {
      // A valid record type must be accepted (no synchronous throw); the
      // query result itself is environment-dependent.
      // @ts-expect-error
      await Bun.dns.resolve(utf16("localhost"), utf16("AAAA")).catch(() => {});
    });

    test("resolve() with a UTF-16 invalid record type throws TypeError", () => {
      // @ts-expect-error
      expect(() => Bun.dns.resolve("localhost", utf16("BOGUS"))).toThrow(
        `The property "record" is invalid. Expected one of: A, AAAA, ANY, CAA, CNAME, MX, NAPTR, NS, PTR, SOA, SRV, TXT, received type string ('BOGUS')`,
      );
    });
  });

  // On macOS the system backend talks to mDNSResponder over a unix socket. These put a scripted responder
  // behind that socket, so each test sees the requests Bun makes and chooses the replies Bun gets.
  describe.skipIf(!isMacOS || !cc)("system backend over the mDNSResponder socket", () => {
    // libsystem_dnssd has a DNSSD_UDS_PATH override of its own, but on macOS 26 only a setuid process reads it.
    const redirectConnect = /* c */ `
      #include <stdlib.h>
      #include <string.h>
      #include <sys/socket.h>
      #include <sys/un.h>

      int connect_nocancel(int, const struct sockaddr *, socklen_t) __asm("_connect$NOCANCEL");

      static const struct sockaddr *redirect(const struct sockaddr *addr, struct sockaddr_un *to) {
        const char *path = getenv("DNSSD_UDS_PATH");
        if (!path || addr->sa_family != AF_UNIX ||
            strcmp(((const struct sockaddr_un *)addr)->sun_path, "/var/run/mDNSResponder"))
          return addr;
        to->sun_len = sizeof(*to);
        to->sun_family = AF_UNIX;
        strlcpy(to->sun_path, path, sizeof(to->sun_path));
        return (const struct sockaddr *)to;
      }

      static int redirected_connect(int fd, const struct sockaddr *addr, socklen_t len) {
        struct sockaddr_un to;
        return connect(fd, redirect(addr, &to), len);
      }

      static int redirected_connect_nocancel(int fd, const struct sockaddr *addr, socklen_t len) {
        struct sockaddr_un to;
        return connect_nocancel(fd, redirect(addr, &to), len);
      }

      __attribute__((used, section("__DATA,__interpose"))) static const struct {
        const void *replacement, *original;
      } interpose[] = {
        {(const void *)redirected_connect, (const void *)connect},
        {(const void *)redirected_connect_nocancel, (const void *)connect_nocancel},
      };
    `;

    let dir: ReturnType<typeof tempDir>;
    let sockets = 0;

    beforeAll(async () => {
      dir = tempDir("dns-sd", { "redirect.c": redirectConnect });
      await using proc = Bun.spawn({
        cmd: [cc!, "-dynamiclib", "-o", "redirect.dylib", "redirect.c"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "inherit",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      if (exitCode !== 0) throw new Error(`could not compile redirect.c: ${stderr}`);
    });

    afterAll(() => dir?.[Symbol.dispose]());

    const A = 1;
    const CNAME = 5;
    const AAAA = 28;
    // kDNSServiceFlagsShareConnection | kDNSServiceFlagsTimeout | kDNSServiceFlagsReturnIntermediates
    const baseFlags = 0x4000 | 0x10000 | 0x1000;
    const suppressUnusable = 0x8000;
    const alias: Answer = { rrtype: CNAME, rdata: [5, ...Buffer.from("alias"), 4, ...Buffer.from("test"), 0] };
    const a = (...rdata: number[]): Answer => ({ rrtype: A, rdata });
    const aaaa = (first: number, last: number, more: Partial<Answer> = {}): Answer => ({
      rrtype: AAAA,
      rdata: [first >> 8, first & 0xff, ...Buffer.alloc(13), last],
      ...more,
    });

    /** Runs `script` with `answers` behind the socket: the one line of JSON it prints, and the requests it made. */
    async function exchange(answers: Answers, script: string) {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          join(import.meta.dir, "mdnsresponder-fixture.ts"),
          join(String(dir), `${sockets++}.sock`),
          JSON.stringify(answers),
          script,
        ],
        env: { ...bunEnv, DYLD_INSERT_LIBRARIES: join(String(dir), "redirect.dylib"), NO_PROXY: "*", no_proxy: "*" },
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      const [printed, requests] = stdout
        .trim()
        .split("\n")
        .map(line => JSON.parse(line));
      return {
        printed,
        // TLV 4 is IPC_TLV_TYPE_SERVICE_ATTR_FAILOVER_POLICY; 1 is kDNSServiceFailoverPolicyAllow.
        requests: requests.map(({ tlvs, ...request }) => ({ ...request, failoverPolicy: tlvs?.[4]?.at(-1) })),
        exitCode,
      };
    }

    const lookup = (name: string, options: object = {}) =>
      `console.log(JSON.stringify(await Bun.dns.lookup(${JSON.stringify(name)}, ${JSON.stringify(options)}).catch(e => e.code)))`;

    const queries = (name: string, flags: number, rrtypes = [A, AAAA]) =>
      rrtypes.map(rrtype => ({ op: "query", name, rrtype, flags, ifindex: 0, failoverPolicy: 1 }));

    const both = {
      "host.corp.example 1": [alias, a(10, 0, 0, 10)],
      "host.corp.example 28": [alias, aaaa(0xfd00, 0x10)],
    };

    // https://github.com/oven-sh/bun/issues/44075
    test.concurrent("lookup() queries each family and allows failover to another resolver", async () => {
      expect(await exchange(both, lookup("host.corp.example"))).toEqual({
        printed: [
          { address: "fd00::10", family: 6, ttl: 60 },
          { address: "10.0.0.10", family: 4, ttl: 60 },
        ],
        requests: queries("host.corp.example", baseFlags | suppressUnusable),
        exitCode: 0,
      });
    });

    test.concurrent("lookup() makes the same requests as getaddrinfo()", async () => {
      const [system, libc] = await Promise.all(
        ["system", "libc"].map(backend => exchange(both, lookup("host.corp.example", { backend }))),
      );
      expect(libc.requests).toHaveLength(2);
      expect(system.requests).toEqual(libc.requests);
    });

    test.concurrent("fetch() queries each family and allows failover to another resolver", async () => {
      const script = `
        using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("reached") });
        const response = await fetch("http://host.corp.example:" + server.port + "/");
        console.log(JSON.stringify(await response.text()));
      `;
      expect(await exchange({ "host.corp.example 1": [alias, a(127, 0, 0, 1)] }, script)).toEqual({
        printed: "reached",
        requests: queries("host.corp.example", baseFlags | suppressUnusable),
        exitCode: 0,
      });
    });

    test.concurrent.each([
      { family: 4, rrtype: A, address: "10.0.0.10" },
      { family: 6, rrtype: AAAA, address: "fd00::10" },
    ])("lookup() with family: $family queries that family alone", async ({ family, rrtype, address }) => {
      expect(await exchange(both, lookup("host.corp.example", { family }))).toEqual({
        printed: [{ address, family, ttl: 60 }],
        requests: queries("host.corp.example", baseFlags, [rrtype]),
        exitCode: 0,
      });
    });

    // mDNSResponder tries the search domains for a single label only when the name has no trailing dot.
    test.concurrent.each(["intranet", "host.corp.example."])("lookup(%j) sends the name as written", async name => {
      expect(await exchange({ [`${name} 1`]: [a(10, 0, 0, 10)] }, lookup(name))).toEqual({
        printed: [{ address: "10.0.0.10", family: 4, ttl: 60 }],
        requests: queries(name, baseFlags | suppressUnusable),
        exitCode: 0,
      });
    });

    test.concurrent("lookup() scopes a link-local address to the interface it was seen on", async () => {
      const answers = { "printer.local 28": [aaaa(0xfe80, 1, { ifindex: 7 }), aaaa(0xfd00, 1, { ifindex: 7 })] };
      expect(await exchange(answers, lookup("printer.local"))).toEqual({
        printed: [
          { address: "fe80::1%7", family: 6, ttl: 60 },
          { address: "fd00::1", family: 6, ttl: 60 },
        ],
        requests: queries("printer.local", baseFlags | suppressUnusable),
        exitCode: 0,
      });
    });

    test.concurrent("lookup() keeps only well-formed records that were added", async () => {
      const removed = { ...a(10, 0, 0, 9), flags: 0 };
      const answers = { "host.corp.example 1": [a(10, 0, 0, 10), removed, a(10, 0, 0)] };
      expect(await exchange(answers, lookup("host.corp.example"))).toEqual({
        printed: [{ address: "10.0.0.10", family: 4, ttl: 60 }],
        requests: queries("host.corp.example", baseFlags | suppressUnusable),
        exitCode: 0,
      });
    });

    test.concurrent("lookup() asks once more without SuppressUnusable before it reports ENOTFOUND", async () => {
      expect(await exchange({}, lookup("host.corp.example"))).toEqual({
        printed: "DNS_ENOTFOUND",
        requests: [
          ...queries("host.corp.example", baseFlags | suppressUnusable),
          ...queries("host.corp.example", baseFlags),
        ],
        exitCode: 0,
      });
    });
  });
});
