import { describe, test } from "bun:test";
import assert from "node:assert";
import path from "node:path";

describe("path.join", () => {
  test("general", () => {
    const failures = [];
    const backslashRE = /\\/g;

    const joinTests = [
      [
        [path.posix.join, path.win32.join],
        // Arguments                     result
        [
          [[".", "x/b", "..", "/b/c.js"], "x/b/c.js"],
          [[], "."],
          [["/.", "x/b", "..", "/b/c.js"], "/x/b/c.js"],
          [["/foo", "../../../bar"], "/bar"],
          [["foo", "../../../bar"], "../../bar"],
          [["foo/", "../../../bar"], "../../bar"],
          [["foo/x", "../../../bar"], "../bar"],
          [["foo/x", "./bar"], "foo/x/bar"],
          [["foo/x/", "./bar"], "foo/x/bar"],
          [["foo/x/", ".", "bar"], "foo/x/bar"],
          [["./"], "./"],
          [[".", "./"], "./"],
          [[".", ".", "."], "."],
          [[".", "./", "."], "."],
          [[".", "/./", "."], "."],
          [[".", "/////./", "."], "."],
          [["."], "."],
          [["", "."], "."],
          [["", "foo"], "foo"],
          [["foo", "/bar"], "foo/bar"],
          [["", "/foo"], "/foo"],
          [["", "", "/foo"], "/foo"],
          [["", "", "foo"], "foo"],
          [["foo", ""], "foo"],
          [["foo/", ""], "foo/"],
          [["foo", "", "/bar"], "foo/bar"],
          [["./", "..", "/foo"], "../foo"],
          [["./", "..", "..", "/foo"], "../../foo"],
          [[".", "..", "..", "/foo"], "../../foo"],
          [["", "..", "..", "/foo"], "../../foo"],
          [["/"], "/"],
          [["/", "."], "/"],
          [["/", ".."], "/"],
          [["/", "..", ".."], "/"],
          [[""], "."],
          [["", ""], "."],
          [[" /foo"], " /foo"],
          [[" ", "foo"], " /foo"],
          [[" ", "."], " "],
          [[" ", "/"], " /"],
          [[" ", ""], " "],
          [["/", "foo"], "/foo"],
          [["/", "/foo"], "/foo"],
          [["/", "//foo"], "/foo"],
          [["/", "", "/foo"], "/foo"],
          [["", "/", "foo"], "/foo"],
          [["", "/", "/foo"], "/foo"],
        ],
      ],
    ];

    // Windows-specific join tests
    joinTests.push([
      path.win32.join,
      joinTests[0][1].slice(0).concat([
        // Arguments                     result
        // UNC path expected
        [["//foo/bar"], "\\\\foo\\bar\\"],
        [["\\/foo/bar"], "\\\\foo\\bar\\"],
        [["\\\\foo/bar"], "\\\\foo\\bar\\"],
        // UNC path expected - server and share separate
        [["//foo", "bar"], "\\\\foo\\bar\\"],
        [["//foo/", "bar"], "\\\\foo\\bar\\"],
        [["//foo", "/bar"], "\\\\foo\\bar\\"],
        // UNC path expected - questionable
        [["//foo", "", "bar"], "\\\\foo\\bar\\"],
        [["//foo/", "", "bar"], "\\\\foo\\bar\\"],
        [["//foo/", "", "/bar"], "\\\\foo\\bar\\"],
        // UNC path expected - even more questionable
        [["", "//foo", "bar"], "\\\\foo\\bar\\"],
        [["", "//foo/", "bar"], "\\\\foo\\bar\\"],
        [["", "//foo/", "/bar"], "\\\\foo\\bar\\"],
        // No UNC path expected (no double slash in first component)
        [["\\", "foo/bar"], "\\foo\\bar"],
        [["\\", "/foo/bar"], "\\foo\\bar"],
        [["", "/", "/foo/bar"], "\\foo\\bar"],
        // No UNC path expected (no non-slashes in first component -
        // questionable)
        [["//", "foo/bar"], "\\foo\\bar"],
        [["//", "/foo/bar"], "\\foo\\bar"],
        [["\\\\", "/", "/foo/bar"], "\\foo\\bar"],
        [["//"], "\\"],
        // No UNC path expected (share name missing - questionable).
        [["//foo"], "\\foo"],
        [["//foo/"], "\\foo\\"],
        [["//foo", "/"], "\\foo\\"],
        [["//foo", "", "/"], "\\foo\\"],
        // No UNC path expected (too many leading slashes - questionable)
        [["///foo/bar"], "\\foo\\bar"],
        [["////foo", "bar"], "\\foo\\bar"],
        [["\\\\\\/foo/bar"], "\\foo\\bar"],
        // Drive-relative vs drive-absolute paths. This merely describes the
        // status quo, rather than being obviously right
        [["c:"], "c:."],
        [["c:."], "c:."],
        [["c:", ""], "c:."],
        [["", "c:"], "c:."],
        [["c:.", "/"], "c:.\\"],
        [["c:.", "file"], "c:file"],
        [["c:", "/"], "c:\\"],
        [["c:", "file"], "c:\\file"],
      ]),
    ]);
    joinTests.forEach(test => {
      if (!Array.isArray(test[0])) test[0] = [test[0]];
      test[0].forEach(join => {
        test[1].forEach(test => {
          const actual = join.apply(null, test[0]);
          const expected = test[1];
          // For non-Windows specific tests with the Windows join(), we need to try
          // replacing the slashes since the non-Windows specific tests' `expected`
          // use forward slashes
          let actualAlt;
          let os;
          if (join === path.win32.join) {
            actualAlt = actual.replace(backslashRE, "/");
            os = "win32";
          } else {
            os = "posix";
          }
          if (actual !== expected && actualAlt !== expected) {
            const delimiter = test[0].map(JSON.stringify).join(",");
            const message = `path.${os}.join(${delimiter})\n  expect=${JSON.stringify(
              expected,
            )}\n  actual=${JSON.stringify(actual)}`;
            failures.push(`\n${message}`);
          }
        });
      });
    });

    assert.strictEqual(failures.length, 0, failures.join(""));
  });

  test("more than 65535 arguments", () => {
    // The argument count used to cross the C++/native boundary as a uint16_t,
    // so path.join(...70000 args) silently joined only (70000 & 0xffff) = 4464
    // of them and path.join(...65536 args) saw 0 args and returned ".".
    const n = 70000;
    const args = new Array(n).fill("a");
    const expectedLen = n * 2 - 1;

    const posix = path.posix.join(...args);
    assert.strictEqual(posix.length, expectedLen);
    assert.strictEqual(posix.slice(0, 3), "a/a");
    assert.strictEqual(posix.slice(-3), "a/a");

    const win32 = path.win32.join(...args);
    assert.strictEqual(win32.length, expectedLen);
    assert.strictEqual(win32.slice(0, 3), "a\\a");
    assert.strictEqual(win32.slice(-3), "a\\a");
  });
});
