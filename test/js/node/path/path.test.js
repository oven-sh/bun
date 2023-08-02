const { file } = import.meta;

import { describe, it, expect, test } from "bun:test";
import path from "node:path";
import assert from "assert";
import { hideFromStackTrace } from "harness";

const strictEqual = (...args) => {
  assert.strictEqual(...args);
  expect(true).toBe(true);
};

const expectStrictEqual = (actual, expected) => {
  expect(actual).toBe(expected);
};
hideFromStackTrace(expectStrictEqual);

describe("dirname", () => {
  it("path.dirname", () => {
    const fixtures = [
      ["yo", "."],
      ["/yo", "/"],
      ["/yo/", "/"],
      ["/yo/123", "/yo"],
      [".", "."],
      ["../", "."],
      ["../../", ".."],
      ["../../foo", "../.."],
      ["../../foo/../", "../../foo"],
      ["/foo/../", "/foo"],
      ["../../foo/../bar", "../../foo/.."],
    ];
    for (const [input, expected] of fixtures) {
      expect(path.posix.dirname(input)).toBe(expected);
      if (process.platform !== "win32") {
        expect(path.dirname(input)).toBe(expected);
      }
    }
  });
  it("path.posix.dirname", () => {
    expect(path.posix.dirname("/a/b/")).toBe("/a");
    expect(path.posix.dirname("/a/b")).toBe("/a");
    expect(path.posix.dirname("/a")).toBe("/");
    expect(path.posix.dirname("/a/")).toBe("/");
    expect(path.posix.dirname("")).toBe(".");
    expect(path.posix.dirname("/")).toBe("/");
    expect(path.posix.dirname("//")).toBe("/");
    expect(path.posix.dirname("///")).toBe("/");
    expect(path.posix.dirname("////")).toBe("/");
    expect(path.posix.dirname("//a")).toBe("//");
    expect(path.posix.dirname("//ab")).toBe("//");
    expect(path.posix.dirname("///a")).toBe("//");
    expect(path.posix.dirname("////a")).toBe("///");
    expect(path.posix.dirname("/////a")).toBe("////");
    expect(path.posix.dirname("foo")).toBe(".");
    expect(path.posix.dirname("foo/")).toBe(".");
    expect(path.posix.dirname("a/b")).toBe("a");
    expect(path.posix.dirname("a/")).toBe(".");
    expect(path.posix.dirname("a///b")).toBe("a//");
    expect(path.posix.dirname("a//b")).toBe("a/");
    expect(path.posix.dirname("\\")).toBe(".");
    expect(path.posix.dirname("\\a")).toBe(".");
    expect(path.posix.dirname("a")).toBe(".");
    expect(path.posix.dirname("/a/b//c")).toBe("/a/b/");
    expect(path.posix.dirname("/文檔")).toBe("/");
    expect(path.posix.dirname("/文檔/")).toBe("/");
    expect(path.posix.dirname("/文檔/新建文件夾")).toBe("/文檔");
    expect(path.posix.dirname("/文檔/新建文件夾/")).toBe("/文檔");
    expect(path.posix.dirname("//新建文件夾")).toBe("//");
    expect(path.posix.dirname("///新建文件夾")).toBe("//");
    expect(path.posix.dirname("////新建文件夾")).toBe("///");
    expect(path.posix.dirname("/////新建文件夾")).toBe("////");
    expect(path.posix.dirname("新建文件夾")).toBe(".");
    expect(path.posix.dirname("新建文件夾/")).toBe(".");
    expect(path.posix.dirname("文檔/新建文件夾")).toBe("文檔");
    expect(path.posix.dirname("文檔/")).toBe(".");
    expect(path.posix.dirname("文檔///新建文件夾")).toBe("文檔//");
    expect(path.posix.dirname("文檔//新建文件夾")).toBe("文檔/");
  });
  it("path.win32.dirname", () => {
    expect(path.win32.dirname("c:\\")).toBe("c:\\");
    expect(path.win32.dirname("c:\\foo")).toBe("c:\\");
    expect(path.win32.dirname("c:\\foo\\")).toBe("c:\\");
    expect(path.win32.dirname("c:\\foo\\bar")).toBe("c:\\foo");
    expect(path.win32.dirname("c:\\foo\\bar\\")).toBe("c:\\foo");
    expect(path.win32.dirname("c:\\foo\\bar\\baz")).toBe("c:\\foo\\bar");
    expect(path.win32.dirname("c:\\foo bar\\baz")).toBe("c:\\foo bar");
    expect(path.win32.dirname("c:\\\\foo")).toBe("c:\\");
    expect(path.win32.dirname("\\")).toBe("\\");
    expect(path.win32.dirname("\\foo")).toBe("\\");
    expect(path.win32.dirname("\\foo\\")).toBe("\\");
    expect(path.win32.dirname("\\foo\\bar")).toBe("\\foo");
    expect(path.win32.dirname("\\foo\\bar\\")).toBe("\\foo");
    expect(path.win32.dirname("\\foo\\bar\\baz")).toBe("\\foo\\bar");
    expect(path.win32.dirname("\\foo bar\\baz")).toBe("\\foo bar");
    expect(path.win32.dirname("c:")).toBe("c:");
    expect(path.win32.dirname("c:foo")).toBe("c:");
    expect(path.win32.dirname("c:foo\\")).toBe("c:");
    expect(path.win32.dirname("c:foo\\bar")).toBe("c:foo");
    expect(path.win32.dirname("c:foo\\bar\\")).toBe("c:foo");
    expect(path.win32.dirname("c:foo\\bar\\baz")).toBe("c:foo\\bar");
    expect(path.win32.dirname("c:foo bar\\baz")).toBe("c:foo bar");
    expect(path.win32.dirname("file:stream")).toBe(".");
    expect(path.win32.dirname("dir\\file:stream")).toBe("dir");
    expect(path.win32.dirname("\\\\unc\\share")).toBe("\\\\unc\\share");
    expect(path.win32.dirname("\\\\unc\\share\\foo")).toBe("\\\\unc\\share\\");
    expect(path.win32.dirname("\\\\unc\\share\\foo\\")).toBe("\\\\unc\\share\\");
    expect(path.win32.dirname("\\\\unc\\share\\foo\\bar")).toBe("\\\\unc\\share\\foo");
    expect(path.win32.dirname("\\\\unc\\share\\foo\\bar\\")).toBe("\\\\unc\\share\\foo");
    expect(path.win32.dirname("\\\\unc\\share\\foo\\bar\\baz")).toBe("\\\\unc\\share\\foo\\bar");
    expect(path.win32.dirname("/a/b/")).toBe("/a");
    expect(path.win32.dirname("/a/b")).toBe("/a");
    expect(path.win32.dirname("/a")).toBe("/");
    expect(path.win32.dirname("")).toBe(".");
    expect(path.win32.dirname("/")).toBe("/");
    expect(path.win32.dirname("////")).toBe("/");
    expect(path.win32.dirname("foo")).toBe(".");
    expect(path.win32.dirname("c:\\")).toBe("c:\\");
    expect(path.win32.dirname("c:\\文檔")).toBe("c:\\");
    expect(path.win32.dirname("c:\\文檔\\")).toBe("c:\\");
    expect(path.win32.dirname("c:\\文檔\\新建文件夾")).toBe("c:\\文檔");
    expect(path.win32.dirname("c:\\文檔\\新建文件夾\\")).toBe("c:\\文檔");
    expect(path.win32.dirname("c:\\文檔\\新建文件夾\\baz")).toBe("c:\\文檔\\新建文件夾");
    expect(path.win32.dirname("c:\\文檔 1\\新建文件夾")).toBe("c:\\文檔 1");
    expect(path.win32.dirname("c:\\\\文檔")).toBe("c:\\");
    expect(path.win32.dirname("\\文檔")).toBe("\\");
    expect(path.win32.dirname("\\文檔\\")).toBe("\\");
    expect(path.win32.dirname("\\文檔\\新建文件夾")).toBe("\\文檔");
    expect(path.win32.dirname("\\文檔\\新建文件夾\\")).toBe("\\文檔");
    expect(path.win32.dirname("\\文檔\\新建文件夾\\baz")).toBe("\\文檔\\新建文件夾");
    expect(path.win32.dirname("\\文檔 1\\baz")).toBe("\\文檔 1");
    expect(path.win32.dirname("c:")).toBe("c:");
    expect(path.win32.dirname("c:文檔")).toBe("c:");
    expect(path.win32.dirname("c:文檔\\")).toBe("c:");
    expect(path.win32.dirname("c:文檔\\新建文件夾")).toBe("c:文檔");
    expect(path.win32.dirname("c:文檔\\新建文件夾\\")).toBe("c:文檔");
    expect(path.win32.dirname("c:文檔\\新建文件夾\\baz")).toBe("c:文檔\\新建文件夾");
    expect(path.win32.dirname("c:文檔 1\\baz")).toBe("c:文檔 1");
    expect(path.win32.dirname("/文檔/新建文件夾/")).toBe("/文檔");
    expect(path.win32.dirname("/文檔/新建文件夾")).toBe("/文檔");
    expect(path.win32.dirname("/文檔")).toBe("/");
    expect(path.win32.dirname("新建文件夾")).toBe(".");
  });
});

