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

  // Node accepts any object that duck-types as a WHATWG URL (truthy href and
  // protocol, no legacy url.parse() fields) and reads protocol/hostname/pathname
  // off it directly.
  test("URL-like object", () => {
    const duck = (hostname, pathname) => ({
      href: "file://placeholder",
      protocol: "file:",
      hostname,
      pathname,
    });

    // POSIX path
    assert.strictEqual(url.fileURLToPath(duck("", "/tmp"), { windows: false }), "/tmp");
    assert.strictEqual(url.fileURLToPath(duck("", "/a%20b"), { windows: false }), "/a b");
    assert.strictEqual(
      url.fileURLToPath(
        { __proto__: null, href: "x", protocol: "file:", hostname: "", pathname: "/tmp" },
        { windows: false },
      ),
      "/tmp",
    );

    // Windows path
    assert.strictEqual(url.fileURLToPath(duck("", "/C:/tmp"), { windows: true }), "C:\\tmp");
    assert.strictEqual(url.fileURLToPath(duck("server", "/share"), { windows: true }), "\\\\server\\share");

    // Host platform default: no options, or `windows` nullish (Node uses `??`).
    if (isWindows) {
      assert.strictEqual(url.fileURLToPath(duck("", "/C:/tmp")), "C:\\tmp");
      assert.strictEqual(url.fileURLToPath(duck("", "/C:/tmp"), { windows: null }), "C:\\tmp");
      assert.strictEqual(url.fileURLToPath(duck("", "/C:/tmp"), { windows: undefined }), "C:\\tmp");
    } else {
      assert.strictEqual(url.fileURLToPath(duck("", "/tmp")), "/tmp");
      assert.strictEqual(url.fileURLToPath(duck("", "/tmp"), { windows: null }), "/tmp");
      assert.strictEqual(url.fileURLToPath(duck("", "/tmp"), { windows: undefined }), "/tmp");
    }

    // Protocol mismatch
    assert.throws(() => url.fileURLToPath({ href: "http://x", protocol: "http:", hostname: "", pathname: "/" }), {
      code: "ERR_INVALID_URL_SCHEME",
    });

    // Node reads `hostname` directly: anything !== "" (including undefined) is
    // rejected on POSIX.
    assert.throws(() => url.fileURLToPath({ href: "file:///tmp", protocol: "file:" }, { windows: false }), {
      code: "ERR_INVALID_FILE_URL_HOST",
    });
    assert.throws(() => url.fileURLToPath(duck("host", "/tmp"), { windows: false }), {
      code: "ERR_INVALID_FILE_URL_HOST",
    });

    // Encoded separators
    assert.throws(() => url.fileURLToPath(duck("", "/a%2Fb"), { windows: false }), {
      code: "ERR_INVALID_FILE_URL_PATH",
    });
    assert.throws(() => url.fileURLToPath(duck("", "/C:/a%5Cb"), { windows: true }), {
      code: "ERR_INVALID_FILE_URL_PATH",
    });

    // No drive letter on Windows
    assert.throws(() => url.fileURLToPath(duck("", "/tmp"), { windows: true }), {
      code: "ERR_INVALID_FILE_URL_PATH",
    });

    // Legacy url.parse() results have `auth` / `path` set and must be rejected.
    assert.throws(() => url.fileURLToPath({ href: "file:///tmp", protocol: "file:", auth: null, path: "/tmp" }), {
      code: "ERR_INVALID_ARG_TYPE",
    });
    assert.throws(() => url.fileURLToPath(url.parse("file:///tmp")), { code: "ERR_INVALID_ARG_TYPE" });

    // Still rejects plain non-URL-like values.
    for (const arg of [null, undefined, 1, true, {}, [], () => {}]) {
      assert.throws(() => url.fileURLToPath(arg), { code: "ERR_INVALID_ARG_TYPE" });
    }
  });
});
