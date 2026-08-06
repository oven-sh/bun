import { SystemError, dns } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, withoutAggressiveGC } from "harness";
import { isIP, isIPv4, isIPv6 } from "node:net";
import { join } from "node:path";

const backends = ["system", "libc", "c-ares"];
const validHostnames = ["localhost", "example.com"];
const invalidHostnames = ["adsfa.asdfasdf.asdf.com"]; // known invalid
const malformedHostnames = [" ", ".", " .", "localhost:80", "this is not a hostname"];

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
        code: expect.stringMatching(/^DNS_ENOTFOUND|DNS_ESERVFAIL|DNS_ENOTIMP$/),
        name: "DNSException",
      });
    });
  });

  // Hostnames longer than the fixed stack buffer used by the libc/system
  // backends (bun.PathBuffer, which is MAX_PATH_BYTES: 1024 on macOS, 4096 on
  // Linux, ~98302 on Windows) previously overflowed when writing the NUL
  // terminator. They must reject cleanly on every backend. 100 000 bytes
  // exceeds the buffer on every platform so the doLookup guard is what fires.
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

  describe("IPv4 literal normalization (inet_aton semantics)", () => {
    // Legacy dotted forms (octal, hex, dword, 1-3 field shorthands) must resolve
    // to the same canonical address node/glibc/curl produce, on every backend.
    // Numeric literals resolve without touching the network.
    const canonical: Array<[string, string]> = [
      ["0177.0.0.1", "127.0.0.1"],
      ["127.0.0.010", "127.0.0.8"],
      ["012.0.0.1", "10.0.0.1"],
      ["0x7f000001", "127.0.0.1"],
      ["0x7f.1", "127.0.0.1"],
      ["2130706433", "127.0.0.1"],
      ["127.1", "127.0.0.1"],
      ["1.2.3", "1.2.0.3"],
      ["010.0x10.0.1", "8.16.0.1"],
    ];

    describe.each(backends)("[backend: %s]", backend => {
      test.each(canonical)("%s resolves to %s", async (input, expected) => {
        // @ts-expect-error -- backend is a valid option
        const result = await dns.lookup(input, { backend, family: 4 });
        expect(result[0].address).toBe(expected);
        expect(result[0].family).toBe(4);
      });
    });

    test("every backend resolves the same literal to the same host", async () => {
      const input = "010.1.2.3";
      const addresses = await Promise.all(
        // @ts-expect-error -- backend is a valid option
        backends.map(backend => dns.lookup(input, { backend, family: 4 }).then(r => r[0].address)),
      );
      expect(addresses).toEqual(backends.map(() => "8.1.2.3"));
    });

    // Malformed numeric literals must be rejected, not dialed with a backend's
    // laxer reading (e.g. c-ares "08.0.0.1" as 8.0.0.1, or "0x" as 0.0.0.0).
    test.each(["08.0.0.1", "09.1.1.1", "256.1.1.1", "1.2.3.4.5", "0x", "127.0x", "0x.0x.0x.0x"])(
      "rejects malformed numeric literal %s",
      async input => {
        // @ts-expect-error -- backend is a valid option
        await expect(dns.lookup(input, { backend: "c-ares", family: 4 })).rejects.toMatchObject({
          code: "DNS_ENOTFOUND",
        });
      },
    );
  });

  test("lookup with non-object second argument should not crash", async () => {
    // Non-object cell values (like strings) passed as options should be ignored, not crash.
    // @ts-expect-error
    const result = await dns.lookup("localhost", "cat");
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
        `The property "record" is invalid. Expected one of: A, AAAA, ANY, CAA, CNAME, MX, NS, PTR, SOA, SRV, TXT, received type string ('BOGUS')`,
      );
    });
  });
});
