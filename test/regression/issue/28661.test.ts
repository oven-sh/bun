// https://github.com/oven-sh/bun/issues/28661
import { expect, test } from "bun:test";

test("URL.host setter replaces port when set to default port", () => {
  // HTTP with default port 80 — port should be stripped
  const u1 = new URL("http://localhost:3000/foo");
  u1.host = "some-domain:80";
  expect(u1.href).toBe("http://some-domain/foo");
  expect(u1.host).toBe("some-domain");
  expect(u1.port).toBe("");

  // HTTPS with default port 443 — port should be stripped
  const u2 = new URL("https://localhost:3000/foo");
  u2.host = "some-domain:443";
  expect(u2.href).toBe("https://some-domain/foo");
  expect(u2.host).toBe("some-domain");
  expect(u2.port).toBe("");

  // Non-default port should be kept
  const u3 = new URL("http://localhost:3000/foo");
  u3.host = "some-domain:8080";
  expect(u3.href).toBe("http://some-domain:8080/foo");
  expect(u3.host).toBe("some-domain:8080");
  expect(u3.port).toBe("8080");

  // Host without port only changes hostname, preserves existing port
  const u4 = new URL("http://localhost:3000/foo");
  u4.host = "some-domain";
  expect(u4.href).toBe("http://some-domain:3000/foo");
  expect(u4.host).toBe("some-domain:3000");
  expect(u4.port).toBe("3000");

  // FTP with default port 21
  const u5 = new URL("ftp://localhost:3000/foo");
  u5.host = "some-domain:21";
  expect(u5.href).toBe("ftp://some-domain/foo");
  expect(u5.host).toBe("some-domain");
  expect(u5.port).toBe("");

  // IPv6 with default port 80
  const u6 = new URL("http://[::1]:3000/foo");
  u6.host = "[::1]:80";
  expect(u6.href).toBe("http://[::1]/foo");
  expect(u6.host).toBe("[::1]");
  expect(u6.port).toBe("");
});
