import { expect, test } from "bun:test";

test("issue #22475: cookie.isExpired() should return true for Unix epoch (0)", () => {
  const cookies = ["a=; Expires=Thu, 01 Jan 1970 00:00:00 GMT", "b=; Expires=Thu, 01 Jan 1970 00:00:01 GMT"];

  const results = [];
  for (const _cookie of cookies) {
    const cookie = new Bun.Cookie(_cookie);
    results.push({
      name: cookie.name,
      expires: cookie.expires,
      isExpired: cookie.isExpired(),
    });
  }

  // Cookie 'a' with Unix epoch (0) should be expired
  expect(results[0].name).toBe("a");
  expect(results[0].expires).toBeDate();
  expect(results[0].expires?.getTime()).toBe(0);
  expect(results[0].isExpired).toBe(true);

  // Cookie 'b' with 1 second after Unix epoch should also be expired
  expect(results[1].name).toBe("b");
  expect(results[1].expires).toBeDate();
  expect(results[1].expires?.getTime()).toBe(1000);
  expect(results[1].isExpired).toBe(true);
});

test("cookie.isExpired() for various edge cases", () => {
  // Test Unix epoch (0) - should be expired
  const epochCookie = new Bun.Cookie("test", "value", { expires: 0 });
  expect(epochCookie.expires).toBeDate();
  expect(epochCookie.expires?.getTime()).toBe(0);
  expect(epochCookie.isExpired()).toBe(true);

  // Test negative timestamp - should be expired
  const negativeCookie = new Bun.Cookie("test", "value", { expires: -1 });
  expect(negativeCookie.expires).toBeDate();
  expect(negativeCookie.expires?.getTime()).toBe(-1000);
  expect(negativeCookie.isExpired()).toBe(true);

  // Test session cookie (no expires) - should not be expired
  const sessionCookie = new Bun.Cookie("test", "value");
  expect(sessionCookie.expires).toBeUndefined();
  expect(sessionCookie.isExpired()).toBe(false);

  // Test future date - should not be expired
  const futureCookie = new Bun.Cookie("test", "value", { expires: Date.now() + 86400000 });
  expect(futureCookie.isExpired()).toBe(false);
});
