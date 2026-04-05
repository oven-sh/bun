import { expect, test } from "bun:test";
import { format, parse, Url } from "node:url";

test("url.format preserves all decoded colons in auth credentials", () => {
  const user = encodeURIComponent("us:er");
  const password = encodeURIComponent("pass:word");
  const uri = "http://" + user + ":" + password + "@localhost/";

  const parsed = parse(uri);
  expect(parsed.auth).toBe("us:er:pass:word");

  const formatted = format(parsed);
  expect(formatted).toBe("http://us:er:pass:word@localhost/");
});

test("url.format encodes all hash characters in search", () => {
  const u = new Url();
  u.protocol = "http:";
  u.host = "localhost";
  u.pathname = "/";
  u.search = "?foo#bar#baz";
  expect(u.format()).toBe("http://localhost/?foo%23bar%23baz");
});
