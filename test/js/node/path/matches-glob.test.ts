import path from "path";

describe("path.matchesGlob(path, glob)", () => {
  const stringLikeObject = {
    toString() {
      return "hi";
    },
  };

  it.each([
    // line break
    null,
    undefined,
    123,
    stringLikeObject,
    Symbol("hi"),
  ])("throws if `path` is not a string", (notAString: any) => {
    expect(() => path.matchesGlob(notAString, "*")).toThrow(TypeError);
  });

  it.each([
    // line break
    null,
    undefined,
    123,
    stringLikeObject,
    Symbol("hi"),
  ])("throws if `glob` is not a string", (notAString: any) => {
    expect(() => path.matchesGlob("hi", notAString)).toThrow(TypeError);
  });
});

describe("path.posix.matchesGlob(path, glob)", () => {
  it.each([
    // line break
    ["foo.js", "*.js"],
    ["foo.js", "*.[tj]s"],
    ["foo.ts", "*.[tj]s"],
    ["foo.js", "**/*.js"],
    ["src/bar/foo.js", "**/*.js"],
    ["foo/bar/baz", "foo/[bcr]ar/baz"],
  ])("path '%s' matches pattern '%s'", (pathname, glob) => {
    expect(path.posix.matchesGlob(pathname, glob)).toBeTrue();
  });
  it.each([
    // line break
    ["foo.js", "*.ts"],
    ["src/foo.js", "*.js"],
    ["foo.js", "src/*.js"],
    ["foo/bar", "*"],
  ])("path '%s' does not match pattern '%s'", (pathname, glob) => {
    expect(path.posix.matchesGlob(pathname, glob)).toBeFalse();
  });
});

describe("path.win32.matchesGlob(path, glob)", () => {
  it.each([
    // line break
    ["foo.js", "*.js"],
    ["foo.js", "*.[tj]s"],
    ["foo.ts", "*.[tj]s"],
    ["foo.js", "**\\*.js"],
    ["src\\bar\\foo.js", "**\\*.js"],
    ["src\\bar\\foo.js", "**/*.js"],
    ["foo\\bar\\baz", "foo\\[bcr]ar\\baz"],
    ["foo\\bar\\baz", "foo/[bcr]ar/baz"],
  ])("path '%s' matches gattern '%s'", (pathname, glob) => {
    expect(path.win32.matchesGlob(pathname, glob)).toBeTrue();
  });
  it.each([
    // line break
    ["foo.js", "*.ts"],
    ["foo.js", "src\\*.js"],
    ["foo/bar", "*"],
  ])("path '%s' does not match pattern '%s'", (pathname, glob) => {
    expect(path.win32.matchesGlob(pathname, glob)).toBeFalse();
  });
});