it("path.parse().name", () => {
  expectStrictEqual(path.parse(file).name, "path.test");
  expectStrictEqual(path.parse(".js").name, ".js");
  expectStrictEqual(path.parse("..js").name, ".");
  expectStrictEqual(path.parse("").name, "");
  expectStrictEqual(path.parse(".").name, ".");
  expectStrictEqual(path.parse("dir/name.ext").name, "name");
  expectStrictEqual(path.parse("/dir/name.ext").name, "name");
  expectStrictEqual(path.parse("/name.ext").name, "name");
  expectStrictEqual(path.parse("name.ext").name, "name");
  expectStrictEqual(path.parse("name.ext/").name, "name");
  expectStrictEqual(path.parse("name.ext//").name, "name");
  expectStrictEqual(path.parse("aaa/bbb").name, "bbb");
  expectStrictEqual(path.parse("aaa/bbb/").name, "bbb");
  expectStrictEqual(path.parse("aaa/bbb//").name, "bbb");
  expectStrictEqual(path.parse("/aaa/bbb").name, "bbb");
  expectStrictEqual(path.parse("/aaa/bbb/").name, "bbb");
  expectStrictEqual(path.parse("/aaa/bbb//").name, "bbb");
  expectStrictEqual(path.parse("//aaa/bbb").name, "bbb");
  expectStrictEqual(path.parse("//aaa/bbb/").name, "bbb");
  expectStrictEqual(path.parse("//aaa/bbb//").name, "bbb");
  expectStrictEqual(path.parse("///aaa").name, "aaa");
  expectStrictEqual(path.parse("//aaa").name, "aaa");
  expectStrictEqual(path.parse("/aaa").name, "aaa");
  expectStrictEqual(path.parse("aaa.").name, "aaa");

  // On unix a backslash is just treated as any other character.
  expectStrictEqual(path.posix.parse("\\dir\\name.ext").name, "\\dir\\name");
  expectStrictEqual(path.posix.parse("\\name.ext").name, "\\name");
  expectStrictEqual(path.posix.parse("name.ext").name, "name");
  expectStrictEqual(path.posix.parse("name.ext\\").name, "name");
  expectStrictEqual(path.posix.parse("name.ext\\\\").name, "name");
});

