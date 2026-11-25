import { matchesGlobForTesting } from "bun:internal-for-testing";
import { readFileSync } from "fs";
import { isDebug, isMacOS, isWindows } from "harness";
import path from "path";
import { runInNewContext } from "vm";

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

describe.each(["posix", "win32"] as const)("path.%s.matchesGlob(path, glob)", platform => {
  it.each([
    [".hidden", "*", false],
    [".hidden", ".*", true],
    ["a/.git/b", "a/**/b", false],
    ["!a", "!a", true],
    ["b", "!a", false],
    ["#a", "#a", true],
    ["a.test.ts", "*.@(test|spec).ts", true],
    ["a.d.ts", "!(*.d).ts", false],
    ["a.ts", "!(*.d).ts", true],
    ["abab", "+(ab)", true],
    ["a7", "a{1..9}", true],
    ["a03", "a{01..10}", true],
    ["a/b/../c", "a/c", true],
    ["a/c", "a/b/../c", true],
    ["a/", "a", true],
    ["a", "a/**", false],
    ["\u00e9", "[[:alpha:]]", true],
    ["\u{1f600}", "?", false],
    ["\u{1f600}", "??", true],
    ["a/b", "a\\b", true],
    ["", "", true],
    ["a", "", false],
  ])("%j and %j: %p", (pathname, glob, expected) => {
    expect(path[platform].matchesGlob(pathname, glob)).toBe(expected);
  });

  it("ignores case where the system does, in what is not a plain name", () => {
    expect(path[platform].matchesGlob("A.TS", "*.ts")).toBe(isMacOS || isWindows);
    expect(path[platform].matchesGlob("A.TS", "a.ts")).toBe(false);
  });

  it("refuses what minimatch refuses", () => {
    expect(path[platform].matchesGlob("a", Buffer.alloc(65536, "a").toString())).toBe(false);
    expect(() => path[platform].matchesGlob("a", Buffer.alloc(65537, "a").toString())).toThrow(
      new TypeError("pattern is too long"),
    );
    expect(() => path[platform].matchesGlob("a", "[[:alpha:]]-")).toThrow(SyntaxError);
  });
});

