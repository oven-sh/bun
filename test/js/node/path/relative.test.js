import { describe, test } from "bun:test";
import { isWindows } from "harness";
import assert from "node:assert";
import path from "node:path";

describe("path.relative", () => {
  test("general", () => {
    const failures = [];

    const relativeTests = [
      [
        path.win32.relative,
        // Arguments                     result
        [
          ["c:/blah\\blah", "d:/games", "d:\\games"],
          ["c:/aaaa/bbbb", "c:/aaaa", ".."],
          ["c:/aaaa/bbbb", "c:/cccc", "..\\..\\cccc"],
          ["c:/aaaa/bbbb", "c:/aaaa/bbbb", ""],
          ["c:/aaaa/bbbb", "c:/aaaa/cccc", "..\\cccc"],
          ["c:/aaaa/", "c:/aaaa/cccc", "cccc"],
          ["c:/", "c:\\aaaa\\bbbb", "aaaa\\bbbb"],
          ["c:/aaaa/bbbb", "d:\\", "d:\\"],
          ["c:/AaAa/bbbb", "c:/aaaa/bbbb", ""],
          ["c:/aaaaa/", "c:/aaaa/cccc", "..\\aaaa\\cccc"],
          ["C:\\foo\\bar\\baz\\quux", "C:\\", "..\\..\\..\\.."],
          ["C:\\foo\\test", "C:\\foo\\test\\bar\\package.json", "bar\\package.json"],
          ["C:\\foo\\bar\\baz-quux", "C:\\foo\\bar\\baz", "..\\baz"],
          ["C:\\foo\\bar\\baz", "C:\\foo\\bar\\baz-quux", "..\\baz-quux"],
          ["\\\\foo\\bar", "\\\\foo\\bar\\baz", "baz"],
          ["\\\\foo\\bar\\baz", "\\\\foo\\bar", ".."],
          ["\\\\foo\\bar\\baz-quux", "\\\\foo\\bar\\baz", "..\\baz"],
          ["\\\\foo\\bar\\baz", "\\\\foo\\bar\\baz-quux", "..\\baz-quux"],
          ["C:\\baz-quux", "C:\\baz", "..\\baz"],
          ["C:\\baz", "C:\\baz-quux", "..\\baz-quux"],
          ["\\\\foo\\baz-quux", "\\\\foo\\baz", "..\\baz"],
          ["\\\\foo\\baz", "\\\\foo\\baz-quux", "..\\baz-quux"],
          ["C:\\baz", "\\\\foo\\bar\\baz", "\\\\foo\\bar\\baz"],
          ["\\\\foo\\bar\\baz", "C:\\baz", "C:\\baz"],
          // Slash-rooted (no drive letter) inputs that hit the last_common_sep=Some(3) overshoot.
          // win32.resolve pulls a device root from cwd, so expected values only hold on a POSIX host.
          ...(isWindows
            ? []
            : [
                ["/x..", "/x.", ""],
                ["/xy.", "/xy", ""],
                ["/abc", "/ab", ""],
                ["\\x..", "\\x.", ""],
                ["\\ab.", "\\ab", ""],
                ["/xyz.", "/xy", ".."],
                ["/xyzw", "/xy", ".."],
                ["/abcde", "/ab", ".."],
                ["/x.", "/x..", "."],
              ]),
        ],
      ],
      [
        path.posix.relative,
        // Arguments          result
        [
          ["/var/lib", "/var", ".."],
          ["/var/lib", "/bin", "../../bin"],
          ["/var/lib", "/var/lib", ""],
          ["/var/lib", "/var/apache", "../apache"],
          ["/var/", "/var/lib", "lib"],
          ["/", "/var/lib", "var/lib"],
          ["/foo/test", "/foo/test/bar/package.json", "bar/package.json"],
          ["/Users/a/web/b/test/mails", "/Users/a/web/b", "../.."],
          ["/foo/bar/baz-quux", "/foo/bar/baz", "../baz"],
          ["/foo/bar/baz", "/foo/bar/baz-quux", "../baz-quux"],
          ["/baz-quux", "/baz", "../baz"],
          ["/baz", "/baz-quux", "../baz-quux"],
          ["/page1/page2/foo", "/", "../../.."],
        ],
      ],
    ];
    relativeTests.forEach(test => {
      const relative = test[0];
      test[1].forEach(test => {
        const actual = relative(test[0], test[1]);
        const expected = test[2];
        if (actual !== expected) {
          const os = relative === path.win32.relative ? "win32" : "posix";
          const message = `path.${os}.relative(${test
            .slice(0, 2)
            .map(JSON.stringify)
            .join(",")})\n  expect=${JSON.stringify(expected)}\n  actual=${JSON.stringify(actual)}`;
          failures.push(`\n${message}`);
        }
      });
    });
    assert.strictEqual(failures.length, 0, failures.join(""));
  });

  test("very long paths", () => {
    // Regression test: buffer overflow with very long paths
    // This used to panic because the buffer didn't account for the null terminator
    const longPath1 = "/home/" + "a".repeat(50000);
    const longPath2 = "/home/" + "b".repeat(50000);
    const result = path.relative(longPath1, longPath2);
    // Should return something like "../bbb...bbb"
    assert.ok(result.startsWith(".."));
    assert.ok(result.includes("b"));
  });

  // Node answers "" for `from === to` before it looks at either operand:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/path.js#L1360
  test("equal operands answer the empty string, whatever they hold", () => {
    // A copy out of bytes is another string: a literal and JSON.parse hand out one string for equal short texts.
    const anotherString = text =>
      /^[\x00-\xff]*$/.test(text)
        ? Buffer.from(text, "latin1").toString("latin1")
        : Buffer.from(text, "utf16le").toString("utf16le");
    const texts = [
      "",
      ".",
      "..",
      "a",
      "a/b",
      "../a",
      "/",
      "//",
      "/a/./b",
      "/a/../b",
      "/var/lib",
      "/var/lib/",
      "c:/aaaa/bbbb",
      "C:\\a\\..\\b",
      "\\\\server\\share\\a",
      "é",
      "/é/ü.txt",
      "/日本/語",
      "x".repeat(600),
      "/" + "y".repeat(5000),
    ];
    const failures = [];
    for (const [flavor, { relative }] of Object.entries({ posix: path.posix, win32: path.win32 })) {
      for (const text of texts) {
        const answers = [
          relative(text, text),
          relative(text, anotherString(text)),
          relative(anotherString(text), text),
          relative(anotherString(text), anotherString(text)),
        ];
        if (answers.some(answer => answer !== "")) failures.push([flavor, text.slice(0, 40), answers]);
      }
      const noString = {};
      for (const operand of [5, noString, undefined]) {
        assert.throws(() => relative(operand, operand), { code: "ERR_INVALID_ARG_TYPE", name: "TypeError" });
      }
    }
    assert.deepStrictEqual(failures, []);
  });

  test("operands of one length that differ", () => {
    const failures = [];
    for (const [relative, cases] of [
      [
        path.posix.relative,
        [
          ["/", "/", ""],
          ["/a", "/b", "../b"],
          ["/aaa", "/aab", "../aab"],
          ["/a/b", "/a/c", "../c"],
          ["/ab/c", "/ab/d", "../d"],
          ["/a/b/c", "/a/b/d", "../d"],
          ["/var/lib", "/var/bin", "../bin"],
          ["/a/bb", "/a/b/", "../b"],
          ["/a/b/", "/a/bb", "../bb"],
          ["/a/", "/a/", ""],
          ["/a/.", "/a/b", "b"],
          ["/a/b", "/a/.", ".."],
          ["/a/..", "/b/..", ""],
          ["/a/./b", "/a/./c", "../c"],
          ["/a//b", "/a/c/", "../c"],
          ["/x/../a", "/y/../b", "../b"],
          ["a/b", "a/c", "../c"],
          ["./a", "./b", "../b"],
          ["/" + "a".repeat(600) + "/b", "/" + "a".repeat(600) + "/c", "../c"],
        ],
      ],
      [
        path.win32.relative,
        [
          ["c:/aaaa/bbbb", "c:/aaaa/cccc", "..\\cccc"],
          ["c:\\a\\b", "c:\\a\\c", "..\\c"],
          ["C:\\a", "c:\\A", ""],
          ["\\\\s\\h\\a", "\\\\s\\h\\b", "..\\b"],
        ],
      ],
    ]) {
      for (const [from, to, expected] of cases) {
        assert.strictEqual(from.length, to.length);
        const actual = relative(from, to);
        if (actual !== expected) failures.push([from.slice(0, 40), to.slice(0, 40), actual, expected]);
      }
    }
    assert.deepStrictEqual(failures, []);
  });
});