it("path.parse() windows edition", () => {
  // On Windows a backslash acts as a path separator.
  expectStrictEqual(path.win32.parse("\\dir\\name.ext").name, "name");
  expectStrictEqual(path.win32.parse("\\name.ext").name, "name");
  expectStrictEqual(path.win32.parse("name.ext").name, "name");
  expectStrictEqual(path.win32.parse("name.ext\\").name, "name");
  expectStrictEqual(path.win32.parse("name.ext\\\\").name, "name");
  expectStrictEqual(path.win32.parse("name").name, "name");
  expectStrictEqual(path.win32.parse(".name").name, ".name");
  expectStrictEqual(path.win32.parse("file:stream").name, "file:stream");
});

it.todo("path.parse() windows edition - drive letter", () => {
  expectStrictEqual(path.win32.parse("C:").name, "");
  expectStrictEqual(path.win32.parse("C:.").name, ".");
  expectStrictEqual(path.win32.parse("C:\\").name, "");
  expectStrictEqual(path.win32.parse("C:\\.").name, ".");
  expectStrictEqual(path.win32.parse("C:\\.ext").name, ".ext");
  expectStrictEqual(path.win32.parse("C:\\dir\\name.ext").name, "name");
  expectStrictEqual(path.win32.parse("C:name.ext").name, "name");
  expectStrictEqual(path.win32.parse("C:name.ext\\").name, "name");
  expectStrictEqual(path.win32.parse("C:name.ext\\\\").name, "name");
  expectStrictEqual(path.win32.parse("C:foo").name, "foo");
  expectStrictEqual(path.win32.parse("C:.foo").name, ".foo");
});

