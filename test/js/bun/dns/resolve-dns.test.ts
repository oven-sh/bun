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
});

// The internal DNS resolver used by fetch()/Bun.connect() on macOS goes through
// libinfo's getaddrinfo_async_start. When the first attempt (with AI_ADDRCONFIG)
// comes back as EAI_NONAME it retries without ADDRCONFIG, which allocates a new
// mach reply port. The retry must re-register the kqueue poll on that new port
// and store it on the request; previously the local machport was discarded and
// the poll was re-armed on the stale first port, so the retry's reply was never
// received and the request hung indefinitely.
test.skipIf(!isMacOS)("internal DNS: libinfo ADDRCONFIG retry re-registers on the new mach port", async () => {
  const src = /* js */ `
    const { dns } = require("bun");
    await using server = Bun.serve({
      port: 0,
      fetch: () => new Response("ok"),
    });
    const before = dns.getCacheStats().totalCount;
    const res = await fetch("http://localhost:" + server.port + "/");
    const body = await res.text();
    const after = dns.getCacheStats().totalCount;
    // The test hook bumps totalCount when it forces the NONAME retry. One
    // fetch against a fresh hostname is one getaddrinfo() call, so a delta
    // of 1 means the hook never fired (binary doesn't recognise the flag),
    // and this test would otherwise pass without exercising the retry.
    if (after - before < 2) {
      throw new Error("ADDRCONFIG retry hook did not fire (totalCount delta=" + (after - before) + ")");
    }
    process.stdout.write(body);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: {
      ...bunEnv,
      // Force the first libinfo callback to behave as EAI_NONAME so the
      // retry path runs without needing a loopback-only network config.
      BUN_INTERNAL_DNS_FORCE_ADDRCONFIG_RETRY: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("ok");
  expect(exitCode).toBe(0);
});
