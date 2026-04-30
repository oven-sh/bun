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

  // `LibInfo.lookup` is only compiled on macOS; on other platforms the `system`
  // backend goes through libc/libuv and this error path does not exist.
  test.skipIf(!isMacOS)(
    "lookup releases pending_host_cache_native slot when getaddrinfo_async_start fails",
    async () => {
      // The pending cache is a 32-entry HiveArray. Before the fix, the error path
      // called `used.set(pos)` (a no-op, since the slot was already marked used by
      // `HiveArray.get`) instead of `used.unset(pos)`, and then freed the request
      // it still pointed at. After 32 failures every slot was orphaned and the next
      // lookup with a matching hash would follow `.inflight` into freed memory.
      //
      // Drive 40 distinct failures (> 32) so the slot at index 0 is reused; if the
      // slot was not released, looking up "host-0" again would match a stale entry
      // whose `lookup` pointer dangles.
      const script = /* js */ `
      const { dns } = Bun;
      const N = 40;

      const errors = [];
      for (let i = 0; i < N; i++) {
        try {
          await dns.lookup("host-" + i + ".invalid", { backend: "system" });
          console.error("lookup " + i + " unexpectedly resolved");
          process.exit(1);
        } catch (e) {
          errors.push(String(e.message ?? e));
        }
      }

      // Repeat the first hostname. With the bug, its hash matches the stale slot
      // at index 0 and append() dereferences a freed GetAddrInfoRequest (ASAN
      // heap-use-after-free).
      try {
        await dns.lookup("host-0.invalid", { backend: "system" });
        console.error("repeat lookup unexpectedly resolved");
        process.exit(1);
      } catch (e) {
        errors.push(String(e.message ?? e));
      }

      if (errors.length !== N + 1) {
        console.error("expected " + (N + 1) + " rejections, got " + errors.length);
        process.exit(1);
      }
      for (const msg of errors) {
        if (!msg.includes("getaddrinfo_async_start error")) {
          console.error("unexpected rejection: " + msg);
          process.exit(1);
        }
      }
      console.log("ok " + errors.length);
    `;

      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: {
          ...bunEnv,
          BUN_FEATURE_FLAG_FORCE_LIBINFO_ASYNC_START_ERROR: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      const filteredStderr = stderr
        .split("\n")
        .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
        .join("\n");
      expect(filteredStderr).toBe("");
      expect(stdout.trim()).toBe("ok 41");
      expect(exitCode).toBe(0);
    },
  );
});
