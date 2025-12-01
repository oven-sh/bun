import { expect, test } from "bun:test";

// Regression test for ENG-24418
// Calling methods on RedisClient.prototype should throw an error
// but not crash during GC
test("calling RedisClient.prototype.subscribe should throw without crashing", () => {
  const prototype = Bun.RedisClient.prototype;

  // Should throw an error about invalid this value
  expect(() => {
    prototype.subscribe();
  }).toThrow("Expected this to be instanceof RedisClient");

  // Force GC to ensure no crash occurs due to improperly initialized objects
  Bun.gc(true);
  Bun.gc(true);
});

test("calling RedisClient.prototype methods should throw appropriate errors", () => {
  const prototype = Bun.RedisClient.prototype;

  // Test various methods on the prototype
  expect(() => prototype.get("key")).toThrow("Expected this to be instanceof RedisClient");
  expect(() => prototype.set("key", "value")).toThrow("Expected this to be instanceof RedisClient");
  expect(() => prototype.subscribe("channel", () => {})).toThrow("Expected this to be instanceof RedisClient");
  expect(() => prototype.unsubscribe("channel")).toThrow("Expected this to be instanceof RedisClient");

  // Force GC after each to ensure no crash
  Bun.gc(true);
});

test("RedisClient.prototype properties should throw or return undefined without crashing", () => {
  const prototype = Bun.RedisClient.prototype;

  // Properties that have custom getters will throw
  expect(() => prototype.connected).toThrow();
  expect(() => prototype.bufferedAmount).toThrow();

  // Force GC to ensure no crash
  Bun.gc(true);
});
