import { expect, test } from "bun:test";
import url from "node:url";

// https://github.com/oven-sh/bun/issues/24343
// url.format() strips username and password from WHATWG URL objects
test("url.format() preserves credentials from WHATWG URL objects", () => {
  const myURL = new URL("https://a:b@example.org/");
  expect(url.format(myURL)).toBe("https://a:b@example.org/");
});
