import { describe, test } from "bun:test";
import assert from "node:assert";
import url from "node:url";

describe("url.format", () => {
  test("slightly wonky content", () => {
    // Formatting tests to verify that it'll format slightly wonky content to a
    // valid URL.
    const formatTests = {
      "http://example.com?": {
        href: "http://example.com/?",
        protocol: "http:",
        slashes: true,
        host: "example.com",
        hostname: "example.com",
        search: "?",
        query: {},
        pathname: "/",
      },
      "http://example.com?foo=bar#frag": {
        href: "http://example.com/?foo=bar#frag",
        protocol: "http:",
        host: "example.com",
        hostname: "example.com",
        hash: "#frag",
        search: "?foo=bar",
        query: "foo=bar",
        pathname: "/",
      },
      "http://example.com?foo=@bar#frag": {
        href: "http://example.com/?foo=@bar#frag",
        protocol: "http:",
        host: "example.com",
        hostname: "example.com",
        hash: "#frag",
        search: "?foo=@bar",
        query: "foo=@bar",
        pathname: "/",
      },
      "http://example.com?foo=/bar/#frag": {
        href: "http://example.com/?foo=/bar/#frag",
        protocol: "http:",
        host: "example.com",
        hostname: "example.com",
        hash: "#frag",
        search: "?foo=/bar/",
        query: "foo=/bar/",
        pathname: "/",
      },
      "http://example.com?foo=?bar/#frag": {
        href: "http://example.com/?foo=?bar/#frag",
        protocol: "http:",
        host: "example.com",
        hostname: "example.com",
        hash: "#frag",
        search: "?foo=?bar/",
        query: "foo=?bar/",
        pathname: "/",
      },
      "http://example.com#frag=?bar/#frag": {
        href: "http://example.com/#frag=?bar/#frag",
        protocol: "http:",
        host: "example.com",
        hostname: "example.com",
        hash: "#frag=?bar/#frag",
        pathname: "/",
      },
      'http://google.com" onload="alert(42)/': {
        href: "http://google.com/%22%20onload=%22alert(42)/",
        protocol: "http:",
        host: "google.com",
        pathname: "/%22%20onload=%22alert(42)/",
      },
      "http://a.com/a/b/c?s#h": {
        href: "http://a.com/a/b/c?s#h",
        protocol: "http",
        host: "a.com",
        pathname: "a/b/c",
        hash: "h",
        search: "s",
      },
      "xmpp:isaacschlueter@jabber.org": {
        href: "xmpp:isaacschlueter@jabber.org",
        protocol: "xmpp:",
        host: "jabber.org",
        auth: "isaacschlueter",
        hostname: "jabber.org",
      },
      "http://atpass:foo%40bar@127.0.0.1/": {
        href: "http://atpass:foo%40bar@127.0.0.1/",
        auth: "atpass:foo@bar",
        hostname: "127.0.0.1",
        protocol: "http:",
        pathname: "/",
      },
      "http://atslash%2F%40:%2F%40@foo/": {
        href: "http://atslash%2F%40:%2F%40@foo/",
        auth: "atslash/@:/@",
        hostname: "foo",
        protocol: "http:",
        pathname: "/",
      },
      "svn+ssh://foo/bar": {
        href: "svn+ssh://foo/bar",
        hostname: "foo",
        protocol: "svn+ssh:",
        pathname: "/bar",
        slashes: true,
      },
      "dash-test://foo/bar": {
        href: "dash-test://foo/bar",
        hostname: "foo",
        protocol: "dash-test:",
        pathname: "/bar",
        slashes: true,
      },
      "dash-test:foo/bar": {
        href: "dash-test:foo/bar",
        hostname: "foo",
        protocol: "dash-test:",
        pathname: "/bar",
      },
      "dot.test://foo/bar": {
        href: "dot.test://foo/bar",
        hostname: "foo",
        protocol: "dot.test:",
        pathname: "/bar",
        slashes: true,
      },
      "dot.test:foo/bar": {
        href: "dot.test:foo/bar",
        hostname: "foo",
        protocol: "dot.test:",
        pathname: "/bar",
      },
      // IPv6 support
      "coap:u:p@[::1]:61616/.well-known/r?n=Temperature": {
        href: "coap:u:p@[::1]:61616/.well-known/r?n=Temperature",
        protocol: "coap:",
        auth: "u:p",
        hostname: "::1",
        port: "61616",
        pathname: "/.well-known/r",
        search: "n=Temperature",
      },
      "coap:[fedc:ba98:7654:3210:fedc:ba98:7654:3210]:61616/s/stopButton": {
        href: "coap:[fedc:ba98:7654:3210:fedc:ba98:7654:3210]:61616/s/stopButton",
        protocol: "coap",
        host: "[fedc:ba98:7654:3210:fedc:ba98:7654:3210]:61616",
        pathname: "/s/stopButton",
      },
      // TODO: Support this.
      //
      // "http://[::]/": {
      //   href: "http://[::]/",
      //   protocol: "http:",
      //   hostname: "[::]",
      //   pathname: "/",
      // },

      // Encode context-specific delimiters in path and query, but do not touch
      // other non-delimiter chars like `%`.
      // <https://github.com/nodejs/node-v0.x-archive/issues/4082>

      // `#`,`?` in path
      "/path/to/%%23%3F+=&.txt?foo=theA1#bar": {
        href: "/path/to/%%23%3F+=&.txt?foo=theA1#bar",
        pathname: "/path/to/%#?+=&.txt",
        query: {
          foo: "theA1",
        },
        hash: "#bar",
      },

      // `#`,`?` in path + `#` in query
      "/path/to/%%23%3F+=&.txt?foo=the%231#bar": {
        href: "/path/to/%%23%3F+=&.txt?foo=the%231#bar",
        pathname: "/path/to/%#?+=&.txt",
        query: {
          foo: "the#1",
        },
        hash: "#bar",
      },

      // `#` in path end + `#` in query
      "/path/to/%%23?foo=the%231#bar": {
        href: "/path/to/%%23?foo=the%231#bar",
        pathname: "/path/to/%#",
        query: {
          foo: "the#1",
        },
        hash: "#bar",
      },

      // `?` and `#` in path and search
      "http://ex.com/foo%3F100%m%23r?abc=the%231?&foo=bar#frag": {
        href: "http://ex.com/foo%3F100%m%23r?abc=the%231?&foo=bar#frag",
        protocol: "http:",
        hostname: "ex.com",
        hash: "#frag",
        search: "?abc=the#1?&foo=bar",
        pathname: "/foo?100%m#r",
      },

      // `?` and `#` in search only
      "http://ex.com/fooA100%mBr?abc=the%231?&foo=bar#frag": {
        href: "http://ex.com/fooA100%mBr?abc=the%231?&foo=bar#frag",
        protocol: "http:",
        hostname: "ex.com",
        hash: "#frag",
        search: "?abc=the#1?&foo=bar",
        pathname: "/fooA100%mBr",
      },
      // TODO: Support these.
      //
      // // Multiple `#` in search
      // "http://example.com/?foo=bar%231%232%233&abc=%234%23%235#frag": {
      //   href: "http://example.com/?foo=bar%231%232%233&abc=%234%23%235#frag",
      //   protocol: "http:",
      //   slashes: true,
      //   host: "example.com",
      //   hostname: "example.com",
      //   hash: "#frag",
      //   search: "?foo=bar#1#2#3&abc=#4##5",
      //   query: {},
      //   pathname: "/",
      // },

      // More than 255 characters in hostname which exceeds the limit
      // [`http://${"a".repeat(255)}.com/node`]: {
      //   href: "http:///node",
      //   protocol: "http:",
      //   slashes: true,
      //   host: "",
      //   hostname: "",
      //   pathname: "/node",
      //   path: "/node",
      // },

      // Greater than or equal to 63 characters after `.` in hostname
      // [`http://www.${"z".repeat(63)}example.com/node`]: {
      //   href: `http://www.${"z".repeat(63)}example.com/node`,
      //   protocol: "http:",
      //   slashes: true,
      //   host: `www.${"z".repeat(63)}example.com`,
      //   hostname: `www.${"z".repeat(63)}example.com`,
      //   pathname: "/node",
      //   path: "/node",
      // },

      // https://github.com/nodejs/node/issues/3361
      // "file:///home/user": {
      //   href: "file:///home/user",
      //   protocol: "file",
      //   pathname: "/home/user",
      //   path: "/home/user",
      // },

      // surrogate in auth
      "http://%F0%9F%98%80@www.example.com/": {
        href: "http://%F0%9F%98%80@www.example.com/",
        protocol: "http:",
        auth: "\uD83D\uDE00",
        hostname: "www.example.com",
        pathname: "/",
      },
    };
    for (const u in formatTests) {
      const expect = formatTests[u].href;
      delete formatTests[u].href;
      const actual = url.format(u);
      const actualObj = url.format(formatTests[u]);
      assert.strictEqual(actual, expect, `wonky format(${u}) == ${expect}\nactual:${actual}`);
      assert.strictEqual(
        actualObj,
        expect,
        `wonky format(${JSON.stringify(formatTests[u])}) == ${expect}\nactual: ${actualObj}`,
      );
    }
  });

  test("format encodes every hash character in the search component", () => {
    // A search string containing more than one "#" must have all of them
    // percent-encoded; otherwise re-parsing the formatted URL truncates the
    // query at the first raw "#" and treats the rest as a fragment.
    const formatted = url.format({
      protocol: "http:",
      hostname: "example.com",
      pathname: "/",
      search: "?foo=bar#1#2#3&abc=#4##5",
    });
    assert.strictEqual(formatted, "http://example.com/?foo=bar%231%232%233&abc=%234%23%235");

    // Re-parsing the formatted URL keeps the entire query intact and produces no fragment.
    const reparsed = url.parse(formatted);
    assert.strictEqual(reparsed.search, "?foo=bar%231%232%233&abc=%234%23%235");
    assert.strictEqual(reparsed.hash, null);

    // A search with a single "#" is still encoded the same way as before.
    assert.strictEqual(
      url.format({ protocol: "http:", hostname: "example.com", pathname: "/", search: "?a=#1" }),
      "http://example.com/?a=%231",
    );
  });

  // An object `query` is serialized with querystring.stringify(), not
  // URLSearchParams, which differ on arrays, spaces and non-primitives.
  describe("serializes an object query with querystring.stringify", () => {
    const cases = [
      ["percent-encodes spaces instead of using +", { a: "1 2" }, "/p?a=1%202"],
      ["expands an array value into repeated keys", { a: ["x", "y"] }, "/p?a=x&a=y"],
      ["omits keys whose value is an empty array", { a: "1", b: [] }, "/p?a=1"],
      [
        "serializes null and undefined as empty values",
        { a: 1, b: null, c: undefined, d: true },
        "/p?a=1&b=&c=&d=true",
      ],
      ["serializes a symbol value as an empty value", { a: Symbol("s") }, "/p?a="],
      ["serializes a non-primitive value as an empty value", { a: { b: 1 } }, "/p?a="],
      ["serializes non-finite numbers as empty values", { a: Infinity, b: NaN }, "/p?a=&b="],
      ["serializes a bigint value", { a: 10n }, "/p?a=10"],
      ["serializes non-primitives inside an array", { a: [1, null, undefined, true] }, "/p?a=1&a=&a=&a=true"],
      ["accepts an array as the whole query object", ["a", "b"], "/p?0=a&1=b"],
      ["produces no search for an empty query object", {}, "/p"],
    ];

    for (const [label, query, expected] of cases) {
      test(label, () => {
        assert.strictEqual(url.format({ pathname: "/p", query }), expected);
      });
    }

    test("an explicit search still takes precedence over query", () => {
      assert.strictEqual(url.format({ pathname: "/p", search: "?z=9", query: { a: 1 } }), "/p?z=9");
    });

    test("keeps repeated keys intact across a parse/mutate/format round trip", () => {
      const parsed = url.parse("http://e.com/p?tag=a&tag=b", true);
      assert.deepStrictEqual(parsed.query.tag, ["a", "b"]);
      parsed.query.tag.push("c");
      parsed.query.note = "q 1";
      parsed.search = undefined;
      assert.strictEqual(url.format(parsed), "http://e.com/p?tag=a&tag=b&tag=c&note=q%201");
    });
  });
});
