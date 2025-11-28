import { describe, test } from "bun:test";
import assert from "node:assert";
import url, { URL } from "node:url";

describe("url.format", () => {
  test("WHATWG", () => {
    const myURL = new URL("http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    // Test default behavior - should include auth
    assert.strictEqual(url.format(myURL), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    assert.strictEqual(url.format(myURL, {}), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    // TODO: Support this kind of assert.throws.
    // {
    //   [true, 1, "test", Infinity].forEach(value => {
    //     assert.throws(() => url.format(myURL, value), {
    //       code: "ERR_INVALID_ARG_TYPE",
    //       name: "TypeError",
    //       message: 'The "options" argument must be of type object.',
    //     });
    //   });
    // }

    // Any falsy value other than undefined will be treated as false.
    // Any truthy value will be treated as true.

    assert.strictEqual(url.format(myURL, { auth: false }), "http://xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    assert.strictEqual(url.format(myURL, { auth: "" }), "http://xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    assert.strictEqual(url.format(myURL, { auth: 0 }), "http://xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    // Truthy values should include auth
    assert.strictEqual(url.format(myURL, { auth: 1 }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    assert.strictEqual(url.format(myURL, { auth: {} }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    // assert.strictEqual(url.format(myURL, { fragment: false }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b");

    // assert.strictEqual(url.format(myURL, { fragment: "" }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b");

    // assert.strictEqual(url.format(myURL, { fragment: 0 }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b");

    // assert.strictEqual(url.format(myURL, { fragment: 1 }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    // assert.strictEqual(url.format(myURL, { fragment: {} }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    // assert.strictEqual(url.format(myURL, { search: false }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a#c");

    // assert.strictEqual(url.format(myURL, { search: "" }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a#c");

    // assert.strictEqual(url.format(myURL, { search: 0 }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a#c");

    // assert.strictEqual(url.format(myURL, { search: 1 }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    // assert.strictEqual(url.format(myURL, { search: {} }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    // assert.strictEqual(url.format(myURL, { unicode: true }), "http://user:pass@理容ナカムラ.com/a?a=b#c");

    // assert.strictEqual(url.format(myURL, { unicode: 1 }), "http://user:pass@理容ナカムラ.com/a?a=b#c");

    // assert.strictEqual(url.format(myURL, { unicode: {} }), "http://user:pass@理容ナカムラ.com/a?a=b#c");

    // assert.strictEqual(url.format(myURL, { unicode: false }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    // assert.strictEqual(url.format(myURL, { unicode: 0 }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    // assert.strictEqual(
    //   url.format(new URL("http://user:pass@xn--0zwm56d.com:8080/path"), { unicode: true }),
    //   "http://user:pass@测试.com:8080/path",
    // );

    assert.strictEqual(url.format(new URL("tel:123")), url.format(new URL("tel:123"), { unicode: true }));
  });

  test("Issue #24343 - username and password preserved by default", () => {
    // The bug: url.format removes username and password from WHATWG URL objects
    assert.strictEqual(url.format(new URL("https://a:b@example.org/")), "https://a:b@example.org/");

    // Test with only username
    assert.strictEqual(url.format(new URL("https://user@example.org/")), "https://user@example.org/");

    // Test with only password (username is empty)
    assert.strictEqual(url.format(new URL("https://:pass@example.org/")), "https://:pass@example.org/");

    // Test with no auth
    assert.strictEqual(url.format(new URL("https://example.org/")), "https://example.org/");

    // Test that auth can be disabled with options
    assert.strictEqual(url.format(new URL("https://a:b@example.org/"), { auth: false }), "https://example.org/");

    // Test with special characters in auth (should not double-encode)
    // WHATWG URL stores "user name" as "user%20name" and "p@ss" as "p%40ss"
    // url.format should output the same encoded form, not double-encode to "user%2520name:p%2540ss"
    assert.strictEqual(
      url.format(new URL("https://user%20name:p%40ss@example.org/")),
      "https://user%20name:p%40ss@example.org/",
    );
  });
});
