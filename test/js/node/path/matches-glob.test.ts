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

// Node 24 minimatch semantics, including per-adapter separator and cache isolation.
describe("Node minimatch parity", () => {
  it.each([
    ["src/server/main.ts", "{src,extensions}/**/!(*.test|*.test-support|*.e2e|*.e2e.test|*.live.test).ts", true, true],
    [
      "src/server/main.test.ts",
      "{src,extensions}/**/!(*.test|*.test-support|*.e2e|*.e2e.test|*.live.test).ts",
      false,
      false,
    ],
    [
      "extensions/example/index.live.test.ts",
      "{src,extensions}/**/!(*.test|*.test-support|*.e2e|*.e2e.test|*.live.test).ts",
      false,
      false,
    ],
    ["src/main.ts", "src/**/!(*.test).ts", true, true],
    ["foo.js", "!(*.ts)", true, true],
    ["foo.ts", "!(*.ts)", false, false],
    ["foo.test.ts", "!(*.test).ts", false, false],
    ["foo.ts", "!(*.test).ts", true, true],
    ["foo.bar.ts", "!(foo|bar).ts", true, true],
    ["foo.ts", "!(foo|bar).ts", false, false],
    ["a/b.ts", "!(a)/*.ts", false, false],
    ["b/b.ts", "!(a)/*.ts", true, true],
    ["web/src/styles/./base.css", "web/src/styles/base.css", true, true],
    ["web/src/tmp/../styles/base.css", "web/src/styles/*.css", true, true],
    ["web/src/styles/base.css", "web/src/./styles/*.css", true, true],
    ["web/src/styles/base.css", "web/src/tmp/../styles/*.css", true, true],
    ["a/../x.ts", "*.ts", true, true],
    ["a/./b/../x.ts", "a/*.ts", true, true],
    ["src/.hidden.ts", "src/*.ts", false, false],
    ["!foo", "!foo", true, true],
    ["#foo", "#foo", true, true],
    ["a\\b.ts", "a/*.ts", false, true],
    ["a\\.\\b.ts", "a\\*.ts", false, true],
    ["C:\\src\\tmp\\..\\main.ts", "C:/src/*.ts", false, true],
    ["//host/share/foo.ts", "//host/share/*.ts", true, true],
    ["", "", true, true],
    ["./", "*", false, false],
    ["a/b/", "a/**", true, true],
    ["aaa.js", "@(a|+(a)).js", true, true],
  ])("matches %s against %s", (pathname, pattern, posix, win32) => {
    expect(path.posix.matchesGlob(pathname, pattern)).toBe(posix);
    expect(path.win32.matchesGlob(pathname, pattern)).toBe(win32);
    expect(path.posix.matchesGlob(pathname, pattern)).toBe(posix);
  });
});
