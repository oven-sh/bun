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

  describe("with 65536 or more arguments", () => {
    const empty = new Array(65535).fill("");
    for (const [name, join, sep] of [
      ["posix", path.posix.join, "/"],
      ["win32", path.win32.join, "\\"],
    ]) {
      test(name, () => {
        // 65537 arguments. join() skips the empty strings.
        assert.strictEqual(join("x", ...empty, "y"), `x${sep}y`);
        // 65536 and 65537 arguments with an invalid one in front.
        assert.throws(() => join(123, ...empty), { code: "ERR_INVALID_ARG_TYPE" });
        assert.throws(() => join("a", 123, ...empty), { code: "ERR_INVALID_ARG_TYPE" });
        assert.throws(() => Reflect.apply(join, undefined, [123, ...empty]), { code: "ERR_INVALID_ARG_TYPE" });
      });
    }
  });
});
