import { expect, test } from "bun:test";
import { writeFileSync } from "fs";
import { tempDir } from "harness";

test("Bun.fileURLToCacheKey preserves query parameters for cache invalidation", async () => {
  using dir = tempDir("import-cache-test", {
    "module.mjs": `export const value = "version 1";`,
  });

  const modulePath = String(dir) + "/module.mjs";

  // Import with query parameter
  const mod1 = await import(modulePath + "?v=1");
  expect(mod1.value).toBe("version 1");

  // Update the file
  writeFileSync(modulePath, `export const value = "version 2";`);

  // Import again with same query (should use cache)
  const mod2 = await import(modulePath + "?v=1");
  expect(mod2.value).toBe("version 1"); // Still cached

  // Use Bun.fileURLToCacheKey to get the correct cache key
  const resolvedURL = import.meta.resolve("./module.mjs?v=1", Bun.pathToFileURL(modulePath).href);
  const cacheKey = Bun.fileURLToCacheKey(resolvedURL);

  // Verify the cache key has the query parameter
  expect(cacheKey).toEndWith("?v=1");
  expect(Loader.registry.has(cacheKey)).toBe(true);

  // Delete from cache
  const deleted = Loader.registry.delete(cacheKey);
  expect(deleted).toBe(true);

  // Import again (should reload from disk)
  const mod3 = await import(modulePath + "?v=1");
  expect(mod3.value).toBe("version 2"); // Now updated!
});

test("Bun.fileURLToCacheKey vs Bun.fileURLToPath with query params", () => {
  const url = "file:///tmp/test.js?foo=bar&baz=qux";

  // fileURLToPath strips query params (Node.js compatible)
  const path = Bun.fileURLToPath(url);
  expect(path).toBe("/tmp/test.js");

  // fileURLToCacheKey preserves query params (for cache key use)
  const cacheKey = Bun.fileURLToCacheKey(url);
  expect(cacheKey).toBe("/tmp/test.js?foo=bar&baz=qux");
});

test("Bun.fileURLToCacheKey preserves hash fragments", () => {
  const url = "file:///tmp/test.js?v=1#section";
  const cacheKey = Bun.fileURLToCacheKey(url);
  expect(cacheKey).toBe("/tmp/test.js?v=1#section");
});

test("Bun.fileURLToCacheKey with no query or hash", () => {
  const url = "file:///tmp/test.js";
  const cacheKey = Bun.fileURLToCacheKey(url);
  expect(cacheKey).toBe("/tmp/test.js");
});

test("Bun.fileURLToCacheKey with only query", () => {
  const url = "file:///tmp/test.js?v=1";
  const cacheKey = Bun.fileURLToCacheKey(url);
  expect(cacheKey).toBe("/tmp/test.js?v=1");
});

test("Bun.fileURLToCacheKey with only hash", () => {
  const url = "file:///tmp/test.js#section";
  const cacheKey = Bun.fileURLToCacheKey(url);
  expect(cacheKey).toBe("/tmp/test.js#section");
});

test("Bun.fileURLToCacheKey rejects non-file URLs", () => {
  expect(() => Bun.fileURLToCacheKey("http://example.com/test.js")).toThrow();
  expect(() => Bun.fileURLToCacheKey("https://example.com/test.js")).toThrow();
});

test("Bun.fileURLToCacheKey with URL object", () => {
  const url = new URL("file:///tmp/test.js?v=1#section");
  const cacheKey = Bun.fileURLToCacheKey(url);
  expect(cacheKey).toBe("/tmp/test.js?v=1#section");
});
