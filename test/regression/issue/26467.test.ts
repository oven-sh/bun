import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import dns from "dns";

beforeAll(() => {
  setDefaultTimeout(30_000);
});

// https://github.com/oven-sh/bun/issues/26467
// On Windows, dns.resolveSrv() was failing with ECONNREFUSED when c-ares
// fell back to using 127.0.0.1 as the DNS server due to IPHLPAPI failures.
// The fix adds a fallback to public DNS servers when only 127.0.0.1 is configured.
test("dns.resolveSrv should resolve SRV records", async () => {
  // Use a known SRV record for testing
  const hostname = "_test._tcp.test.socketify.dev";

  const results = await dns.promises.resolveSrv(hostname);

  expect(Array.isArray(results)).toBe(true);
  expect(results.length).toBeGreaterThan(0);

  // Verify the SRV record structure
  const record = results[0];
  expect(record).toHaveProperty("name");
  expect(record).toHaveProperty("port");
  expect(record).toHaveProperty("priority");
  expect(record).toHaveProperty("weight");
  expect(typeof record.name).toBe("string");
  expect(typeof record.port).toBe("number");
  expect(typeof record.priority).toBe("number");
  expect(typeof record.weight).toBe("number");
});

test("dns.getServers should not return only 127.0.0.1 after initialization", () => {
  // After the fix, if c-ares detects only 127.0.0.1 on Windows,
  // it should have been replaced with public DNS servers.
  const servers = dns.getServers();

  expect(Array.isArray(servers)).toBe(true);
  expect(servers.length).toBeGreaterThan(0);

  // The servers should contain at least one non-localhost server
  // If the fix worked, we shouldn't see only "127.0.0.1" as the sole server
  const hasNonLocalhost = servers.some(server => !server.startsWith("127.") && server !== "::1");

  // Note: This test may pass even without the fix on systems with proper DNS configuration.
  // The fix specifically targets Windows systems where IPHLPAPI fails to detect DNS servers.
  // On Linux/macOS, this should always pass since /etc/resolv.conf is reliable.
  expect(hasNonLocalhost).toBe(true);
});
