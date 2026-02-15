import { expect, test } from "bun:test";
import url from "node:url";

test("url.format with WHATWG URL preserves username and password", () => {
  const result = url.format(new URL("https://a:b@example.org/"));
  expect(result).toBe("https://a:b@example.org/");
});

test("url.format with WHATWG URL preserves username only", () => {
  const result = url.format(new URL("https://user@example.org/"));
  expect(result).toBe("https://user@example.org/");
});

test("url.format with WHATWG URL without auth", () => {
  const result = url.format(new URL("https://example.org/"));
  expect(result).toBe("https://example.org/");
});

test("url.format with WHATWG URL preserves username, password, and path", () => {
  const result = url.format(new URL("https://user:pass@example.org/path?query=1#hash"));
  expect(result).toBe("https://user:pass@example.org/path?query=1#hash");
});

test("url.format with WHATWG URL with special characters in credentials", () => {
  // When creating a URL, special characters in credentials are already percent-encoded
  // url.format should preserve the encoding from the URL object
  const result = url.format(new URL("https://us%40er:p%40ss@example.org/"));
  // The username and password are already encoded by the URL object, so we should preserve them as-is
  expect(result).toBe("https://us%40er:p%40ss@example.org/");
});

test("url.format with legacy Url object still works", () => {
  const parsed = url.parse("https://a:b@example.org/path");
  const result = url.format(parsed);
  expect(result).toBe("https://a:b@example.org/path");
});
