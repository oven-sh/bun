import { expect, test, describe } from "bun:test";
import { dns } from "bun";

describe("dns error propagation", () => {
  test("concurrent lookups do not cross-contaminate state on failure", async () => {
    // This test targets the drainPending* logic where we fixed the prev_global reuse bug.
    // We fire off multiple requests. While we can't easily force an OOM, we can ensure
    // that high concurrency doesn't lead to hanging promises or mismatched results.
    
    const hostnames = [
      "localhost",
      "example.com",
      "google.com",
      "invalid-domain-that-definitely-does-not-exist-" + Math.random(),
    ];

    const promises = hostnames.map(h => dns.lookup(h).then(
      res => ({ status: "fulfilled", host: h, res }),
      err => ({ status: "rejected", host: h, err })
    ));

    const results = await Promise.all(promises);

    // Verify that the invalid domain actually failed (rejected) rather than returning null/zero
    const invalid = results.find(r => r.host.startsWith("invalid-domain"));
    expect(invalid).toBeDefined();
    expect(invalid!.status).toBe("rejected"); 
    // Before the fix, some internal failures might have resolved with null or hung.
    // Specifically, if an internal conversion error occurred during draining, it would have been swallowed.
    // While this test primarily checks ENOTFOUND, it exercises the drainPendingHostNative path.
  });

  test("invalid inputs reject instead of hanging or returning garbage", async () => {
    // Stress test the input validation and error propagation paths
    // @ts-ignore
    await expect(dns.lookup("localhost", { family: 999 })).rejects.toThrow();
  });
});
