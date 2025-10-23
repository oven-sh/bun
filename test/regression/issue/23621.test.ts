import { RedisClient } from "bun";
import { describe, expect, test } from "bun:test";

/**
 * Regression test for issue #23621: Invalid URL and port handling in Redis/Valkey client
 *
 * Issue: Redis client silently falls back to localhost:6379 when given invalid URLs or ports
 * Expected: Client should throw an error for invalid URLs/ports while still allowing no URL
 *          (which correctly defaults to localhost:6379)
 *
 * This test ensures that:
 * 1. Invalid URLs throw errors immediately during construction
 * 2. Invalid port numbers are rejected (negative, >65535, port 0 for TCP)
 * 3. No URL (undefined) correctly defaults to localhost:6379
 * 4. Valid URLs and port numbers are accepted
 */
describe("RedisClient: Invalid URL Handling (#23621)", () => {
  test("should throw error for completely malformed URLs", () => {
    expect(() => {
      new RedisClient("not a valid url at all");
    }).toThrow(/invalid url/i);

    expect(() => {
      new RedisClient("://no-protocol");
    }).toThrow(/invalid url/i);

    expect(() => {
      new RedisClient("redis://[invalid-ipv6");
    }).toThrow(/invalid url/i);
  });

  test("should throw error for empty string URL", () => {
    expect(() => {
      new RedisClient("");
    }).toThrow(/invalid url/i);
  });

  test("should throw error for URLs with invalid port formats in the URL itself", () => {
    // These should be caught by URL validation before port parsing
    expect(() => {
      new RedisClient("redis://localhost:not-a-number");
    }).toThrow();
  });

  test("should accept valid URLs with proper format", () => {
    // These should not throw during construction
    expect(() => {
      const client = new RedisClient("redis://localhost:6379");
      client.close();
    }).not.toThrow();

    expect(() => {
      const client = new RedisClient("valkey://127.0.0.1:6379");
      client.close();
    }).not.toThrow();

    expect(() => {
      const client = new RedisClient("redis://user:pass@localhost:6379");
      client.close();
    }).not.toThrow();
  });

  test("should allow undefined/no URL (defaults to localhost:6379)", () => {
    // When no URL is provided, it should use the default
    expect(() => {
      const client = new RedisClient();
      client.close();
    }).not.toThrow();

    expect(() => {
      const client = new RedisClient(undefined);
      client.close();
    }).not.toThrow();
  });

  test("should distinguish between no URL (valid) and invalid URL (error)", () => {
    // No URL should work (uses default)
    const clientNoUrl = new RedisClient();
    clientNoUrl.close();

    // But an explicitly invalid URL should fail
    expect(() => {
      new RedisClient("this is not a url");
    }).toThrow(/invalid url/i);
  });

  test("should handle URLs with valid special cases", () => {
    expect(() => {
      const client = new RedisClient("redis://localhost");
      client.close();
    }).not.toThrow();

    expect(() => {
      const client = new RedisClient("rediss://localhost:6380");
      client.close();
    }).not.toThrow();

    expect(() => {
      const client = new RedisClient("valkey+unix:///tmp/redis.sock");
      client.close();
    }).not.toThrow();
  });

  test("should throw error for port number exceeding 65535", () => {
    // Port 130000 exceeds the maximum valid port number (65535)
    expect(() => {
      new RedisClient("redis://localhost:130000");
    }).toThrow(/(invalid port number|invalid url format)/i);
  });

  test("should throw error for negative port number", () => {
    expect(() => {
      new RedisClient("redis://localhost:-1");
    }).toThrow(/(invalid port number|invalid url format)/i);
  });

  test("should throw error for explicit port 0 when using TCP (not unix socket)", () => {
    // Port 0 is invalid for TCP connections when explicitly specified
    expect(() => {
      new RedisClient("redis://localhost:0");
    }).toThrow(/port 0 is not valid/i);
  });

  test("should accept valid port numbers", () => {
    // These should not throw during construction (though connection will fail without a server)
    expect(() => {
      const client = new RedisClient("redis://localhost:6379");
      client.close();
    }).not.toThrow();

    expect(() => {
      const client = new RedisClient("redis://localhost:1234");
      client.close();
    }).not.toThrow();

    expect(() => {
      const client = new RedisClient("redis://localhost:65535");
      client.close();
    }).not.toThrow();
  });

  test("should use default port 6379 when port is omitted", () => {
    // When no port is specified, default to 6379
    // This should not throw
    expect(() => {
      const client = new RedisClient("redis://localhost");
      client.close();
    }).not.toThrow();
  });

  test("should throw error for malformed port in URL", () => {
    expect(() => {
      new RedisClient("redis://localhost:abc");
    }).toThrow(/(invalid port number|invalid url format)/i);

    expect(() => {
      new RedisClient("redis://localhost:12.34");
    }).toThrow(/(invalid port number|invalid url format)/i);
  });
});
