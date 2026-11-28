import { matchesGlobForTesting } from "bun:internal-for-testing";
import { readFileSync } from "fs";
import { bunRun, isASAN, isDebug, isMacOS, isWindows } from "harness";
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

  it("ignores case on macOS and Windows, in parts with wildcards only", () => {
    expect(path[platform].matchesGlob("A.TS", "*.ts")).toBe(isMacOS || isWindows);
    expect(path[platform].matchesGlob("A.TS", "a.ts")).toBe(false);
  });

  it("throws for the patterns that minimatch rejects", () => {
    expect(path[platform].matchesGlob("a", Buffer.alloc(65536, "a").toString())).toBe(false);
    expect(() => path[platform].matchesGlob("a", Buffer.alloc(65537, "a").toString())).toThrow(
      new TypeError("pattern is too long"),
    );
    expect(() => path[platform].matchesGlob("a", "[[:alpha:]]-")).toThrow(
      new SyntaxError(
        `Invalid regular expression: /^(?!\\.)[\\p{L}\\p{Nl}]\\-$/${isMacOS || isWindows ? "i" : ""}u: Invalid escape`,
      ),
    );
  });
});

// [glob, flags ("w": win32, "i": nocase), matching paths, other paths] or [glob, flags, error]. See fixtures/record.cjs.
const nodeResults = readFileSync(path.join(import.meta.dir, "fixtures", "node-glob-results.jsonl"), "utf8")
  .trim()
  .split(/\r?\n/)
  .map(line => JSON.parse(line) as [string, string, string[] | string, string[]?]);

