// https://github.com/oven-sh/bun/issues/24191
// `url.domainToASCII` should return an empty string for invalid domains, not throw an error

import { expect, test } from "bun:test";
import url from "node:url";

test("domainToASCII should not throw for invalid punycode with unicode", () => {
  // The primary issue from the bug report: invalid punycode with unicode characters
  // This was throwing "TypeError: domainToASCII failed" but should return empty string
  expect(url.domainToASCII("xn--iñvalid.com")).toBe("");
});

test("domainToUnicode should not throw for invalid domains", () => {
  // Should also return empty string for invalid domains, not throw
  expect(url.domainToUnicode("xn--iñvalid.com")).toBe("");
});
