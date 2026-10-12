import { heapStats } from "bun:jsc";
import posixPath from "node:path/posix";
import path from "path";
import win32Path from "path/win32";

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

// Bun's posix flavour passes `\` in a pattern to Bun.Glob as an escape. The win32 flavour
// reads it as a separator. So one pattern string is a different glob in each flavour.
describe("path.win32.matchesGlob and path.posix.matchesGlob called with one pattern", () => {
  it.each([
    // line break
    ["src\\x.js", "src\\*.js", true],
    ["lib\\a\\b.ts", "lib\\**\\*.ts", true],
    ["a\\xb", "a\\*b", true],
    ["dir\\a.js", "dir\\a.js", true],
    ["a*b", "a\\*b", false],
  ])("win32 answer for path '%s' and pattern '%s' is %p before and after posix calls", (pathname, glob, expected) => {
    const answers = [path.win32.matchesGlob(pathname, glob)];
    for (let i = 0; i < 4; i++) {
      path.posix.matchesGlob(pathname, glob);
      answers.push(path.win32.matchesGlob(pathname, glob));
    }
    expect(answers).toEqual([expected, expected, expected, expected, expected]);
  });

  it("posix answer is the same before and after a win32 call", () => {
    expect([
      path.posix.matchesGlob("dir\\a.js", "dir\\a.js"),
      path.win32.matchesGlob("dir\\a.js", "dir\\a.js"),
      path.posix.matchesGlob("dir\\a.js", "dir\\a.js"),
    ]).toEqual([false, true, false]);
    // The win32 glob for this pattern matches the posix path.
    expect([
      path.posix.matchesGlob("src/.x.js", "src\\*.js"),
      path.win32.matchesGlob("src\\x.js", "src\\*.js"),
      path.posix.matchesGlob("src/.x.js", "src\\*.js"),
    ]).toEqual([false, true, false]);
    // The win32 call has the pattern of the last posix call. The posix memo has another one.
    expect([
      path.posix.matchesGlob("a/x.js", "a/*.js"),
      path.win32.matchesGlob("b\\x.ts", "b/*.ts"),
      path.posix.matchesGlob("b/x.ts", "b/*.ts"),
    ]).toEqual([true, true, true]);
  });

  // Node.js reads `\` in a pattern as a separator in the posix flavour too:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/glob.js#L938
  it.failing("posix reads a backslash in the pattern as a separator, as Node.js does", () => {
    const answers = [path.posix.matchesGlob("src/x.js", "src\\*.js"), path.posix.matchesGlob("a*b", "a\\*b")];
    expect(answers).toEqual([true, false]);
  });

  it("holds through the node:path/posix and path/win32 modules", () => {
    expect(win32Path.matchesGlob).toBe(path.win32.matchesGlob);
    expect(path.posix.win32.matchesGlob).toBe(path.win32.matchesGlob);
    expect(win32Path.matchesGlob("src\\x.js", "src\\*.js")).toBeTrue();
    posixPath.matchesGlob("src\\x.js", "src\\*.js");
    expect(win32Path.matchesGlob("src\\x.js", "src\\*.js")).toBeTrue();
  });

  // The number of `Bun.Glob` objects that 500 calls build, plus 2. Each flavour starts from another
  // pattern, so the count does not depend on earlier tests. Each flavour ends with one pattern that
  // is in no memo, so the count shows that it sees a new glob.
  function globsBuiltBy(call: (i: number) => void) {
    path.posix.matchesGlob("", "another pattern");
    path.win32.matchesGlob("", "another pattern");
    call(0);
    call(1);
    Bun.gc(true);
    const before = heapStats().objectTypeCounts.Glob ?? 0;
    for (let i = 0; i < 500; i++) call(i);
    path.posix.matchesGlob("", "a pattern in no memo");
    path.win32.matchesGlob("", "a pattern in no memo");
    return (heapStats().objectTypeCounts.Glob ?? 0) - before;
  }

  it("win32 reuses its glob for a pattern that has a backslash", () => {
    expect(globsBuiltBy(() => path.win32.matchesGlob("src\\x.js", "src\\*.js"))).toBe(2);
  });

  it.each([
    // line break
    ["src\\x.js", "src\\*.js"],
    ["src/x.js", "src/*.js"],
  ])("each flavour reuses its glob when calls alternate on path '%s' and pattern '%s'", (pathname, glob) => {
    const alternate = (i: number) => path[i & 1 ? "win32" : "posix"].matchesGlob(pathname, glob);
    expect(globsBuiltBy(alternate)).toBe(2);
  });
});

describe.each(["posix", "win32"] as const)("path.%s.matchesGlob", flavour => {
  const matchesGlob: (path: any, glob: any) => boolean = path[flavour].matchesGlob;

  it("validates `path`, then `glob`, after a call with the same pattern", () => {
    expect(matchesGlob("a", "a")).toBeTrue();
    expect(() => matchesGlob(1, "a")).toThrow('The "path" argument must be of type string');
    expect(() => matchesGlob(1, 2)).toThrow('The "path" argument must be of type string');
    expect(() => matchesGlob("a", undefined)).toThrow('The "pattern" argument must be of type string');
    expect(() => matchesGlob("a", new String("a"))).toThrow('The "pattern" argument must be of type string');
    expect(matchesGlob("a", "a")).toBeTrue();
  });

  it("is a method named matchesGlob that follows `parse`, as in Node.js", () => {
    expect(matchesGlob.name).toBe("matchesGlob");
    expect(matchesGlob.length).toBe(2);
    expect(() => new (matchesGlob as any)("a", "a")).toThrow(TypeError);
    const keys = Object.keys(path[flavour]);
    expect(keys[keys.indexOf("parse") + 1]).toBe("matchesGlob");
  });
});
