import { expect, test } from "bun:test";

test("dns.setServers with empty inner array does not crash", () => {
  expect(() => Bun.dns.setServers([[]])).toThrow();
});

test("dns.setServers with short inner array does not crash", () => {
  expect(() => Bun.dns.setServers([[4]])).toThrow();
  expect(() => Bun.dns.setServers([[4, "1.1.1.1"]])).toThrow();
});
