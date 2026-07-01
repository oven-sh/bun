import { expect, test } from "bun:test";
import { format, parse } from "node:url";

// https://github.com/oven-sh/bun/issues/28751

test("url.format preserves all decoded colons in auth credentials", () => {
  const user = encodeURIComponent("us:er");
  const password = encodeURIComponent("pass:word");
  const uri = "http://" + user + ":" + password + "@localhost/";

  const parsed = parse(uri);
  expect(parsed.auth).toBe("us:er:pass:word");

  const formatted = format(parsed);
  expect(formatted).toBe("http://us:er:pass:word@localhost/");
});