// Each line has a glob, "w" for path.win32 and "i" for a system that ignores case, and what Node.js v26.12.1 says of it:
// paths that match and paths that do not, or what it throws.
const globsOfNode = readFileSync(path.join(import.meta.dir, "fixtures", "globs-of-node.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map(line => JSON.parse(line) as [string, string, string[] | string, string[]?]);

it.each(
  Object.entries({
    "as narrow as it can be": (text: string) =>
      /[^\0-\xff]/.test(text) ? text : Buffer.from(text, "latin1").toString("latin1"),
    "in 16 bits": (text: string) => ("\u65e5" + text).slice(1),
  }),
)("says what Node.js says, each operand %s", (_, form) => {
  const different: unknown[] = [];
  for (const [glob, flags, matching, others = []] of globsOfNode) {
    const answer = (pathname: string) => {
      try {
        return matchesGlobForTesting(form(pathname), form(glob), flags.includes("w"), flags.includes("i"));
      } catch (error) {
        return String(error);
      }
    };
    const expected: [string, unknown][] =
      typeof matching === "string"
        ? [["a", matching]]
        : [...matching.map(it => [it, true]), ...others.map(it => [it, false])].map(it => it as [string, boolean]);
    for (const [pathname, said] of expected) {
      if (answer(pathname) !== said) different.push({ pathname, glob, flags, said });
    }
  }
  expect(different).toEqual([]);
});

describe("large operands", () => {
  const times = (count: number, text: string) => Buffer.alloc(count * text.length, text).toString();
  const { matchesGlob } = path.posix;

  it.each([62, 63, 64, 65, 127, 128, 129, 5000])("a name of %d characters", length => {
    const name = times(length - 1, "a");
    for (const glob of [
      "*a*a*a*a*a*a*a*a*b",
      "+(a|aa)b",
      "+(+(a)|aa)+(a)b",
      "*(a*(a))b",
      "!(b)!(c)b",
      "+(?|a)*(!(b))b",
    ]) {
      expect([glob, matchesGlob(name + "b", glob), matchesGlob(name + "c", glob)]).toEqual([glob, true, false]);
    }
    expect(matchesGlob(name + "b", times(length, "?"))).toBe(true);
    expect(matchesGlob(name + "b", times(length - 1, "[a]") + "[ab]")).toBe(true);
    expect(matchesGlob(name + "b", "[a]" + name.slice(1) + "[!b]")).toBe(false);
    expect(matchesGlob(name + "\u{1f600}", "+([[:alpha:]])?")).toBe(true);
  });

  it("many names", () => {
    const names = times(3000, "a/");
    expect(matchesGlob(names + "b", times(12, "**/a/") + "**/b")).toBe(true);
    expect(matchesGlob(names + ".x/b", times(12, "**/a/") + "**/b")).toBe(false);
    expect(matchesGlob(names + times(2999, "../") + "b", "a/b")).toBe(true);
    expect(matchesGlob("a/b", names + times(2999, "../") + "b")).toBe(true);
  });

  it("many alternatives", () => {
    expect(matchesGlob("x/4999", "**/{1..5000}")).toBe(true);
    expect(matchesGlob("x/5001", "**/{1..5000}")).toBe(false);
    expect(matchesGlob("x", "{{1..3000},*}")).toBe(true);
    expect(matchesGlob("{a}", times(3000, "{a}") + ",{b}")).toBe(false);
  });

  it("groups in groups", () => {
    expect(matchesGlob(times(40, "a"), times(40, "+(a") + times(40, ")"))).toBe(true);
    expect(matchesGlob(times(39, "a"), times(40, "+(a") + times(40, ")"))).toBe(false);
    expect(matchesGlob("b", times(300, "{a,") + "b" + times(300, "}"))).toBe(true);
  });

  it("more globs than are kept", () => {
    for (let round = 0; round < 2; round++) {
      let matches = 0;
      for (let i = 0; i < 1500; i++) matches += +matchesGlob(`a${i}`, `?${i}`) + +matchesGlob(`a${i}`, `??${i}`);
      expect(matches).toBe(1500);
    }
  });

  it.each([
    ["negations", times(40, "!(a)")],
    ["globstars", times(40, "**/../a/b/")],
  ])("a glob that multiplies with each of its %s is given up", (_, glob) => {
    expect(() => matchesGlob("a", glob)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }));
  });

  const anyOf = (count: number, option: string) => `*(${Array(count).fill(option).join("|")}|?)`;
  const manySteps = [
    ["a", anyOf(1000, "ab")],
    ["a", anyOf(1000, "[bc]")],
    ["\u0434", anyOf(200, "\u0436")],
    ["\u65e5", anyOf(200, "[[:digit:]]")],
    ["\u0434", "*{1..300}\u0436"],
    ["\u{1f600}", "[[:alpha:]]{1..300}*"],
  ];
  const million = (text: string) => Buffer.alloc(2_000_000, text, "utf16le").toString("utf16le");

  it.skipIf(isDebug).each(manySteps)("a million times %j takes too many steps (%#)", (text, glob) => {
    expect(() => matchesGlobForTesting(million(text), glob, false, true)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
  });

  it("a long hidden name is refused at once", () => {
    expect(matchesGlob("." + million("\u{1f600}"), "[[:alpha:]]{1..300}*")).toBe(false);
  });

  it("a timeout ends a match that is under way", () => {
    const [text, glob] = manySteps[0];
    const match = matchesGlob.bind(null, million(text), glob);
    expect(() => runInNewContext("for (;;) try { match(); } catch {}", { match }, { timeout: 30 })).toThrow(
      expect.objectContaining({ code: "ERR_SCRIPT_EXECUTION_TIMEOUT" }),
    );
    expect(matchesGlob("aab", glob)).toBe(true);
  });

  it.each([
    ["+(a", ")"],
    ["{a,", "}"],
  ])("as many %s in each other as a glob can have are given up", (open, close) => {
    expect(() => matchesGlob("a", times(16000, open) + times(16000, close))).toThrow(
      /^(Maximum call stack size exceeded|The argument 'pattern' is too complex)$/,
    );
  });
});
