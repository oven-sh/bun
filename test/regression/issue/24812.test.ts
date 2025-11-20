import { expect, test } from "bun:test";

test("url.parse handles MongoDB-style URLs with multiple IPv6 hosts", () => {
  const url = require("node:url");

  // MongoDB connection string with multiple IPv6 hosts (malformed but should not throw)
  const result = url.parse(`mongodb://user:password@[fd34:b871:e6a7::1],[fd34:b871:e6a7::2]:27017/db`);

  expect(result).toMatchObject({
    protocol: "mongodb:",
    slashes: true,
    auth: "user:password",
    host: "[fd34:b871:e6a7::1],[fd34:b871:e6a7::2]:27017",
    port: "27017",
    // hostname will be malformed but should not throw
    pathname: "/db",
    path: "/db",
    href: "mongodb://user:password@[fd34:b871:e6a7::1],[fd34:b871:e6a7::2]:27017/db",
  });

  // The hostname will be malformed, but that's expected behavior from Node.js
  // Node.js returns: 'fd34:b871:e6a7::1],[fd34:b871:e6a7::2'
  expect(result.hostname).toBe("fd34:b871:e6a7::1],[fd34:b871:e6a7::2");
});

test("url.parse handles other malformed hostnames gracefully", () => {
  const url = require("node:url");

  // Test with comma in hostname (not a valid hostname character)
  const result = url.parse("http://host1,host2:8080/path");

  expect(result.protocol).toBe("http:");
  expect(result.slashes).toBe(true);
  expect(result.host).toBe("host1,host2:8080");
  expect(result.port).toBe("8080");
  expect(result.pathname).toBe("/path");
});