it("path.basename", () => {
  strictEqual(path.basename(file), "path.test.js");
  strictEqual(path.basename(file, ".js"), "path.test");
  strictEqual(path.basename(".js", ".js"), "");
  strictEqual(path.basename(""), "");
  strictEqual(path.basename("/dir/basename.ext"), "basename.ext");
  strictEqual(path.basename("/basename.ext"), "basename.ext");
  strictEqual(path.basename("basename.ext"), "basename.ext");
  strictEqual(path.basename("basename.ext/"), "basename.ext");
  strictEqual(path.basename("basename.ext//"), "basename.ext");
  strictEqual(path.basename("aaa/bbb", "/bbb"), "bbb");
  strictEqual(path.basename("aaa/bbb", "a/bbb"), "bbb");
  strictEqual(path.basename("aaa/bbb", "bbb"), "bbb");
  strictEqual(path.basename("aaa/bbb//", "bbb"), "bbb");
  strictEqual(path.basename("aaa/bbb", "bb"), "b");
  strictEqual(path.basename("aaa/bbb", "b"), "bb");
  strictEqual(path.basename("/aaa/bbb", "/bbb"), "bbb");
  strictEqual(path.basename("/aaa/bbb", "a/bbb"), "bbb");
  strictEqual(path.basename("/aaa/bbb", "bbb"), "bbb");
  strictEqual(path.basename("/aaa/bbb//", "bbb"), "bbb");
  strictEqual(path.basename("/aaa/bbb", "bb"), "b");
  strictEqual(path.basename("/aaa/bbb", "b"), "bb");
  strictEqual(path.basename("/aaa/bbb"), "bbb");
  strictEqual(path.basename("/aaa/"), "aaa");
  strictEqual(path.basename("/aaa/b"), "b");
  strictEqual(path.basename("/a/b"), "b");
  strictEqual(path.basename("//a"), "a");
  strictEqual(path.basename("a", "a"), "");

  // // On Windows a backslash acts as a path separator.
  strictEqual(path.win32.basename("\\dir\\basename.ext"), "basename.ext");
  strictEqual(path.win32.basename("\\basename.ext"), "basename.ext");
  strictEqual(path.win32.basename("basename.ext"), "basename.ext");
  strictEqual(path.win32.basename("basename.ext\\"), "basename.ext");
  strictEqual(path.win32.basename("basename.ext\\\\"), "basename.ext");
  strictEqual(path.win32.basename("foo"), "foo");
  strictEqual(path.win32.basename("aaa\\bbb", "\\bbb"), "bbb");
  strictEqual(path.win32.basename("aaa\\bbb", "a\\bbb"), "bbb");
  strictEqual(path.win32.basename("aaa\\bbb", "bbb"), "bbb");
  strictEqual(path.win32.basename("aaa\\bbb\\\\\\\\", "bbb"), "bbb");
  strictEqual(path.win32.basename("aaa\\bbb", "bb"), "b");
  strictEqual(path.win32.basename("aaa\\bbb", "b"), "bb");
  strictEqual(path.win32.basename("C:"), "");
  strictEqual(path.win32.basename("C:."), ".");
  strictEqual(path.win32.basename("C:\\"), "");
  strictEqual(path.win32.basename("C:\\dir\\base.ext"), "base.ext");
  strictEqual(path.win32.basename("C:\\basename.ext"), "basename.ext");
  strictEqual(path.win32.basename("C:basename.ext"), "basename.ext");
  strictEqual(path.win32.basename("C:basename.ext\\"), "basename.ext");
  strictEqual(path.win32.basename("C:basename.ext\\\\"), "basename.ext");
  strictEqual(path.win32.basename("C:foo"), "foo");
  strictEqual(path.win32.basename("file:stream"), "file:stream");
  strictEqual(path.win32.basename("a", "a"), "");

  // On unix a backslash is just treated as any other character.
  strictEqual(path.posix.basename("\\dir\\basename.ext"), "\\dir\\basename.ext");
  strictEqual(path.posix.basename("\\basename.ext"), "\\basename.ext");
  strictEqual(path.posix.basename("basename.ext"), "basename.ext");
  strictEqual(path.posix.basename("basename.ext\\"), "basename.ext\\");
  strictEqual(path.posix.basename("basename.ext\\\\"), "basename.ext\\\\");
  strictEqual(path.posix.basename("foo"), "foo");

  // POSIX filenames may include control characters
  // c.f. http://www.dwheeler.com/essays/fixing-unix-linux-filenames.html
  const controlCharFilename = `Icon${String.fromCharCode(13)}`;
  strictEqual(path.posix.basename(`/a/b/${controlCharFilename}`), controlCharFilename);
});

