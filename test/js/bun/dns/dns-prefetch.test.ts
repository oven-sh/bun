import { dns } from "bun";
import { describe, expect, it } from "bun:test";

describe("dns.prefetch", () => {
  it("should prefetch", async () => {
    const currentStats = dns.getCacheStats();
    dns.prefetch("example.com");
    await Bun.sleep(32);

    // Must set keepalive: false to ensure it doesn't reuse the socket.
    await fetch("http://example.com", { method: "HEAD", redirect: "manual", keepalive: false });
    const newStats = dns.getCacheStats();
    expect(currentStats).not.toEqual(newStats);
    if (
      newStats.cacheHitsCompleted > currentStats.cacheHitsCompleted ||
      newStats.cacheHitsInflight > currentStats.cacheHitsInflight
    ) {
      expect().pass();
    } else {
      expect().fail("dns.prefetch should have prefetched");
    }

    // Must set keepalive: false to ensure it doesn't reuse the socket.
    await fetch("http://example.com", { method: "HEAD", redirect: "manual", keepalive: false });
    const newStats2 = dns.getCacheStats();
    // Ensure it's cached.
    expect(newStats2.cacheHitsCompleted).toBeGreaterThan(currentStats.cacheHitsCompleted);
  });
});
