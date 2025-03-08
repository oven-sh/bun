import { expect, test } from "bun:test";

test("Response.redirect clones string from Location header", () => {
  const url = new URL("http://example.com");
  url.hostname = "example1.com";
  const { href } = url;
  expect(href).toBe("http://example1.com/");
  const response = Response.redirect(href);
  expect(response.headers.get("Location")).toBe(href);
});