it("path.join", () => {
  const failures = [];
  const backslashRE = /\\/g;

  const joinTests = [
    [
      [path.posix.join],
      // Arguments                     result
      [
        [[".", "x/b", "..", "/b/c.js"], "x/b/c.js"],
        // [[], '.'],
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

  // // Windows-specific join tests
  // joinTests.push([
  //   path.win32.join,
  //   joinTests[0][1].slice(0).concat([
  //     // Arguments                     result
  //     // UNC path expected
  //     [["//foo/bar"], "\\\\foo\\bar\\"],
  //     [["\\/foo/bar"], "\\\\foo\\bar\\"],
  //     [["\\\\foo/bar"], "\\\\foo\\bar\\"],
  //     // UNC path expected - server and share separate
  //     [["//foo", "bar"], "\\\\foo\\bar\\"],
  //     [["//foo/", "bar"], "\\\\foo\\bar\\"],
  //     [["//foo", "/bar"], "\\\\foo\\bar\\"],
  //     // UNC path expected - questionable
  //     [["//foo", "", "bar"], "\\\\foo\\bar\\"],
  //     [["//foo/", "", "bar"], "\\\\foo\\bar\\"],
  //     [["//foo/", "", "/bar"], "\\\\foo\\bar\\"],
  //     // UNC path expected - even more questionable
  //     [["", "//foo", "bar"], "\\\\foo\\bar\\"],
  //     [["", "//foo/", "bar"], "\\\\foo\\bar\\"],
  //     [["", "//foo/", "/bar"], "\\\\foo\\bar\\"],
  //     // No UNC path expected (no double slash in first component)
  //     [["\\", "foo/bar"], "\\foo\\bar"],
  //     [["\\", "/foo/bar"], "\\foo\\bar"],
  //     [["", "/", "/foo/bar"], "\\foo\\bar"],
  //     // No UNC path expected (no non-slashes in first component -
  //     // questionable)
  //     [["//", "foo/bar"], "\\foo\\bar"],
  //     [["//", "/foo/bar"], "\\foo\\bar"],
  //     [["\\\\", "/", "/foo/bar"], "\\foo\\bar"],
  //     [["//"], "\\"],
  //     // No UNC path expected (share name missing - questionable).
  //     [["//foo"], "\\foo"],
  //     [["//foo/"], "\\foo\\"],
  //     [["//foo", "/"], "\\foo\\"],
  //     [["//foo", "", "/"], "\\foo\\"],
  //     // No UNC path expected (too many leading slashes - questionable)
  //     [["///foo/bar"], "\\foo\\bar"],
  //     [["////foo", "bar"], "\\foo\\bar"],
  //     [["\\\\\\/foo/bar"], "\\foo\\bar"],
  //     // Drive-relative vs drive-absolute paths. This merely describes the
  //     // status quo, rather than being obviously right
  //     [["c:"], "c:."],
  //     [["c:."], "c:."],
  //     [["c:", ""], "c:."],
  //     [["", "c:"], "c:."],
  //     [["c:.", "/"], "c:.\\"],
  //     [["c:.", "file"], "c:file"],
  //     [["c:", "/"], "c:\\"],
  //     [["c:", "file"], "c:\\file"],
  //   ]),
  // ]);
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
  strictEqual(failures.length, 0, failures.join(""));
});

it("path.relative", () => {
  const failures = [];

  const relativeTests = [
    // [
    //   path.win32.relative,
    //   // Arguments                     result
    //   [
    //     ["c:/blah\\blah", "d:/games", "d:\\games"],
    //     ["c:/aaaa/bbbb", "c:/aaaa", ".."],
    //     ["c:/aaaa/bbbb", "c:/cccc", "..\\..\\cccc"],
    //     ["c:/aaaa/bbbb", "c:/aaaa/bbbb", ""],
    //     ["c:/aaaa/bbbb", "c:/aaaa/cccc", "..\\cccc"],
    //     ["c:/aaaa/", "c:/aaaa/cccc", "cccc"],
    //     ["c:/", "c:\\aaaa\\bbbb", "aaaa\\bbbb"],
    //     ["c:/aaaa/bbbb", "d:\\", "d:\\"],
    //     ["c:/AaAa/bbbb", "c:/aaaa/bbbb", ""],
    //     ["c:/aaaaa/", "c:/aaaa/cccc", "..\\aaaa\\cccc"],
    //     ["C:\\foo\\bar\\baz\\quux", "C:\\", "..\\..\\..\\.."],
    //     [
    //       "C:\\foo\\test",
    //       "C:\\foo\\test\\bar\\package.json",
    //       "bar\\package.json",
    //     ],
    //     ["C:\\foo\\bar\\baz-quux", "C:\\foo\\bar\\baz", "..\\baz"],
    //     ["C:\\foo\\bar\\baz", "C:\\foo\\bar\\baz-quux", "..\\baz-quux"],
    //     ["\\\\foo\\bar", "\\\\foo\\bar\\baz", "baz"],
    //     ["\\\\foo\\bar\\baz", "\\\\foo\\bar", ".."],
    //     ["\\\\foo\\bar\\baz-quux", "\\\\foo\\bar\\baz", "..\\baz"],
    //     ["\\\\foo\\bar\\baz", "\\\\foo\\bar\\baz-quux", "..\\baz-quux"],
    //     ["C:\\baz-quux", "C:\\baz", "..\\baz"],
    //     ["C:\\baz", "C:\\baz-quux", "..\\baz-quux"],
    //     ["\\\\foo\\baz-quux", "\\\\foo\\baz", "..\\baz"],
    //     ["\\\\foo\\baz", "\\\\foo\\baz-quux", "..\\baz-quux"],
    //     ["C:\\baz", "\\\\foo\\bar\\baz", "\\\\foo\\bar\\baz"],
    //     ["\\\\foo\\bar\\baz", "C:\\baz", "C:\\baz"],
    //   ],
    // ],
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
        [process.cwd(), "foo", "foo"],
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

  strictEqual(failures.length, 0, failures.join(""));
  expect(true).toBe(true);
});

it("path.normalize", () => {
  // strictEqual(
  //   path.win32.normalize("./fixtures///b/../b/c.js"),
  //   "fixtures\\b\\c.js"
  // );
  // strictEqual(path.win32.normalize("/foo/../../../bar"), "\\bar");
  // strictEqual(path.win32.normalize("a//b//../b"), "a\\b");
  // strictEqual(path.win32.normalize("a//b//./c"), "a\\b\\c");
  // strictEqual(path.win32.normalize("a//b//."), "a\\b");
  // strictEqual(
  //   path.win32.normalize("//server/share/dir/file.ext"),
  //   "\\\\server\\share\\dir\\file.ext"
  // );
  // strictEqual(path.win32.normalize("/a/b/c/../../../x/y/z"), "\\x\\y\\z");
  // strictEqual(path.win32.normalize("C:"), "C:.");
  // strictEqual(path.win32.normalize("C:..\\abc"), "C:..\\abc");
  // strictEqual(path.win32.normalize("C:..\\..\\abc\\..\\def"), "C:..\\..\\def");
  // strictEqual(path.win32.normalize("C:\\."), "C:\\");
  // strictEqual(path.win32.normalize("file:stream"), "file:stream");
  // strictEqual(path.win32.normalize("bar\\foo..\\..\\"), "bar\\");
  // strictEqual(path.win32.normalize("bar\\foo..\\.."), "bar");
  // strictEqual(path.win32.normalize("bar\\foo..\\..\\baz"), "bar\\baz");
  // strictEqual(path.win32.normalize("bar\\foo..\\"), "bar\\foo..\\");
  // strictEqual(path.win32.normalize("bar\\foo.."), "bar\\foo..");
  // strictEqual(path.win32.normalize("..\\foo..\\..\\..\\bar"), "..\\..\\bar");
  // strictEqual(
  //   path.win32.normalize("..\\...\\..\\.\\...\\..\\..\\bar"),
  //   "..\\..\\bar"
  // );
  // strictEqual(
  //   path.win32.normalize("../../../foo/../../../bar"),
  //   "..\\..\\..\\..\\..\\bar"
  // );
  // strictEqual(
  //   path.win32.normalize("../../../foo/../../../bar/../../"),
  //   "..\\..\\..\\..\\..\\..\\"
  // );
  // strictEqual(
  //   path.win32.normalize("../foobar/barfoo/foo/../../../bar/../../"),
  //   "..\\..\\"
  // );
  // strictEqual(
  //   path.win32.normalize("../.../../foobar/../../../bar/../../baz"),
  //   "..\\..\\..\\..\\baz"
  // );
  // strictEqual(path.win32.normalize("foo/bar\\baz"), "foo\\bar\\baz");

  strictEqual(path.posix.normalize("./fixtures///b/../b/c.js"), "fixtures/b/c.js");
  strictEqual(path.posix.normalize("/foo/../../../bar"), "/bar");
  strictEqual(path.posix.normalize("a//b//../b"), "a/b");
  strictEqual(path.posix.normalize("a//b//./c"), "a/b/c");
  strictEqual(path.posix.normalize("a//b//."), "a/b");
  strictEqual(path.posix.normalize("/a/b/c/../../../x/y/z"), "/x/y/z");
  strictEqual(path.posix.normalize("///..//./foo/.//bar"), "/foo/bar");
  strictEqual(path.posix.normalize("bar/foo../../"), "bar/");
  strictEqual(path.posix.normalize("bar/foo../.."), "bar");
  strictEqual(path.posix.normalize("bar/foo../../baz"), "bar/baz");
  strictEqual(path.posix.normalize("bar/foo../"), "bar/foo../");
  strictEqual(path.posix.normalize("bar/foo.."), "bar/foo..");
  strictEqual(path.posix.normalize("../foo../../../bar"), "../../bar");
  strictEqual(path.posix.normalize("../.../.././.../../../bar"), "../../bar");
  strictEqual(path.posix.normalize("../../../foo/../../../bar"), "../../../../../bar");
  strictEqual(path.posix.normalize("../../../foo/../../../bar/../../"), "../../../../../../");
  strictEqual(path.posix.normalize("../foobar/barfoo/foo/../../../bar/../../"), "../../");
  strictEqual(path.posix.normalize("../.../../foobar/../../../bar/../../baz"), "../../../../baz");
  strictEqual(path.posix.normalize("foo/bar\\baz"), "foo/bar\\baz");
});

it("path.resolve", () => {
  const failures = [];
  const slashRE = /\//g;
  const backslashRE = /\\/g;

  const resolveTests = [
    // [
    //   path.win32.resolve,
    //   // Arguments                               result
    //   [
    //     [["c:/blah\\blah", "d:/games", "c:../a"], "c:\\blah\\a"],
    //     [["c:/ignore", "d:\\a/b\\c/d", "\\e.exe"], "d:\\e.exe"],
    //     [["c:/ignore", "c:/some/file"], "c:\\some\\file"],
    //     [["d:/ignore", "d:some/dir//"], "d:\\ignore\\some\\dir"],
    //     [["."], process.cwd()],
    //     [["//server/share", "..", "relative\\"], "\\\\server\\share\\relative"],
    //     [["c:/", "//"], "c:\\"],
    //     [["c:/", "//dir"], "c:\\dir"],
    //     [["c:/", "//server/share"], "\\\\server\\share\\"],
    //     [["c:/", "//server//share"], "\\\\server\\share\\"],
    //     [["c:/", "///some//dir"], "c:\\some\\dir"],
    //     [
    //       ["C:\\foo\\tmp.3\\", "..\\tmp.3\\cycles\\root.js"],
    //       "C:\\foo\\tmp.3\\cycles\\root.js",
    //     ],
    //   ],
    // ],
    [
      path.posix.resolve,
      // Arguments                    result
      [
        [["/var/lib", "../", "file/"], "/var/file"],
        [["/var/lib", "/../", "file/"], "/file"],
        [["a/b/c/", "../../.."], process.cwd()],
        [["."], process.cwd()],
        [["/some/dir", ".", "/absolute/"], "/absolute"],
        [["/foo/tmp.3/", "../tmp.3/cycles/root.js"], "/foo/tmp.3/cycles/root.js"],
      ],
    ],
  ];
  const isWindows = false;
  resolveTests.forEach(([resolve, tests]) => {
    tests.forEach(([test, expected]) => {
      const actual = resolve.apply(null, test);
      let actualAlt;
      const os = resolve === path.win32.resolve ? "win32" : "posix";
      if (resolve === path.win32.resolve && !isWindows) actualAlt = actual.replace(backslashRE, "/");
      else if (resolve !== path.win32.resolve && isWindows) actualAlt = actual.replace(slashRE, "\\");

      const message = `path.${os}.resolve(${test.map(JSON.stringify).join(",")})\n  expect=${JSON.stringify(
        expected,
      )}\n  actual=${JSON.stringify(actual)}`;
      if (actual !== expected && actualAlt !== expected) failures.push(message);
    });
  });
  strictEqual(failures.length, 0, failures.join("\n"));
});

it("path.parse", () => {
  expect(path.parse("/tmp")).toStrictEqual({ root: "/", dir: "/", base: "tmp", ext: "", name: "tmp" });

  expect(path.parse("/tmp/test.txt")).toStrictEqual({
    root: "/",
    dir: "/tmp",
    base: "test.txt",
    ext: ".txt",
    name: "test",
  });

  expect(path.parse("/tmp/test/file.txt")).toStrictEqual({
    root: "/",
    dir: "/tmp/test",
    base: "file.txt",
    ext: ".txt",
    name: "file",
  });

  expect(path.parse("/tmp/test/dir")).toStrictEqual({ root: "/", dir: "/tmp/test", base: "dir", ext: "", name: "dir" });
  expect(path.parse("/tmp/test/dir/")).toStrictEqual({
    root: "/",
    dir: "/tmp/test",
    base: "dir",
    ext: "",
    name: "dir",
  });

  expect(path.parse(".")).toStrictEqual({ root: "", dir: "", base: ".", ext: "", name: "." });
  expect(path.parse("./")).toStrictEqual({ root: "", dir: "", base: ".", ext: "", name: "." });
  expect(path.parse("/.")).toStrictEqual({ root: "/", dir: "/", base: ".", ext: "", name: "." });
  expect(path.parse("/../")).toStrictEqual({ root: "/", dir: "/", base: "..", ext: ".", name: "." });

  expect(path.parse("./file.txt")).toStrictEqual({ root: "", dir: ".", base: "file.txt", ext: ".txt", name: "file" });
  expect(path.parse("../file.txt")).toStrictEqual({ root: "", dir: "..", base: "file.txt", ext: ".txt", name: "file" });
  expect(path.parse("../test/file.txt")).toStrictEqual({
    root: "",
    dir: "../test",
    base: "file.txt",
    ext: ".txt",
    name: "file",
  });
  expect(path.parse("test/file.txt")).toStrictEqual({
    root: "",
    dir: "test",
    base: "file.txt",
    ext: ".txt",
    name: "file",
  });

  expect(path.parse("test/dir")).toStrictEqual({ root: "", dir: "test", base: "dir", ext: "", name: "dir" });
  expect(path.parse("test/dir/another_dir")).toStrictEqual({
    root: "",
    dir: "test/dir",
    base: "another_dir",
    ext: "",
    name: "another_dir",
  });

  expect(path.parse("./dir")).toStrictEqual({ root: "", dir: ".", base: "dir", ext: "", name: "dir" });
  expect(path.parse("../dir")).toStrictEqual({ root: "", dir: "..", base: "dir", ext: "", name: "dir" });
  expect(path.parse("../dir/another_dir")).toStrictEqual({
    root: "",
    dir: "../dir",
    base: "another_dir",
    ext: "",
    name: "another_dir",
  });
});

test("path.format works for vite's example", () => {
  expect(path.format({ root: "", dir: "", name: "index", base: undefined, ext: ".css" })).toBe("index.css");
});
