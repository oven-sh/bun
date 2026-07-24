import { describe, test } from "bun:test";
import assert from "node:assert";
import url, { URL } from "node:url";

describe("url.format", () => {
  test("WHATWG", () => {
    const myURL = new URL("http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    assert.strictEqual(url.format(myURL), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    assert.strictEqual(url.format(myURL, {}), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    {
      [true, 1, "test", Infinity].forEach(value => {
        assert.throws(() => url.format(myURL, value), {
          code: "ERR_INVALID_ARG_TYPE",
          name: "TypeError",
        });
      });
    }

    // Node only validates a truthy `options` value; falsy values other than
    // undefined are ignored and the defaults apply (auth is kept).
    {
      [false, 0, "", null].forEach(value => {
        assert.strictEqual(url.format(myURL, value), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");
      });
    }

    // An explicit `null` option value is treated the same as undefined: the
    // default applies (Node checks each option with `!= null`).
    {
      ["auth", "fragment", "search", "unicode"].forEach(name => {
        assert.strictEqual(url.format(myURL, { [name]: null }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");
      });
    }

    // Any falsy value other than undefined will be treated as false.
    // Any truthy value will be treated as true.

    assert.strictEqual(url.format(myURL, { auth: false }), "http://xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    assert.strictEqual(url.format(myURL, { auth: "" }), "http://xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    assert.strictEqual(url.format(myURL, { auth: 0 }), "http://xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    assert.strictEqual(url.format(myURL, { auth: 1 }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    assert.strictEqual(url.format(myURL, { auth: {} }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    assert.strictEqual(url.format(myURL, { fragment: false }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b");

    assert.strictEqual(url.format(myURL, { fragment: "" }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b");

    assert.strictEqual(url.format(myURL, { fragment: 0 }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b");

    assert.strictEqual(url.format(myURL, { fragment: 1 }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    assert.strictEqual(url.format(myURL, { fragment: {} }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    assert.strictEqual(url.format(myURL, { search: false }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a#c");

    assert.strictEqual(url.format(myURL, { search: "" }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a#c");

    assert.strictEqual(url.format(myURL, { search: 0 }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a#c");

    assert.strictEqual(url.format(myURL, { search: 1 }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    assert.strictEqual(url.format(myURL, { search: {} }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    assert.strictEqual(url.format(myURL, { unicode: true }), "http://user:pass@理容ナカムラ.com/a?a=b#c");

    assert.strictEqual(url.format(myURL, { unicode: 1 }), "http://user:pass@理容ナカムラ.com/a?a=b#c");

    assert.strictEqual(url.format(myURL, { unicode: {} }), "http://user:pass@理容ナカムラ.com/a?a=b#c");

    assert.strictEqual(url.format(myURL, { unicode: false }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    assert.strictEqual(url.format(myURL, { unicode: 0 }), "http://user:pass@xn--lck1c3crb1723bpq4a.com/a?a=b#c");

    assert.strictEqual(
      url.format(new URL("http://user:pass@xn--0zwm56d.com:8080/path"), { unicode: true }),
      "http://user:pass@测试.com:8080/path",
    );

    assert.strictEqual(url.format(new URL("tel:123")), url.format(new URL("tel:123"), { unicode: true }));
  });

  // https://github.com/oven-sh/bun/issues/24233
  test("WHATWG fragment: false strips the hash", () => {
    const myURL = new URL("https://example.org?abc#foo");
    assert.strictEqual(url.format(myURL, { fragment: false }), "https://example.org/?abc");
  });

  // Previously a WHATWG URL fell into the legacy formatter, which only emits
  // "//" for the slashedProtocol table (http/https/ftp/gopher/file) and reads
  // `.slashes`/`.auth` (both undefined on URL). The result dropped the
  // authority marker and userinfo for every other scheme.
  test("WHATWG non-special schemes keep their authority", () => {
    for (const href of [
      "wss://h:99/x?q",
      "ws://h/x",
      "git+ssh://git@github.com/x.git",
      "myapp://open/x",
      "custom://a.b:8/c",
      "file:///a/b",
      "file://host/a/b",
    ]) {
      const u = new URL(href);
      assert.strictEqual(url.format(u), u.href, href);
      assert.strictEqual(url.format(u, {}), u.href, href);
    }
  });

  test("WHATWG edge cases", () => {
    assert.strictEqual(url.format(new URL("tel:123")), "tel:123");
    assert.strictEqual(url.format(new URL("tel:123"), { unicode: true }), "tel:123");
    assert.strictEqual(url.format(new URL("file:///path"), { unicode: true }), "file:///path");
    assert.strictEqual(url.format(new URL("http://[::1]:8080/path"), { unicode: true }), "http://[::1]:8080/path");
    assert.strictEqual(url.format(new URL("foo://bar/path"), { unicode: true }), "foo://bar/path");
    assert.strictEqual(
      url.format(new URL("http://user@example.com/path"), { auth: true }),
      "http://user@example.com/path",
    );
    assert.strictEqual(
      url.format(new URL("http://user:pass@example.com/path?q#h"), { auth: false, search: false, fragment: false }),
      "http://example.com/path",
    );
    assert.strictEqual(url.format(new URL("blob:http://a/b")), "blob:http://a/b");

    // No authority, path starting with "//": must emit "/." so the result
    // round-trips instead of re-parsing with a host.
    assert.strictEqual(url.format(new URL("web+foo:/.//p")), "web+foo:/.//p");
    assert.strictEqual(new URL(url.format(new URL("web+foo:/.//p"))).pathname, "//p");

    // .search and .hash return "" for both absent and empty; the serializer
    // must keep a bare "?" or "#" that is present in the href.
    assert.strictEqual(url.format(new URL("http://a/?#")), "http://a/?#");
    assert.strictEqual(url.format(new URL("http://a/?#"), { search: false }), "http://a/#");
    assert.strictEqual(url.format(new URL("http://a/?#"), { fragment: false }), "http://a/?");
    assert.strictEqual(url.format(new URL("http://a/?")), "http://a/?");
    assert.strictEqual(url.format(new URL("http://a/#")), "http://a/#");
    assert.strictEqual(url.format(new URL("http://a/#?")), "http://a/#?");
    assert.strictEqual(url.format(new URL("http://a/#?"), { search: false }), "http://a/#?");
    assert.strictEqual(url.format(new URL("http://a/p?q#"), { fragment: false }), "http://a/p?q");

    // Opaque hosts (non-special schemes) keep their case with unicode: true;
    // only labels that literally start with "xn--" are decoded.
    assert.strictEqual(url.format(new URL("foo://EXAMPLE.com/p"), { unicode: true }), "foo://EXAMPLE.com/p");
    assert.strictEqual(url.format(new URL("foo://xn--0zwm56d.example/p"), { unicode: true }), "foo://测试.example/p");
    assert.strictEqual(
      url.format(new URL("foo://XN--0ZWM56D.EXAMPLE/p"), { unicode: true }),
      "foo://XN--0ZWM56D.EXAMPLE/p",
    );
    assert.strictEqual(
      url.format(new URL("foo://Sub.xn--0zwm56d.Example/p"), { unicode: true }),
      "foo://Sub.测试.Example/p",
    );

    // A bare or undecodable "xn--" label becomes an empty label, matching Node.
    assert.strictEqual(url.format(new URL("foo://xn--.a/"), { unicode: true }), "foo://.a/");
    assert.strictEqual(url.format(new URL("foo://xn--a.b/"), { unicode: true }), "foo://.b/");
  });
});
