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

describe("a brace group with `?` or a class, and a path of 64 bytes", () => {
  const text = Buffer.alloc(62, "a").toString();
  // `matchesGlob` keeps the matcher of the last pattern. With two patterns in turn, every call is the first one for its pattern.
  const patterns = [`{${text}?c,zz}`, `{${text}[bc]c,zz}`];

  it.each([
    ["path.matchesGlob", path.matchesGlob],
    ["path.posix.matchesGlob", path.posix.matchesGlob],
    ["path.win32.matchesGlob", path.win32.matchesGlob],
  ])("%s", (_, matchesGlob) => {
    const answers = (pathname: string) =>
      Array.from({ length: 8 }, (_, index) => matchesGlob(pathname, patterns[index % 2]));
    expect(answers(text + "bc")).toEqual(Array(8).fill(true));
    expect(answers(text + "bd")).toEqual(Array(8).fill(false));
  });
});
