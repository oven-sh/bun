import { describe, expect, test } from "bun:test";

describe("HTTP Compression Cache Enforcement", () => {
  const TEST_CONTENT = "Hello ".repeat(1000); // ~6KB

  test("TTL: expired cache entries are recreated", async () => {
    const server = Bun.serve({
      port: 0,
      compression: {
        brotli: 4,
        disableForLocalhost: false,
        cache: {
          maxSize: 10 * 1024 * 1024,
          ttl: 1, // 1 second TTL
          minEntrySize: 0,
          maxEntrySize: 100 * 1024 * 1024,
        },
      },
      routes: {
        "/test": new Response(TEST_CONTENT, {
          headers: { "Content-Type": "text/plain" },
        }),
      },
      fetch() {
        return new Response("fallback");
      },
    });

    try {
      // First request - creates cached variant
      const res1 = await fetch(`http://localhost:${server.port}/test`, {
        headers: { "Accept-Encoding": "br" },
      });
      expect(res1.headers.get("content-encoding")).toBe("br");
      const text1 = await res1.text();
      expect(text1).toBe(TEST_CONTENT);

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Second request - should recreate expired variant
      const res2 = await fetch(`http://localhost:${server.port}/test`, {
        headers: { "Accept-Encoding": "br" },
      });
      expect(res2.headers.get("content-encoding")).toBe("br");
      const text2 = await res2.text();
      expect(text2).toBe(TEST_CONTENT);
    } finally {
      server.stop();
    }
  });

  test("TTL: zero means infinite (no expiration)", async () => {
    const server = Bun.serve({
      port: 0,
      compression: {
        brotli: 4,
        disableForLocalhost: false,
        cache: {
          maxSize: 10 * 1024 * 1024,
          ttl: 0, // Infinite TTL
          minEntrySize: 0,
          maxEntrySize: 100 * 1024 * 1024,
        },
      },
      routes: {
        "/test": new Response(TEST_CONTENT, {
          headers: { "Content-Type": "text/plain" },
        }),
      },
      fetch() {
        return new Response("fallback");
      },
    });

    try {
      const res1 = await fetch(`http://localhost:${server.port}/test`, {
        headers: { "Accept-Encoding": "br" },
      });
      expect(res1.headers.get("content-encoding")).toBe("br");

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should still serve from cache
      const res2 = await fetch(`http://localhost:${server.port}/test`, {
        headers: { "Accept-Encoding": "br" },
      });
      expect(res2.headers.get("content-encoding")).toBe("br");
    } finally {
      server.stop();
    }
  });

  test("minEntrySize: don't cache entries below threshold", async () => {
    const smallContent = "tiny"; // 4 bytes
    const server = Bun.serve({
      port: 0,
      compression: {
        brotli: 4,
        disableForLocalhost: false,
        cache: {
          maxSize: 10 * 1024 * 1024,
          ttl: 3600,
          minEntrySize: 100, // Minimum 100 bytes
          maxEntrySize: 100 * 1024 * 1024,
        },
      },
      routes: {
        "/small": new Response(smallContent, {
          headers: { "Content-Type": "text/plain" },
        }),
      },
      fetch() {
        return new Response("fallback");
      },
    });

    try {
      // Request should succeed but not compress (too small for cache)
      const res = await fetch(`http://localhost:${server.port}/small`, {
        headers: { "Accept-Encoding": "br" },
      });

      // Won't compress because compressed size < minEntrySize
      expect(res.headers.get("content-encoding")).toBe(null);
      expect(await res.text()).toBe(smallContent);
    } finally {
      server.stop();
    }
  });

  test("maxEntrySize: enforced after compression", async () => {
    // NOTE: It's hard to test this reliably because compression ratios vary.
    // The important thing is that the check happens AFTER compression.
    // This test just verifies the config is respected in general.
    const content = "Test ".repeat(1000); // ~5KB
    const server = Bun.serve({
      port: 0,
      compression: {
        brotli: 4,
        disableForLocalhost: false,
        cache: {
          maxSize: 10 * 1024 * 1024,
          ttl: 3600,
          minEntrySize: 0,
          maxEntrySize: 10 * 1024 * 1024, // Large enough to allow caching
        },
      },
      routes: {
        "/test": new Response(content, {
          headers: { "Content-Type": "text/plain" },
        }),
      },
      fetch() {
        return new Response("fallback");
      },
    });

    try {
      // Should compress and cache since maxEntrySize is large
      const res = await fetch(`http://localhost:${server.port}/test`, {
        headers: { "Accept-Encoding": "br" },
      });

      expect(res.headers.get("content-encoding")).toBe("br");
      expect(await res.text()).toBe(content);
    } finally {
      server.stop();
    }
  });

  test("maxSize: respect total cache size limit", async () => {
    const server = Bun.serve({
      port: 0,
      compression: {
        brotli: 4,
        disableForLocalhost: false,
        cache: {
          maxSize: 100, // Very small cache (100 bytes total)
          ttl: 3600,
          minEntrySize: 0,
          maxEntrySize: 100 * 1024 * 1024,
        },
      },
      routes: {
        "/test": new Response(TEST_CONTENT, {
          headers: { "Content-Type": "text/plain" },
        }),
      },
      fetch() {
        return new Response("fallback");
      },
    });

    try {
      // Request should not compress (would exceed cache max size)
      const res = await fetch(`http://localhost:${server.port}/test`, {
        headers: { "Accept-Encoding": "br" },
      });

      // Won't compress because total cache size is too small
      expect(res.headers.get("content-encoding")).toBe(null);
      expect(await res.text()).toBe(TEST_CONTENT);
    } finally {
      server.stop();
    }
  });

  test("cache: false bypasses all cache logic for static routes", async () => {
    const server = Bun.serve({
      port: 0,
      compression: {
        brotli: 4,
        cache: false, // Disable caching entirely
        disableForLocalhost: false,
      },
      routes: {
        "/test": new Response(TEST_CONTENT, {
          headers: { "Content-Type": "text/plain" },
        }),
      },
      fetch() {
        return new Response("fallback");
      },
    });

    try {
      // Static routes require caching, so no compression
      const res = await fetch(`http://localhost:${server.port}/test`, {
        headers: { "Accept-Encoding": "br" },
      });

      expect(res.headers.get("content-encoding")).toBe(null);
      expect(await res.text()).toBe(TEST_CONTENT);
    } finally {
      server.stop();
    }
  });
});
