import { describe, test } from "bun:test";
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
          // Case-insensitive comparison must fold non-ASCII letters too
          // (Node lowercases the whole resolved path with toLowerCase).
          ["C:\\é", "C:\\É", ""],
          ["C:\\É", "C:\\é", ""],
          ["C:\\aéb", "C:\\AÉB", ""],
          ["C:\\é\\x", "C:\\É\\y", "..\\y"],
          ["C:\\É\\x", "C:\\é\\y", "..\\y"],
          ["C:\\a\\Å\\b", "C:\\A\\å\\c", "..\\c"],
          ["C:\\Ф", "C:\\ф", ""],
          ["C:\\ф\\x", "C:\\Ф\\y", "..\\y"],
          ["C:\\É", "C:\\É\\sub", "sub"],
          ["C:\\É\\sub", "C:\\é", ".."],
          // toLowerCase is not full case-folding: ß stays ß, so ß ≠ SS.
          ["C:\\ß", "C:\\SS", "..\\SS"],
          // Length-changing toLowerCase (İ → i̇, Ⱥ → ⱥ) must not
          // misalign indices into the original toOrig.
          ["C:\\\u0130\\x", "C:\\\u0130\\y", "..\\y"],
          ["C:\\\u0130\\x", "C:\\i\u0307\\y", "..\\y"],
          ["C:\\\u0130", "C:\\\u0130\\sub", "sub"],
          ["C:\\\u0130\\sub", "C:\\\u0130", ".."],
          ["C:\\a\\\u0130\\b\\c", "C:\\a\\\u0130\\x", "..\\..\\x"],
          ["C:\\\u023A\\x", "C:\\\u2C65\\y", "..\\y"],
          ["C:\\\u023A", "C:\\\u2C65", ""],
          ["C:\\\u0130", "D:\\x", "D:\\x"],
          // Shrinking + growing mappings that cancel in total byte length
          // (ẞ→ß 3→2, Ⱥ→ⱥ 2→3) must not slice mid-codepoint.
          ["C:\\\u1E9E\\\u023A", "C:\\\u1E9E\\\u023Ax", "..\\\u023Ax"],
          ["C:\\\u1E9E\\\u023A\\a", "C:\\\u00DF\\\u2C65\\b", "..\\b"],
          // Final_Sigma: Σ at word end lowers to ς (not σ).
          ["C:\\\u0391\u03A3", "C:\\\u03B1\u03C2", ""],
          ["C:\\\u0391\u03A3\\x", "C:\\\u03B1\u03C2\\y", "..\\y"],
          // UNC with non-ASCII: different roots return toOrig; same root
          // compares segments case-insensitively.
          ["\\\\É\\bar", "\\\\baz\\qux", "\\\\baz\\qux\\"],
          ["\\\\É\\bar", "C:\\x", "C:\\x"],
          ["\\\\É\\bar\\a", "\\\\É\\bar\\b", "..\\b"],
          ["\\\\É\\bar", "\\\\é\\BAR\\x", "x"],
          ["\\\\foo\\É", "\\\\foo\\baz", "..\\baz"],
          ["\\\\foo\\É\\a", "\\\\foo\\é\\b", "..\\b"],
          // One side resolves to a bare '\' (degenerate but reachable).
          ["C:\\É", "\\\\", "..\\.."],
          ["\\\\", "\\\\É\\bar", "É\\bar"],
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
