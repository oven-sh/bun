import { describe, expect, test } from "bun:test";
import assert from "node:assert";
import url, { URL } from "node:url";

describe("url.format", () => {
  test("WHATWG URL with credentials", () => {
    const myURL = new URL("http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    // Default should include credentials
    assert.strictEqual(url.format(myURL), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");
    assert.strictEqual(url.format(myURL, {}), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    // Invalid options should throw
    [true, 1, "test", Infinity].forEach(value => {
      expect(() => url.format(myURL, value)).toThrow(TypeError);
    });

    // Any falsy value other than undefined will be treated as false.
    // Any truthy value will be treated as true.

    // auth: false should strip credentials
    assert.strictEqual(url.format(myURL, { auth: false }), "http://xn--lck1c3crb1723bpq4a.com/a?a=b#c");
    assert.strictEqual(url.format(myURL, { auth: "" }), "http://xn--lck1c3crb1723bpq4a.com/a?a=b#c");
    assert.strictEqual(url.format(myURL, { auth: 0 }), "http://xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    // auth: truthy should include credentials
    assert.strictEqual(url.format(myURL, { auth: 1 }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");
    assert.strictEqual(url.format(myURL, { auth: {} }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    // fragment: false should strip hash
    assert.strictEqual(url.format(myURL, { fragment: false }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b");
    assert.strictEqual(url.format(myURL, { fragment: "" }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b");
    assert.strictEqual(url.format(myURL, { fragment: 0 }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b");

    // fragment: truthy should include hash
    assert.strictEqual(url.format(myURL, { fragment: 1 }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");
    assert.strictEqual(url.format(myURL, { fragment: {} }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    // search: false should strip search
    assert.strictEqual(url.format(myURL, { search: false }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a#c");
    assert.strictEqual(url.format(myURL, { search: "" }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a#c");
    assert.strictEqual(url.format(myURL, { search: 0 }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a#c");

    // search: truthy should include search
    assert.strictEqual(url.format(myURL, { search: 1 }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");
    assert.strictEqual(url.format(myURL, { search: {} }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    // unicode: true should convert punycode to unicode
    assert.strictEqual(url.format(myURL, { unicode: true }), "http://user:pass@理容ナカムラ.com/a?a=b#c");
    assert.strictEqual(url.format(myURL, { unicode: 1 }), "http://user:pass@理容ナカムラ.com/a?a=b#c");
    assert.strictEqual(url.format(myURL, { unicode: {} }), "http://user:pass@理容ナカムラ.com/a?a=b#c");

    // unicode: false/default should keep punycode
    assert.strictEqual(url.format(myURL, { unicode: false }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");
    assert.strictEqual(url.format(myURL, { unicode: 0 }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    // Test with port
    assert.strictEqual(
      url.format(new URL("http://user:pass@xn--0zwm56d.com:8080/path"), { unicode: true }),
      "http://user:pass@测试.com:8080/path",
    );

    // tel: URLs should be equal with or without unicode option
    assert.strictEqual(url.format(new URL("tel:123")), url.format(new URL("tel:123"), { unicode: true }));
  });

  test("regression test for issue #24343 - credentials stripped from URL", () => {
    // The original bug report
    const myURL = new URL("https://a:b@example.org/");
    assert.strictEqual(url.format(myURL), "https://a:b@example.org/");
  });
});
