import { describe, expect, test } from "bun:test";

/**
 * Regression test for GitHub issue #26744
 * https://github.com/oven-sh/bun/issues/26744
 *
 * When querying TXT records for a domain that is a CNAME, Bun should
 * follow the CNAME chain and return the TXT records from the target domain,
 * just like Node.js does.
 *
 * The issue occurs because c-ares's ares_query function returns the raw DNS
 * response which may contain only a CNAME record (no TXT records). Bun's DNS
 * resolver now handles this by following the CNAME chain to resolve the final
 * TXT records.
 */
describe("dns.resolveTxt with CNAME domains", () => {
  test("should follow CNAME and return TXT records", async () => {
    const dns = require("dns/promises");

    // This domain is a CNAME pointing to sendgrid.net which has TXT records
    // Note: This test depends on external DNS infrastructure
    const hostname = "deletemecname2.suped.com";

    // Node.js successfully resolves this, so Bun should too
    const result = await dns.resolveTxt(hostname);

    // The result should be an array of TXT record arrays
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);

    // Each TXT record is an array of strings
    for (const txtRecord of result) {
      expect(Array.isArray(txtRecord)).toBe(true);
      expect(txtRecord.length).toBeGreaterThan(0);
      for (const str of txtRecord) {
        expect(typeof str).toBe("string");
      }
    }

    // The target domain (sendgrid.net) should have SPF records
    const hasSPF = result.some((record: string[]) => record.some((str: string) => str.includes("v=spf1")));
    expect(hasSPF).toBe(true);
  });

  test("should work with Resolver class", async () => {
    const dns = require("dns/promises");
    const resolver = new dns.Resolver();

    // Use public DNS server
    resolver.setServers(["8.8.8.8"]);

    const hostname = "deletemecname2.suped.com";
    const result = await resolver.resolveTxt(hostname);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  test("should still work for non-CNAME domains", async () => {
    const dns = require("dns/promises");

    // google.com has TXT records directly (no CNAME)
    const result = await dns.resolveTxt("google.com");

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });
});
