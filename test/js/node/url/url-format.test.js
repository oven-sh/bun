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

  test("only slashed protocols get the // authority separator", () => {
    // A protocol-less object never gains a "//", and a non-slashed protocol
    // only gets one when the object was parsed with `slashes`.
    const cases = [
      [{ auth: "u", hostname: "h" }, "u@h"],
      [{ host: "h", pathname: "p" }, "hp"],
      [{ hostname: "h" }, "h"],
      [{ host: "h", pathname: "/p", search: "?q", hash: "#f" }, "h/p?q#f"],
      [{ protocol: "mailto:", host: "h", pathname: "x" }, "mailto:hx"],
      [{ slashes: true, host: "h", pathname: "p" }, "//h/p"],
      [{ slashes: true, pathname: "x/y" }, "///x/y"],
      [{ protocol: "http:", host: "h", pathname: "p" }, "http://h/p"],
      [{ protocol: "http:", pathname: "x/y" }, "http:x/y"],
      [{ protocol: "ftp:", pathname: "/x" }, "ftp:/x"],
      [{ protocol: "gopher:", pathname: "/x" }, "gopher:/x"],
    ];
    for (const [urlObject, expected] of cases) {
      assert.strictEqual(url.format(urlObject), expected, `format(${JSON.stringify(urlObject)})`);
    }
  });

  test("file: keeps its empty authority and never swallows a // pathname", () => {
    // "file:/x/y" and "file://srv/x" mean different things than what was asked
    // for: the latter would name a remote host `srv`.
    const cases = [
      [{ protocol: "file:" }, "file://"],
      [{ protocol: "file:", pathname: "/x/y" }, "file:///x/y"],
      [{ protocol: "file", pathname: "//srv/x" }, "file:////srv/x"],
      [{ protocol: "file:", pathname: "x/y" }, "file://x/y"],
      [{ protocol: "file:", slashes: true, pathname: "x/y" }, "file:///x/y"],
      [{ protocol: "file:", slashes: false, pathname: "/x" }, "file:///x"],
      [{ protocol: "file:", host: "h", pathname: "/x" }, "file://h/x"],
      [{ protocol: "file:", hostname: "h", pathname: "/x" }, "file://h/x"],
    ];
    for (const [urlObject, expected] of cases) {
      assert.strictEqual(url.format(urlObject), expected, `format(${JSON.stringify(urlObject)})`);
    }

    // The host of a formatted file: URL is still empty after re-parsing.
    assert.strictEqual(url.parse(url.format({ protocol: "file", pathname: "//srv/x" })).host, "");
  });

  test("auth is escaped like node: every colon is preserved", () => {
    const cases = [
      [{ auth: "u:p:q", host: "h" }, "u:p:q@h"],
      [{ auth: "u:p:q", hostname: "h", port: 9 }, "u:p:q@h:9"],
      [{ auth: ":::", host: "h" }, ":::@h"],
      // A literal "%3A" in auth is escaped to "%253A", not decoded back to ":".
      [{ auth: "a%3Ab", host: "h" }, "a%253Ab@h"],
      [{ auth: "atslash/@:/@", hostname: "foo", protocol: "http:", pathname: "/" }, "http://atslash%2F%40:%2F%40@foo/"],
    ];
    for (const [urlObject, expected] of cases) {
      assert.strictEqual(url.format(urlObject), expected, `format(${JSON.stringify(urlObject)})`);
    }

    // url.format(url.parse(x)) === x is documented for these.
    for (const href of ["http://u:p:q@h/", "coap:u:p:q@[::1]:61616/a", "http://a:b:c:d@h/x?y#z"]) {
      const parsed = url.parse(href);
      assert.strictEqual(url.format(parsed), href);
      assert.strictEqual(parsed.href, href);
    }
    assert.strictEqual(url.format(url.parse("http://u:p%3Aq@h/")), "http://u:p:q@h/");
  });

  test("an already bracketed IPv6 hostname is not bracketed again", () => {
    const cases = [
      [{ protocol: "http", hostname: "[::1]", port: 8 }, "http://[::1]:8"],
      [{ protocol: "http:", hostname: "[::1]" }, "http://[::1]"],
      [{ protocol: "http:", hostname: "::1", port: 8 }, "http://[::1]:8"],
      [{ hostname: "[::1]" }, "[::1]"],
      [{ hostname: "::1", port: 1 }, "[::1]:1"],
      [{ protocol: "http:", slashes: true, host: "[::1]:8", pathname: "/" }, "http://[::1]:8/"],
    ];
    for (const [urlObject, expected] of cases) {
      assert.strictEqual(url.format(urlObject), expected, `format(${JSON.stringify(urlObject)})`);
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
});
