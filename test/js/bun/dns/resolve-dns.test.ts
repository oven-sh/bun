import { SystemError, dns } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, withoutAggressiveGC } from "harness";
import { isIP, isIPv4, isIPv6 } from "node:net";

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
    test.each(invalidHostnames)("%s", hostname => {
      // @ts-expect-error
      expect(dns.lookup(hostname, { backend })).rejects.toMatchObject({
        code: "DNS_ENOTFOUND",
        name: "DNSException",
      });
    });

    test.each(malformedHostnames)("'%s'", hostname => {
      // @ts-expect-error
      expect(dns.lookup(hostname, { backend })).rejects.toMatchObject({
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

  test("lookup with non-object second argument should not crash", async () => {
    // Non-object cell values (like strings) passed as options should be ignored, not crash.
    // @ts-expect-error
    const result = await dns.lookup("localhost", "cat");
    expect(result).toBeArray();
    expect(result.length).toBeGreaterThan(0);
    expect(isIP(result[0].address)).toBeGreaterThan(0);
  });

  // LibInfo.lookup (macOS `backend: "system"`) acquires a slot in the 32-entry
  // pending_host_cache_native HiveArray, then calls getaddrinfo_async_start. If
  // that call fails synchronously the slot must be released via used.unset so a
  // later lookup for the same hostname doesn't see .inflight and append onto the
  // freed request (use-after-free). https://github.com/oven-sh/bun/pull/30005
  //
  // getaddrinfo_async_start only fails under mach-port exhaustion, so the error
  // branch is forced via BUN_INTERNAL_DNS_FORCE_LIBINFO_START_ERROR.
  test.skipIf(!isMacOS)("LibInfo.lookup releases pending-cache slot on getaddrinfo_async_start error", async () => {
    const script = /* js */ `
      const { dns } = require("bun");
      const opts = { backend: "system" };
      // Two lookups with the same hostname+options so they hash to the same
      // pending-cache slot. If the first failure orphans the slot, the second
      // lookup is classified .inflight and PendingCacheKey.append dereferences
      // the freed GetAddrInfoRequest -> heap-use-after-free under ASAN.
      for (let i = 0; i < 2; i++) {
        try {
          await dns.lookup("example.com", opts);
          console.log("resolved");
        } catch (e) {
          console.log("rejected:" + e.message);
        }
      }
      // The HiveArray has 32 slots; with the old used.set() no-op, 32 distinct
      // failures permanently fill it. Verify a 33rd distinct host still hits
      // the error path rather than falling through to .disabled.
      for (let i = 0; i < 33; i++) {
        try {
          await dns.lookup("host-" + i + ".invalid", opts);
          console.log("resolved");
        } catch (e) {
          // ok
        }
      }
      try {
        await dns.lookup("example.com", opts);
        console.log("post:resolved");
      } catch (e) {
        console.log("post:rejected:" + e.message);
      }
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: {
        ...bunEnv,
        BUN_INTERNAL_DNS_FORCE_LIBINFO_START_ERROR: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stderr, stdout: stdout.trim().split("\n") }).toEqual({
      stderr: "",
      stdout: [
        expect.stringContaining("rejected:getaddrinfo_async_start error"),
        expect.stringContaining("rejected:getaddrinfo_async_start error"),
        expect.stringContaining("post:rejected:getaddrinfo_async_start error"),
      ],
    });
    expect(exitCode).toBe(0);
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
});
