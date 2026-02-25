import { test, expect, describe } from "bun:test";
import { tls as validTls, invalidTls } from "harness";

describe("TLS keepalive with custom SSL contexts", () => {
  test("multiple requests with same custom TLS config reuse connections", async () => {
    await using server = Bun.serve({
      port: 0,
      tls: validTls,
      fetch() {
        return new Response("ok");
      },
    });

    const url = `https://localhost:${server.port}/`;
    const results: string[] = [];

    for (let i = 0; i < 5; i++) {
      const res = await fetch(url, {
        tls: { ca: validTls.cert },
      });
      results.push(await res.text());
    }

    expect(results).toEqual(["ok", "ok", "ok", "ok", "ok"]);
  });

  test("different TLS configs for same hostname do not cross-contaminate", async () => {
    // This test verifies that the keepalive pool is keyed by SSL context,
    // not just by host:port. The first fetch with a valid CA should pool its
    // connection; the second fetch with a different (invalid) CA must NOT
    // reuse that pooled connection and should fail TLS verification.
    await using server = Bun.serve({
      port: 0,
      tls: validTls,
      fetch() {
        return new Response("ok");
      },
    });

    const url = `https://localhost:${server.port}/`;

    // First request with valid CA should succeed and pool the connection
    const res1 = await fetch(url, {
      tls: { ca: validTls.cert },
    });
    expect(await res1.text()).toBe("ok");

    // Second request with invalid/wrong CA must fail —
    // it should NOT reuse the first connection's TLS session
    try {
      await fetch(url, {
        tls: { ca: invalidTls.cert },
      });
      // If we get here, the connection was incorrectly reused
      expect().fail("Expected fetch with wrong CA to fail, but it succeeded");
    } catch (e: any) {
      expect(e.code).toBe("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    }
  });

  test("many sequential requests with custom TLS return correct responses", async () => {
    await using server = Bun.serve({
      port: 0,
      tls: validTls,
      fetch() {
        return new Response("ok");
      },
    });

    const url = `https://localhost:${server.port}/`;

    for (let i = 0; i < 50; i++) {
      const res = await fetch(url, {
        tls: { ca: validTls.cert },
      });
      expect(await res.text()).toBe("ok");
    }
  });
});
