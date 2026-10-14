import { describe, test } from "bun:test";
import { isWindows } from "harness";
import assert from "node:assert";
import url, { URL } from "node:url";

describe("url.fileURLToPath", () => {
  function testInvalidArgs(...args) {
    for (const arg of args) {
      assert.throws(() => url.fileURLToPath(arg), {
        code: "ERR_INVALID_ARG_TYPE",
      });
    }
  }

  test("invalid input", () => {
    // Input must be string or URL
    testInvalidArgs(null, undefined, 1, {}, true);

    // Input must be a file URL
    assert.throws(() => url.fileURLToPath("https://a/b/c"), {
      code: "ERR_INVALID_URL_SCHEME",
    });

    const withHost = new URL("file://host/a");

    if (isWindows) {
      assert.strictEqual(url.fileURLToPath(withHost), "\\\\host\\a");
    } else {
      assert.throws(() => url.fileURLToPath(withHost), {
        code: "ERR_INVALID_FILE_URL_HOST",
      });
    }

    if (isWindows) {
      assert.throws(() => url.fileURLToPath("file:///C:/a%2F/"), {
        code: "ERR_INVALID_FILE_URL_PATH",
      });
      assert.throws(() => url.fileURLToPath("file:///C:/a%5C/"), {
        code: "ERR_INVALID_FILE_URL_PATH",
      });
      assert.throws(() => url.fileURLToPath("file:///?:/"), {
        code: "ERR_INVALID_FILE_URL_PATH",
      });
    } else {
      assert.throws(() => url.fileURLToPath("file:///a%2F/"), {
        code: "ERR_INVALID_FILE_URL_PATH",
      });
    }
  });

  test("general", () => {
    let testCases;
    if (isWindows) {
      testCases = [
        // Lowercase ascii alpha
        { path: "C:\\foo", fileURL: "file:///C:/foo" },
        // Uppercase ascii alpha
        { path: "C:\\FOO", fileURL: "file:///C:/FOO" },
        // dir
        { path: "C:\\dir\\foo", fileURL: "file:///C:/dir/foo" },
        // trailing separator
        { path: "C:\\dir\\", fileURL: "file:///C:/dir/" },
        // dot
        { path: "C:\\foo.mjs", fileURL: "file:///C:/foo.mjs" },
        // space
        { path: "C:\\foo bar", fileURL: "file:///C:/foo%20bar" },
        // question mark
        { path: "C:\\foo?bar", fileURL: "file:///C:/foo%3Fbar" },
        // number sign
        { path: "C:\\foo#bar", fileURL: "file:///C:/foo%23bar" },
        // ampersand
        { path: "C:\\foo&bar", fileURL: "file:///C:/foo&bar" },
        // equals
        { path: "C:\\foo=bar", fileURL: "file:///C:/foo=bar" },
        // colon
        { path: "C:\\foo:bar", fileURL: "file:///C:/foo:bar" },
        // semicolon
        { path: "C:\\foo;bar", fileURL: "file:///C:/foo;bar" },
        // percent
        { path: "C:\\foo%bar", fileURL: "file:///C:/foo%25bar" },
        // backslash
        { path: "C:\\foo\\bar", fileURL: "file:///C:/foo/bar" },
        // backspace
        { path: "C:\\foo\bbar", fileURL: "file:///C:/foo%08bar" },
        // tab
        { path: "C:\\foo\tbar", fileURL: "file:///C:/foo%09bar" },
        // newline
        { path: "C:\\foo\nbar", fileURL: "file:///C:/foo%0Abar" },
        // carriage return
        { path: "C:\\foo\rbar", fileURL: "file:///C:/foo%0Dbar" },
        // latin1
        { path: "C:\\fóóbàr", fileURL: "file:///C:/f%C3%B3%C3%B3b%C3%A0r" },
        // Euro sign (BMP code point)
        { path: "C:\\€", fileURL: "file:///C:/%E2%82%AC" },
        // Rocket emoji (non-BMP code point)
        { path: "C:\\🚀", fileURL: "file:///C:/%F0%9F%9A%80" },
        // UNC path (see https://docs.microsoft.com/en-us/archive/blogs/ie/file-uris-in-windows)
        { path: "\\\\nas\\My Docs\\File.doc", fileURL: "file://nas/My%20Docs/File.doc" },
      ];
    } else {
      testCases = [
        // Lowercase ascii alpha
        { path: "/foo", fileURL: "file:///foo" },
        // Uppercase ascii alpha
        { path: "/FOO", fileURL: "file:///FOO" },
        // dir
        { path: "/dir/foo", fileURL: "file:///dir/foo" },
        // trailing separator
        { path: "/dir/", fileURL: "file:///dir/" },
        // dot
        { path: "/foo.mjs", fileURL: "file:///foo.mjs" },
        // space
        { path: "/foo bar", fileURL: "file:///foo%20bar" },
        // question mark
        { path: "/foo?bar", fileURL: "file:///foo%3Fbar" },
        // number sign
        { path: "/foo#bar", fileURL: "file:///foo%23bar" },
        // ampersand
        { path: "/foo&bar", fileURL: "file:///foo&bar" },
        // equals
        { path: "/foo=bar", fileURL: "file:///foo=bar" },
        // colon
        { path: "/foo:bar", fileURL: "file:///foo:bar" },
        // semicolon
        { path: "/foo;bar", fileURL: "file:///foo;bar" },
        // percent
        { path: "/foo%bar", fileURL: "file:///foo%25bar" },
        // backslash
        { path: "/foo\\bar", fileURL: "file:///foo%5Cbar" },
        // backspace
        { path: "/foo\bbar", fileURL: "file:///foo%08bar" },
        // tab
        { path: "/foo\tbar", fileURL: "file:///foo%09bar" },
        // newline
        { path: "/foo\nbar", fileURL: "file:///foo%0Abar" },
        // carriage return
        { path: "/foo\rbar", fileURL: "file:///foo%0Dbar" },
        // latin1
        { path: "/fóóbàr", fileURL: "file:///f%C3%B3%C3%B3b%C3%A0r" },
        // Euro sign (BMP code point)
        { path: "/€", fileURL: "file:///%E2%82%AC" },
        // Rocket emoji (non-BMP code point)
        { path: "/🚀", fileURL: "file:///%F0%9F%9A%80" },
      ];
    }

    for (const { path, fileURL } of testCases) {
      const fromString = url.fileURLToPath(fileURL);
      assert.strictEqual(fromString, path);
      const fromURL = url.fileURLToPath(new URL(fileURL));
      assert.strictEqual(fromURL, path);
    }
  });

  // node decodes the pathname with decodeURIComponent(), so these throw its error:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/url.js#L1580-L1598
  describe("a path that does not percent-decode to UTF-8", () => {
    function assertURIMalformed(fn) {
      assert.throws(fn, err => {
        assert.strictEqual(err.name, "URIError");
        assert.strictEqual(err.message, "URI malformed");
        assert.strictEqual(err.code, undefined);
        return true;
      });
    }

    // With no `windows` option the host's native conversion runs. On Windows WTF decodes such a
    // path with U+FFFD in it (oven-sh/WebKit#789), so there only the explicit rules throw.
    const optionsThatThrow = isWindows
      ? [{ windows: false }, { windows: true }]
      : [undefined, {}, { windows: false }, { windows: true }];

    test.each([
      ["a lead byte and then an ASCII character", "50%deposit.db"],
      ["a Latin-1 byte", "caf%E9.db"],
      ["a sequence that ends too soon", "%c3"],
      ["a wrong continuation byte", "%c3%28"],
      ["a continuation byte alone", "%80"],
      ["a byte that UTF-8 never has", "%ff"],
      ["an overlong form", "%C0%80"],
      ["a surrogate", "%ED%A0%80"],
      ["a code point above U+10FFFF", "%F4%90%80%80"],
    ])("%s throws URIError: %s", (_, name) => {
      // A drive letter, so that the win32 rules reach the decode step too.
      const fileURL = "file:///C:/dir/" + name;
      for (const options of optionsThatThrow) {
        assertURIMalformed(() => url.fileURLToPath(fileURL, options));
        assertURIMalformed(() => url.fileURLToPath(new URL(fileURL), options));
      }
    });

    test("the scheme, host and encoded separator checks come first", () => {
      assert.throws(() => url.fileURLToPath("https://example.com/%80"), { code: "ERR_INVALID_URL_SCHEME" });
      assert.throws(() => url.fileURLToPath("file:///C:/%80%2F"), { code: "ERR_INVALID_FILE_URL_PATH" });
      assert.throws(() => url.fileURLToPath("file://host/%80", { windows: false }), {
        code: "ERR_INVALID_FILE_URL_HOST",
      });
      // A UNC path: the host is not an error, so the decode step is reached.
      assertURIMalformed(() => url.fileURLToPath("file://host/share/%80", { windows: true }));
      if (!isWindows) {
        assert.throws(() => url.fileURLToPath("file://host/%80"), { code: "ERR_INVALID_FILE_URL_HOST" });
      }
    });

    test.skipIf(isWindows)("the state of the URL at the time of the call decides", () => {
      const fileURL = new URL("file:///C:/dir/ok.txt");
      const path = url.fileURLToPath(fileURL);
      fileURL.pathname = "/C:/dir/50%deposit.db";
      assertURIMalformed(() => url.fileURLToPath(fileURL));
      fileURL.pathname = "/C:/dir/ok.txt";
      assert.strictEqual(url.fileURLToPath(fileURL), path);
    });

    test("escapes that are UTF-8 decode as before", () => {
      const decoded = [
        ["caf%C3%A9", "café"],
        ["%F0%9F%98%80", "😀"],
        ["%EF%BF%BD", "\uFFFD"],
        ["50%25deposit.db", "50%deposit.db"],
        ["a%20b", "a b"],
      ];
      for (const [escaped, name] of decoded) {
        assert.strictEqual(url.fileURLToPath("file:///C:/dir/" + escaped, { windows: false }), "/C:/dir/" + name);
        assert.strictEqual(url.fileURLToPath("file:///C:/dir/" + escaped, { windows: true }), "C:\\dir\\" + name);
        assert.strictEqual(
          url.fileURLToPath("file:///C:/dir/" + escaped),
          isWindows ? "C:\\dir\\" + name : "/C:/dir/" + name,
        );
      }
    });
  });
});