// Node implements matchesGlob with minimatch at the options it passes: the default `dot: false`,
// `nonegate`, `nocomment`, `windowsPathsNoEscape` and `optimizationLevel: 2`. Node v26.3.0 gave
// every answer in these tables.
describe("path.matchesGlob(path, glob) matches as minimatch does for Node", () => {
  describe("`*`, `**` and `?` do not match a name that starts with `.` unless the pattern writes the dot", () => {
    it.each([
      ["a/.d/two.css", "**/*.css", false],
      [".d/two.css", "**/*.css", false],
      ["a/.two.css", "**/*.css", false],
      [".two.css", "*.css", false],
      ["a/.d/two.css", "a/*/two.css", false],
      [".hidden", "*", false],
      [".hidden", "?hidden", false],
      ["a/.d", "a/**", false],
      ["a/.d/b", "a/**/b", false],
      [".", "*", false],
      ["..", "*", false],
      [".", "?", false],
      ["..", "??", false],
      ["/.b", "/**", false],
      ["/.b", "**", false],
      ["a/.b/", "a/*/", false],
      ["a/.b", "a/{*,x}", false],
      ["a/.b", "a/@(*)", false],
      [".hidden", "[.h]hidden", false],
      [".hidden", "[!a]hidden", false],
      ["a/b/two.css", "**/*.css", true],
      ["a/.d/two.css", "a/.d/*.css", true],
      ["a/.d/two.css", "a/.*/two.css", true],
      [".hidden", ".*", true],
      [".hidden", ".hidden", true],
      ["a/.d", "a/.d", true],
      ["a/b/", "a/*/", true],
      ["a/.b", "a/{.b,c}", true],
      ["a/.b", "a/@(.b|*)", true],
      [".git/x", "**/.git/**", true],
      ["a/b", "**", true],
    ])("path '%s' and pattern '%s' answer %p", (pathname, glob, expected) => {
      expect(path.posix.matchesGlob(pathname, glob)).toBe(expected);
      expect(path.win32.matchesGlob(pathname, glob)).toBe(expected);
    });
  });

  describe("a class of one character is that character, so `[.]` writes the dot", () => {
    it.each([
      [".hidden", "[.]hidden", true],
      ["a/.d", "a/[.]d", true],
      ["a/.d/two.css", "a/[.]d/*.css", true],
      ["..", ".[.]", true],
      ["a/.git/x", "**/[.]git/**", true],
      [".hidden", "[\\.]hidden", false],
      ["a.b", "a[.]b", true],
      ["axb", "a[.]b", false],
    ])("path '%s' and pattern '%s' answer %p", (pathname, glob, expected) => {
      expect(path.posix.matchesGlob(pathname, glob)).toBe(expected);
      expect(path.win32.matchesGlob(pathname, glob)).toBe(expected);
    });
  });

  describe("`.`, `x/..` and empty segments inside the path and the pattern collapse", () => {
    it.each([
      ["a/./b", "a/**/b", true],
      ["src/./a.ts", "**/*.ts", true],
      ["a/x/../b", "a/**/b", true],
      ["a/b/c/../../d", "a/**/d", true],
      ["a/.d/../b.css", "a/**/*.css", true],
      ["src/./a.ts", "src/*.ts", true],
      ["src//a.ts", "src/*.ts", true],
      ["a/../b", "b", true],
      ["./", ".", true],
      ["./a", "a", false],
      ["./a", "./a", true],
      ["a/./b", "a/./b", true],
      ["a/b", "a/./b", true],
      ["a/b", "a/x/../b", true],
      ["a/b", "a//b", true],
      ["b", "a/../b", true],
      ["a/b", "./a/b", false],
      ["./a/b", "./a/b", true],
      ["a/b/c", "a/**/x/../c", true],
    ])("path '%s' and pattern '%s' answer %p", (pathname, glob, expected) => {
      expect(path.posix.matchesGlob(pathname, glob)).toBe(expected);
      expect(path.win32.matchesGlob(pathname, glob)).toBe(expected);
    });
  });

  describe("a leading `!` is a character, not a negation", () => {
    it.each([
      [".hidden", "!*", false],
      ["!.hidden", "!*", true],
      ["!foo", "!*", true],
      ["foo", "!*", false],
      ["a/.d/x", "!**/x", false],
      ["!a", "!a", true],
      ["a", "!(b)", true],
      ["b", "!(b)", false],
    ])("path '%s' and pattern '%s' answer %p", (pathname, glob, expected) => {
      expect(path.posix.matchesGlob(pathname, glob)).toBe(expected);
      expect(path.win32.matchesGlob(pathname, glob)).toBe(expected);
    });
  });

  describe("`\\` in the pattern is a separator for both flavours", () => {
    it.each([
      ["a/b", "a\\b", true],
      ["a/b", "a\\*", true],
      [".hidden", "\\.hidden", false],
      ["a/b/c.ts", "**\\*.ts", true],
    ])("path '%s' and pattern '%s' answer %p", (pathname, glob, expected) => {
      expect(path.posix.matchesGlob(pathname, glob)).toBe(expected);
      expect(path.win32.matchesGlob(pathname, glob)).toBe(expected);
    });
  });

  describe("a `*` segment needs a character, and `{a}` keeps its braces", () => {
    it.each([
      ["", "*", false],
      ["", "", true],
      ["a/", "a/*", false],
      ["a/b", "a/*", true],
      ["{a}", "{a}", true],
      ["a", "{a}", false],
      ["a/b/", "a/*", true],
    ])("path '%s' and pattern '%s' answer %p", (pathname, glob, expected) => {
      expect(path.posix.matchesGlob(pathname, glob)).toBe(expected);
      expect(path.win32.matchesGlob(pathname, glob)).toBe(expected);
    });
  });

  describe("the rest of minimatch's `optimizationLevel: 2` and of its reading of a pattern", () => {
    it.each([
      // line break
      ["//server/share/file.txt", "//server/share/*.txt", true],
      ["/", "", false],
      ["a/..", "", false],
      ["./", "", false],
      ["a/b", "src/../**", false],
      [".x", "src/../**", false],
      ["a/b", "a/[.]/b", false],
      ["a/./b", "a/[.]/b", false],
      ["x(y/z", "x(y/./z", true],
      ["x(y/./z", "x(y/./z", true],
      ["a/b/c", "a/b/../../**/c", false],
      ["a" + "/".repeat(5000) + "b", "a/b", true],
      ["src/a.js", "src\\*.js", true],
      ["a/b", "{a,b}/../b", false],
      ["a/c", "{a,b/..}/c", true],
    ])("path '%s' and pattern '%s' answer %p", (pathname, glob, expected) => {
      expect(path.posix.matchesGlob(pathname, glob)).toBe(expected);
      expect(path.win32.matchesGlob(pathname, glob)).toBe(expected);
    });
  });

  // For the win32 flavour only, `\\` in the path is a separator, and a drive letter stays in front of `..`.
  it.each([
    // line break
    ["a\\b", "a/b", true, false],
    ["sub\\file.tmp", "sub/*.tmp", true, false],
    ["\\\\server\\share\\file.txt", "\\\\server\\share\\*.txt", true, false],
    ["C:/../file", "file", false, true],
    ["C:/../file", "C:/file", false, false],
    ["C:/a/../file", "C:/file", true, true],
    ["c:/x/../../y", "y", false, true],
  ])("path '%s' and pattern '%s' answer %p for win32 and %p for posix", (pathname, glob, win32, posix) => {
    expect(path.win32.matchesGlob(pathname, glob)).toBe(win32);
    expect(path.posix.matchesGlob(pathname, glob)).toBe(posix);
  });

  it.each([
    // line break
    ["a\\.d\\two.css", "**\\*.css", false],
    ["a\\.d\\two.css", "**/*.css", false],
    ["a\\.d\\two.css", "a\\*\\two.css", false],
    ["a\\b\\two.css", "**\\*.css", true],
    ["a\\.d\\two.css", "a\\.d\\*.css", true],
    ["a\\.d\\two.css", "a/.*/two.css", true],
    ["a\\.\\b", "a/**/b", true],
    ["C:\\.b", "C:/*", false],
  ])("win32: path '%s' and pattern '%s' answer %p", (pathname, glob, expected) => {
    expect(path.win32.matchesGlob(pathname, glob)).toBe(expected);
  });

  // The memoized glob takes a warm path after many calls with the same pattern. Its answers must not change.
  it("answers the same however often it is asked", () => {
    const long = "a/".repeat(400) + "two.css";
    const longHidden = "a/".repeat(400) + ".two.css";
    for (const pattern of ["**/*.css", "*", "a/**", "?hidden", ".*", "[.]hidden"]) {
      const paths = ["a/b/two.css", "a/.d/two.css", ".hidden", ".", "..", "a/./b", long, longHidden];
      const first = paths.map(p => path.posix.matchesGlob(p, pattern));
      for (let i = 0; i < 50; i++) {
        expect(paths.map(p => path.posix.matchesGlob(p, pattern))).toEqual(first);
      }
    }
  });
});
