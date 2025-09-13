import { test, expect } from "bun:test";

test("fetch() accepts ftp:// URLs", async () => {
  // Test that FTP URLs are accepted without throwing
  const response = await fetch("ftp://localhost:2121/test.txt");
  expect(response.ok).toBe(true);
  expect(response.status).toBe(200);

  const text = await response.text();
  expect(typeof text).toBe("string");
});

test("fetch() accepts ftp:// URLs with credentials", async () => {
  const response = await fetch("ftp://user:pass@localhost:2121/test.txt");
  expect(response.ok).toBe(true);
  expect(response.status).toBe(200);
});

test("fetch() accepts ftp:// URLs with custom port", async () => {
  const response = await fetch("ftp://localhost:2122/test.txt");
  expect(response.ok).toBe(true);
  expect(response.status).toBe(200);
});

test("fetch() rejects unsupported protocols", async () => {
  expect(() => fetch("gopher://example.com/test")).toThrow(
    "protocol must be http:, https:, s3: or ftp:"
  );
});