it.each(
  Object.entries({
    "8-bit where possible": (text: string) =>
      /[^\0-\xff]/.test(text) ? text : Buffer.from(text, "latin1").toString("latin1"),
    "16-bit": (text: string) => ("\u65e5" + text).slice(1),
  }),
)("returns the results recorded from Node.js, with %s strings", (_, form) => {
  expect(nodeResults).toHaveLength(1294);
  const different: unknown[] = [];
  for (const [glob, flags, matching, others = []] of nodeResults) {
    const actual = (pathname: string) => {
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
    for (const [pathname, result] of expected) {
      if (actual(pathname) !== result) different.push({ pathname, glob, flags, expected: result });
    }
  }
  expect(different).toEqual([]);
});

it("compares a suffix with the whole name in lower case", () => {
  const nocase = (pathname: string, glob: string) => matchesGlobForTesting(pathname, glob, false, true);
  expect(nocase("\u65e5.TS\u00c9", "*.ts\u00e9")).toBe(true);
  expect(nocase("\u65e5.\u212a", "*.k")).toBe(true);
  expect(nocase("\u65e5\u00ff", "*\u0178")).toBe(true);
  // U+0130 is two units in lower case, and U+03A3 has a form of its own at the end of a word.
  expect(nocase("\u0130", "*i\u0307")).toBe(true);
  expect(nocase("\u0130x", "*\u0307x")).toBe(true);
  expect(nocase("a\u03a3", "*\u03c2")).toBe(true);
  expect(nocase("a\u03a3", "*\u03c3")).toBe(false);
  expect(nocase("a''\u03a3", "*\u03c2")).toBe(true);
  expect(nocase("\u65e5\u{10400}", "*\udc28")).toBe(true);
});

it.each([
  ["\u0345\u0399\u03b9\u1fbe", "", ""],
  ["\u0422\u0442\u1c84\u1c85", "", ""],
  ["\u0398\u03b8\u03d1", "\u03f4", ""],
  ["\u00b5\u039c\u03bc", "", ""],
  ["\u00ff\u0178", "", ""],
  ["Kk", "\u212a", ""],
  ["Ss", "\u017f", "\u00df"],
  ["", "\u{10400}\u{10428}", ""],
  ["", "", "i\u0130\u0131"],
])("ignoring case, %j are the same, %j joins them next to a POSIX class, %j does not", (same, joins, others) => {
  const all = [...same, ...joins, ...others];
  for (const [digit, group] of [
    ["[0-9]", same],
    ["[[:digit:]]", same + joins],
  ]) {
    for (const a of all) {
      for (const glob of [`${digit}${a}*`, `*@(${digit}${a})*`, `${digit}[${a}${a}]*`]) {
        // Without the flag `u`, a class has the halves of a pair.
        if (a.length === 2 && digit === "[0-9]" && glob.endsWith("]*")) continue;
        const matched = all.filter(b => matchesGlobForTesting(`1${b}z`, glob, false, true));
        expect([glob, matched]).toEqual([glob, group.includes(a) ? [...group] : [a]]);
      }
    }
  }
});

it("finds the matching alternative at any position", () => {
  const names = Array.from({ length: 100 }, (_, i) => `n${i}`);
  for (const form of [(text: string) => text, (text: string) => ("\u65e5" + text).slice(1)]) {
    for (const glob of [`**/{${names}}/**`, `x/{${names}}/*`, `{${names.map(name => `*/${name}/y`)}}`]) {
      expect(names.filter(name => !path.posix.matchesGlob(form(`x/${name}/y`), glob))).toEqual([]);
      expect(path.posix.matchesGlob(form("x/n100/y"), glob)).toBe(false);
    }
  }
  expect(path.posix.matchesGlob("x/../b/", "{a,b}/")).toBe(true);
  expect(path.posix.matchesGlob("x/..", "{a,/b,}{,.}")).toBe(false);
  expect(path.win32.matchesGlob("c:\\b", "{D:/a,C:/b}")).toBe(true);
  expect(path.win32.matchesGlob("\\\\?\\c:\\b", "{D:/a,C:/b}")).toBe(true);
  expect(path.win32.matchesGlob("c:\\b", "{D:/a,//?/C:/b}")).toBe(true);
});

it("caches a pattern for each platform and string width", () => {
  for (let round = 0; round < 2; round++) {
    expect([path.posix.matchesGlob("a\\b", "a/b"), path.win32.matchesGlob("a\\b", "a/b")]).toEqual([false, true]);
    // The code unit U+6261 has the bytes of "ab".
    expect([path.posix.matchesGlob("ab", "ab"), path.posix.matchesGlob("ab", "\u6261")]).toEqual([true, false]);
  }
});

describe("numeric ranges", () => {
  const { matchesGlob } = path.posix;
  const bounds = [
    "0",
    "1",
    "8",
    "9",
    "10",
    "11",
    "19",
    "20",
    "89",
    "99",
    "100",
    "101",
    "110",
    "00",
    "07",
    "010",
    "0120",
  ];

  it.each(bounds)("from %s match the numbers that they list", first => {
    const different: string[] = [];
    for (const last of bounds) {
      const width = /^0\d/.test(first) || /^0\d/.test(last) ? Math.max(first.length, last.length) : 0;
      const glob = `a{${first}..${last}}`;
      for (let number = 0; number <= 121; number++) {
        for (const text of new Set([1, 2, 3, 4].map(length => String(number).padStart(length, "0")))) {
          const isInRange = number >= Math.min(+first, +last) && number <= Math.max(+first, +last);
          const isListed = isInRange && text === String(number).padStart(width, "0");
          if (matchesGlob("a" + text, glob) !== isListed) different.push(`${text} ${glob}`);
        }
      }
    }
    expect(different).toEqual([]);
  });

  it("do not count towards the limit of brace expansion", () => {
    expect(["1", "150000", "200000", "0", "200001"].map(it => matchesGlob(it, "{1..200000}"))).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    const hours = "{2015..2030}/{01..12}/{01..31}/{00..23}/*.gz";
    expect(matchesGlob("2030/12/31/23/a.gz", hours)).toBe(true);
    expect(matchesGlob("2030/12/31/24/a.gz", hours)).toBe(false);
    expect(matchesGlob("9007199254740991", "{0..9007199254740991}")).toBe(true);
    expect(matchesGlob("9007199254740991", "{0..9007199254740990}")).toBe(false);
    expect(matchesGlob("9007199254740992", "{9007199254740992..9007199254740992}")).toBe(true);
  });

  it.each([
    ["a/150000", "[ab]/{1..200000}"],
    ["a150000", "[ab]{1..200000}"],
    ["150000.a", "{1..200000}.[ab]"],
    ["150000.a", "{1..200000}.@(a|b)"],
    ["a150000", "@(a|b){1..200000}"],
    ["a (150000)", "a ({1..200000})"],
    ["-150000.mkv", "*-{1..200000}.mkv"],
    ["//a150000/b/c", "//a{1..200000}/b/*"],
    ["//a/b150000/c", "//a/b{1..200000}/*"],
  ])("do not count towards it: %s in %s", (pathname, glob) => {
    for (const isWin32AndNocase of [false, true]) {
      const matches = (it: string) => matchesGlobForTesting(it, glob, isWin32AndNocase, isWin32AndNocase);
      expect([matches(pathname), matches(pathname.replace("1", "2"))]).toEqual([true, false]);
    }
  });

  // Compiling takes more than half of what is allowed, and the numbers turn out to need listing at the end.
  it.skipIf(isDebug || isASAN)("do not use up the limit when they have to be listed after all", () => {
    const many = "{a,b}".repeat(16) + "[[:alpha:]]".repeat(4);
    expect(matchesGlob("2", `{${many},@({1..3})}`)).toBe(true);
    expect(() => matchesGlob("2", `{${many},[[:alpha:]]-}`)).toThrow(SyntaxError);
    expect(matchesGlobForTesting("1b", `{1..3}!(${"|".repeat(64)}a)${"x".repeat(60_000)}`, false, true)).toBe(false);
  });
});

describe("large arguments", () => {
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

  // Up to 160 parts are kept on the stack.
  it.each(["posix", "win32"] as const)("%s paths of around 160 parts", platform => {
    for (let count = 155; count <= 162; count++) {
      for (const root of ["", "/", "//"]) {
        for (const end of ["b", "b/"]) {
          expect(path[platform].matchesGlob(root + times(count, "a/") + end, root + times(count, "?/") + "b")).toBe(
            true,
          );
        }
      }
    }
  });

  it("paths of thousands of parts", () => {
    const names = times(3000, "a/");
    expect(matchesGlob(names + "b", times(12, "**/a/") + "**/b")).toBe(true);
    expect(matchesGlob(names + ".x/b", times(12, "**/a/") + "**/b")).toBe(false);
    expect(matchesGlob(names + times(2999, "../") + "b", "a/b")).toBe(true);
    expect(matchesGlob("a/b", names + times(2999, "../") + "b")).toBe(true);
  });

  it("stops at the globstar recursion limit of minimatch", () => {
    expect(matchesGlob(times(201, "a/") + "b", times(201, "**/a/") + "b")).toBe(true);
    expect(matchesGlob(times(202, "a/") + "b", times(202, "**/a/") + "b")).toBe(false);
  });

  it("many alternatives", () => {
    expect(matchesGlob("x/9998", "**/{2..10000..2}")).toBe(true);
    expect(matchesGlob("x/9999", "**/{2..10000..2}")).toBe(false);
    expect(matchesGlob("x", "{{1..3000},*}")).toBe(true);
    expect(matchesGlob("{a}", times(3000, "{a}") + ",{b}")).toBe(false);
  });

  it("many alternatives that merge into each other", () => {
    expect(matchesGlob(times(13, "a/") + "x", times(13, "{a,*}/") + "x")).toBe(true);
    expect(matchesGlob(times(13, ".a/") + "x", times(10, "{*,.a}/") + times(3, "*/") + "x")).toBe(false);
    expect(matchesGlob("5/x/y/z", times(3, "{{0..6},*}/") + "{{0..6},*}")).toBe(true);
    // `**/.x` replaces `.x/b`, the last of a row of alternatives without a star.
    expect(matchesGlob(".x/b", "{**/b,**/.x,b/.x,.x/b}")).toBe(false);
  });

  it("many alternatives against a long name", () => {
    expect(matchesGlob(times(4000, "a") + "b", "{1..6000..2}*" + times(32, "a") + "*b")).toBe(false);
    expect(matchesGlob(times(300_000, "a") + "b", "{1..2000..2}*a*b")).toBe(false);
    expect(matchesGlob("1999" + times(300_000, "a") + "b", "{11..2000..2}*a*b")).toBe(true);
    expect(matchesGlob(times(4000, "a") + "b", "*" + times(32, "a") + "*{1..6000..2}*b")).toBe(false);
  });

  // 4 s on a debug build.
  it.skipIf(isDebug)("many alternatives outside of Latin-1, ignoring case", () => {
    const names = Array.from({ length: 3000 }, (_, i) => `\u65e5\u0434${i}`);
    const glob = `**/*@(${names.join("|")})*/**/x`;
    const directories = Array(200)
      .fill("\u65e5\u0414\u672c\u65e5\u0414\u672c\u65e5\u0414\u672c\u65e5\u0414\u672c/")
      .join("");
    expect(matchesGlobForTesting(directories + "x", glob, false, true)).toBe(false);
    expect(matchesGlobForTesting(directories + "\u672c\u65e5\u04142999\u672c/x", glob, false, true)).toBe(true);
  });

  it.each([
    ["\u0436{1..1000}_!(x)", "\u04161000_", ""],
    ["\u0436{1..1000}[[:punct:]]!(x)", "\u04161000_\u{1f600}", ""],
    ["*{1..1000}_\u0436", "", "1000_\u0416"],
  ])("many alternatives against a long name outside of Latin-1, ignoring case (%#)", (glob, start, end) => {
    const name = Buffer.alloc(80_000, "\u0434", "utf16le").toString("utf16le");
    expect(matchesGlobForTesting(name + "\u{1f600}\u0436", glob, false, true)).toBe(false);
    expect(matchesGlobForTesting(start + name + end, glob, false, true)).toBe(true);
  });

  // 7 s on a debug build.
  it.skipIf(isDebug).each([false, true])("many classes against a long name outside of ASCII (nocase: %p)", nocase => {
    const name = Buffer.alloc(80_000, "\u0434", "utf16le").toString("utf16le");
    const glob = `*(${times(300, "[ab]|")}\u0434)_`;
    expect(matchesGlobForTesting(name + "_", glob, false, nocase)).toBe(true);
    expect(matchesGlobForTesting("\u0436" + name + "_", glob, false, nocase)).toBe(false);
  });

  it("consecutive braces", () => {
    const glob = "{1,2}-{a,z}${b}-{1..3}{c,d}";
    expect(["1-a${b}-2c", "2-z${b}-3d", "2-z${b}-4d"].map(it => matchesGlob(it, glob))).toEqual([true, true, false]);
  });

  it.each([
    ["100,000 results", "y", times(17, "{x,y}")],
    ["100,000 results", "200001", "{1..200001..2}"],
    ["100,000 results", "", times(40, "{,}")],
    ["4 million characters", "y", times(1000, "a") + times(12, "{x,y}")],
  ])("throws where Node.js drops what brace expansion makes after %s (%#)", (_, pathname, glob) => {
    for (let round = 0; round < 2; round++) {
      expect(() => matchesGlob(pathname, glob)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }));
    }
  });

  // 10 s on a debug build.
  it.skipIf(isDebug)("expands braces up to the limits of Node.js", () => {
    expect(matchesGlob("199999", "{1..199999..2}")).toBe(true);
    expect(matchesGlob(times(1000, "a") + times(11, "y"), times(1000, "a") + times(11, "{x,y}"))).toBe(true);
  });

  it("nested groups", () => {
    expect(matchesGlob(times(40, "a"), times(40, "+(a") + times(40, ")"))).toBe(true);
    expect(matchesGlob(times(39, "a"), times(40, "+(a") + times(40, ")"))).toBe(false);
    expect(matchesGlob("b", times(300, "{a,") + "b" + times(300, "}"))).toBe(true);
  });

  it("more patterns than the cache holds", () => {
    for (let round = 0; round < 2; round++) {
      let matches = 0;
      for (let i = 0; i < 1500; i++) matches += +matchesGlob(`a${i}`, `?${i}`) + +matchesGlob(`a${i}`, `??${i}`);
      expect(matches).toBe(1500);
    }
  });

  // 20 s on a debug build.
  it.skipIf(isDebug)("more compiled bytes than the cache holds", () => {
    for (let round = 0; round < 2; round++) {
      for (const prefix of "abcdefgh") {
        expect(matchesGlob(`${prefix}100000`, `${prefix}{2..100000..2}`)).toBe(true);
        expect(matchesGlob(`${prefix}99999`, `${prefix}{2..100000..2}`)).toBe(false);
      }
    }
  });

  // Compiling one takes as long as a few hundred matches.
  it.skipIf(isDebug || isASAN)("compiles a few large patterns once when they take turns", () => {
    let matches = 0;
    for (let i = 0; i < 400; i++) for (const prefix of "abc") matches += +matchesGlob("b8", `${prefix}{2..80000..2}`);
    expect(matches).toBe(400);
  });

  it.skipIf(isDebug || isASAN)("gives up on compiling a pattern once", () => {
    const match = () => matchesGlob("a", "{{1..10000}/*,*/{1..10000}}");
    for (let i = 0; i < 100; i++) expect(match).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }));
  });

  it.each([
    ["negations", times(40, "!(a)")],
    ["globstars", times(40, "**/../a/b/")],
  ])("throws for a pattern that grows exponentially with its %s", (_, glob) => {
    expect(() => matchesGlob("a", glob)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_VALUE",
        message: `The argument 'pattern' (${glob.length} characters) is too complex to match against 'path' (1 characters)`,
      }),
    );
  });

  // A debug build times out before it reaches the limit.
  it
    .skipIf(isDebug)
    .each([
      times(3, `!(${times(59, "|")}a)`) + "x" + times(65000, "*"),
      times(3, `!(${times(69, "|")}a)`) + "[b" + times(10800, "z-[:-!") + "]",
      times(250, "@(") + times(60000, "|") + "a" + times(250, ")"),
      times(5500, "@(a|") + "a" + times(5500, ")"),
    ])("throws for a pattern whose parts are copied too many times (%#)", glob => {
    expect(() => matchesGlob("a", glob)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }));
  });

  it.skipIf(isDebug || isASAN)("the RegExp source counts towards the memory limit while it is built", async () => {
    const script = `
      const before = process.resourceUsage().maxRSS;
      try {
        require("node:path").matchesGlob("a", "!(" + Buffer.alloc(1060, "|") + "a)" + Buffer.alloc(63000, "x"));
      } catch (error) {
        console.log(error.code, process.resourceUsage().maxRSS - before < 256 * 1024);
      }`;
    expect(await bunRun(["-e", script])).toSpawn("ERR_INVALID_ARG_VALUE true");
  });

  it.skipIf(isDebug).each(["b", "[[:digit:]]"])(
    "throws for a match of a short name that exceeds the limit (%s)",
    last => {
      const theta = (count: number) => Array(count).fill("\u03b8").join("");
      const glob = `x*!(${times(69, "|")}a)@(${Array(1900)
        .fill(theta(31) + "x")
        .join("|")}|${last})*`;
      expect(matchesGlobForTesting("a", glob, false, true)).toBe(false);
      expect(() => matchesGlobForTesting("x" + theta(200), glob, false, true)).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
      );
    },
  );

  const anyOf = (count: number, option: string) => `*(${Array(count).fill(option).join("|")}|?)`;
  const manySteps = [
    ["a", anyOf(1000, "ab")],
    ["a", anyOf(1000, "[bc]")],
    ["\u0434", anyOf(200, "\u0436")],
    ["\u65e5", anyOf(200, "[[:digit:]]")],
    ["\u03a3", "*{1..300}\u0436"],
    ["\u{1f600}", "*[[:alpha:]]{1..300}*"],
  ];
  const million = (text: string) => Buffer.alloc(2_000_000, text, "utf16le").toString("utf16le");

  // A debug build times out before it reaches the limit.
  it.skipIf(isDebug).each(manySteps)(
    "throws for a match that exceeds the limit: a million times %j (%#)",
    (text, glob) => {
      expect(() => matchesGlobForTesting(million(text), glob, false, true)).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
      );
    },
  );

  it("rejects a long name that starts with a dot without scanning it", () => {
    expect(matchesGlob("." + million("\u{1f600}"), "*[[:alpha:]]{1..300}*")).toBe(false);
  });

  it("a vm timeout interrupts a match", () => {
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
  ])("throws for %s nested as deep as a pattern allows", (open, close) => {
    expect(() => matchesGlob("a", times(16000, open) + times(16000, close))).toThrow(
      // Which limit comes first depends on the stack size of the platform.
      /^(Maximum call stack size exceeded|The argument 'pattern' .* is too complex to match .*)$/,
    );
  });
});
