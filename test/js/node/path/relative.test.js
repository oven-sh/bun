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
          // Slash-rooted (no drive letter) inputs where the shorter side has
          // trimmed length 2 and is a proper prefix of the other. Node's JS
          // falls through to String#slice with an inverted range, which
          // yields ""; a naive Rust slice with the same indices panics.
          // These resolve through process.cwd() for a device root, so the
          // expected values below only hold on a POSIX host (where cwd has
          // no drive letter and resolve("/x.") yields "\\x.").
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
});
