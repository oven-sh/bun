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

  // Matches Node >= v22 behavior (CVE-2024-36139): join skips normalization
  // when a joined part is a DOS reserved device name, leaving ".." segments
  // uncollapsed, and normalize prefixes drive-like relative results with ".\".
  // Expected values verified against Node v26.3.0.
  test("win32 reserved device names and drive-like relative paths", () => {
    assert.strictEqual(path.win32.join("uploads", "c:"), ".\\uploads\\c:");
    assert.strictEqual(path.win32.join("uploads", "..", "c:"), ".\\c:");
    assert.strictEqual(path.win32.join("a", "b", "c:"), ".\\a\\b\\c:");
    assert.strictEqual(path.win32.join("a", "b:"), ".\\a\\b:");
    assert.strictEqual(path.win32.join("a", ":"), ".\\a\\:");
    // Reserved device name in a part: ".." stays uncollapsed.
    assert.strictEqual(path.win32.join("uploads", "..\\CON:"), "uploads\\..\\CON:");
    assert.strictEqual(path.win32.join("a", "NUL:", "..", ".."), "a\\NUL:\\..\\..");
    assert.strictEqual(path.win32.join("a", "CON:", "b"), "a\\CON:\\b");
    assert.strictEqual(path.win32.join("a\\CON:"), "a\\CON:");
    assert.strictEqual(path.win32.join("CON:"), "CON:");
    assert.strictEqual(path.win32.join("nul:"), "nul:");
    assert.strictEqual(path.win32.join("CON:", ""), "CON:");
    assert.strictEqual(path.win32.join("", "CON:"), "CON:");
    assert.strictEqual(path.win32.join("C:", "CON:"), "C:\\CON:");
    assert.strictEqual(path.win32.join("\\\\server", "share", "CON:"), "\\\\server\\share\\CON:");
    // Parts are split on "\" only, so a "/" keeps the name out of part
    // position and normalization still runs.
    assert.strictEqual(path.win32.join("uploads", "../CON:"), ".\\CON:");
    assert.strictEqual(path.win32.join("a/CON:", "b"), ".\\a\\CON:\\b");
    // Not reserved.
    assert.strictEqual(path.win32.join("COM1", "x"), "COM1\\x");
    assert.strictEqual(path.win32.join("c:", "foo"), "c:\\foo");
  });
});
