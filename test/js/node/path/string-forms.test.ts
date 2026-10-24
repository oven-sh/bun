// src/runtime/node/path.rs reads an 8-bit string where it is, sixteen characters at a time on POSIX, and answers with parts
// of its operands. A 16-bit string goes through UTF-8 and the functions of src/node_path that follow Node's source line by
// line. So the same characters in 16-bit storage say what the answer is.
import { describe, expect, test } from "bun:test";
import path from "node:path";

const flat = (text: string) => (text.charCodeAt(0), text);
const copy = (text: string) => flat(Buffer.from(text, "utf16le").toString("utf16le"));
const wide = (text: string) => flat("日" + text + "本").slice(1, -1);

const forms: Record<string, (text: string) => any> = {
  flat: text => flat(text + ""),
  rope: text => (text.length < 2 ? text : copy(text.slice(0, text.length >> 1)) + copy(text.slice(text.length >> 1))),
  ropeOfThree: text =>
    text.length < 3 ? text : copy(text.slice(0, 1)) + (copy(text.slice(1, 2)) + copy(text.slice(2))),
  substring: text => flat("<<" + text + ">>>").slice(2, -3),
  stringObject: text => new String(text),
};

function createRandom(seed: number) {
  let state = seed;
  return (below: number) => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state % below;
  };
}

const names = [
  "",
  "",
  ".",
  "..",
  "...",
  "a",
  "ab",
  "index.ts",
  "package.json",
  ".bin",
  ".gitignore",
  "e.",
  "f..g",
  "..h",
  ".i.",
  "x.tar.gz",
  "node_modules",
  "src",
  " ",
  "é",
  "ñandú.txt",
  "ÿ",
  "C:",
  "c:",
  "1:",
  "é:",
  "?",
  "UNC",
  "con",
  "aux:",
  "server",
  "share",
  "a-rather-long-name-of-a-folder-that-has-more-than-thirty-two-characters",
  "sixteen-letters!",
  "seventeen-letters",
  "eight-ch",
  "nine-char",
];
const separators = ["/", "/", "/", "/", "\\", "\\", "//", "\\\\", "/./", "/../", "\\..\\", "/\\"];
const starts = [
  "",
  "",
  "",
  "/",
  "/",
  "/",
  "//",
  "///",
  "\\",
  "\\\\",
  "\\\\?\\",
  "\\\\.\\",
  "C:",
  "C:\\",
  "c:/",
  "./",
  "../",
  ".\\",
  "..\\",
];
const ends = ["", "", "", "", "/", "//", "\\", "/.", "/..", "."];

function createPaths(seed: number, count: number) {
  const random = createRandom(seed);
  const pick = <T>(list: readonly T[]) => list[random(list.length)];
  return Array.from({ length: count }, () => {
    let text = pick(starts);
    for (let parts = random(7); parts > 0; --parts) text += pick(names) + (parts > 1 ? pick(separators) : "");
    return text + pick(ends);
  });
}

// CI's runner collects garbage at every call of a matcher, and there are over a million comparisons here: a test gathers
// what differs and calls one matcher.
function createComparison() {
  const different: unknown[][] = [];
  const compare = (label: unknown[], narrow: unknown, inWideStorage: unknown) => {
    if (!Bun.deepEquals(narrow, inWideStorage, true)) different.push([...label, narrow, inWideStorage]);
  };
  return { different, compare };
}

const platforms = { posix: path.posix, win32: path.win32 };
const ofOnePath = ["basename", "dirname", "extname", "isAbsolute", "normalize", "parse", "resolve", "join"] as const;

describe.each(Object.entries(platforms))("path.%s", (_, p) => {
  test.each(Object.entries(forms))("a %s is read as the same characters in 16-bit storage are", (_, form) => {
    const paths = createPaths(1, 1500);
    const { different, compare } = createComparison();
    paths.forEach((a, index) => {
      const b = paths[(index + 1) % paths.length];
      const c = paths[(index + 2) % paths.length];
      for (const name of ofOnePath) compare([a, name], p[name](form(a)), p[name](wide(a)));
      for (const suffix of [a.slice(-(index % 6)), ".ts", "é", a, a + "x"])
        compare([a, suffix], p.basename(form(a), form(suffix)), p.basename(wide(a), wide(suffix)));
      compare([a, b], p.relative(form(a), form(b)), p.relative(wide(a), wide(b)));
      compare([a, b, "down"], p.relative(form(a), form(a + "/" + b)), p.relative(wide(a), wide(a + "/" + b)));
      compare([a, b, "up"], p.relative(form(a + "/" + b), form(a)), p.relative(wide(a + "/" + b), wide(a)));
      compare([a, b, c, "join"], p.join(form(a), form(b), form(c)), p.join(wide(a), wide(b), wide(c)));
      compare([a, b, c, "resolve"], p.resolve(form(a), form(b), form(c)), p.resolve(wide(a), wide(b), wide(c)));
      compare([a, "dirname twice"], p.dirname(p.dirname(form(a))), p.dirname(p.dirname(wide(a))));
      compare(
        [a, "joined again"],
        p.join(p.dirname(form(a)), p.basename(form(a))),
        p.join(p.dirname(wide(a)), p.basename(wide(a))),
      );
    });
    expect(different).toEqual([]);
  });

  test("every length around the widths that are read at once", () => {
    const { different, compare } = createComparison();
    for (let length = 0; length <= 70; ++length) {
      for (const at of [0, 1, length >> 1, length - 2, length - 1]) {
        for (const inserted of ["/", "//", "/.", "/./", "/..", "/../", ".", "..", "\\", "é"]) {
          for (const start of ["", "/"]) {
            const text = start + "x".repeat(Math.max(at, 0)) + inserted + "y".repeat(Math.max(length - at, 0));
            for (const name of ofOnePath) compare([text, name], p[name](flat(text)), p[name](wide(text)));
            compare([text, "join"], p.join(flat(text), flat(text)), p.join(wide(text), wide(text)));
            compare([text, "resolve"], p.resolve(flat(text), flat(text)), p.resolve(wide(text), wide(text)));
            compare(
              [text, "relative from"],
              p.relative(flat(text), flat("/" + text + "/z")),
              p.relative(wide(text), wide("/" + text + "/z")),
            );
            compare(
              [text, "relative to"],
              p.relative(flat("/x/" + text + "/z"), flat(text)),
              p.relative(wide("/x/" + text + "/z"), wide(text)),
            );
          }
        }
      }
    }
    expect(different).toEqual([]);
  });

  test("every short path made of a slash, a dot and a letter", () => {
    const { different, compare } = createComparison();
    const resolved: string[] = [];
    for (let length = 0; length <= 7; ++length) {
      for (let number = 0; number < 3 ** length; ++number) {
        let short = "";
        for (let rest = number, i = 0; i < length; ++i, rest = Math.floor(rest / 3)) short += "/.a"[rest % 3];
        // What is around it moves it across the widths that are read at once.
        for (const before of ["", "/", "bbbbbb", "/bbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb/"]) {
          for (const after of length < 6 || before === "/" ? ["", "c", "/ccccccc", "cccccccccccccccc"] : [""]) {
            const text = before + short + after;
            for (const name of ofOnePath) compare([text, name], p[name](flat(text)), p[name](wide(text)));
            for (const suffix of ["a", ".a", "/", "a/", ".", "aa", "c", "ac", "/a", text.slice(-3), "b" + text])
              compare([text, suffix], p.basename(flat(text), flat(suffix)), p.basename(wide(text), wide(suffix)));
            compare([text, "join"], p.join(flat("x/y"), flat(text)), p.join(wide("x/y"), wide(text)));
            compare([text, "resolve"], p.resolve(flat("/x/y"), flat(text)), p.resolve(wide("/x/y"), wide(text)));
            compare([text, "relative to"], p.relative(flat("/a/b"), flat(text)), p.relative(wide("/a/b"), wide(text)));
            compare(
              [text, "relative from"],
              p.relative(flat(text), flat("/a/b")),
              p.relative(wide(text), wide("/a/b")),
            );
          }
        }
        if (length <= 4) resolved.push("/" + short);
      }
    }
    for (const from of resolved)
      for (const to of resolved)
        compare([from, to], p.relative(flat(from), flat(to)), p.relative(wide(from), wide(to)));
    expect(different).toEqual([]);
  });

  test("an answer outlives its operand", () => {
    const answers: string[] = [];
    for (let i = 0; i < 2000; ++i) {
      const text = copy(`/folder-${i}/another-folder/file-${i}.extension`);
      answers.push(
        p.dirname(text),
        p.basename(text),
        p.extname(text),
        p.parse(text).name,
        p.normalize(text),
        p.join(text, copy(`leaf-${i}`)),
      );
      if (i % 500 === 0) Bun.gc(true);
    }
    Bun.gc(true);
    const separator = p.sep;
    const expected: string[] = [];
    for (let i = 0; i < 2000; ++i) {
      const folder =
        p === path.posix ? `/folder-${i}/another-folder` : `${separator}folder-${i}${separator}another-folder`;
      expected.push(
        `/folder-${i}/another-folder`,
        `file-${i}.extension`,
        ".extension",
        `file-${i}`,
        `${folder}${separator}file-${i}.extension`,
        `${folder}${separator}file-${i}.extension${separator}leaf-${i}`,
      );
    }
    expect(answers).toEqual(expected);
  });

  test("what is no string", () => {
    const message = (name: string, got: string) => `The "${name}" property must be of type string, got ${got}`;
    for (const name of ["basename", "dirname", "extname", "isAbsolute", "normalize", "parse"] as const) {
      expect(() => p[name](5 as any)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
          name: "TypeError",
          message: message("path", "number"),
        }),
      );
      expect(() => (p[name] as any)()).toThrow(message("path", "undefined"));
      expect(() => p[name]([] as any)).toThrow(message("path", "array"));
      expect(() => p[name](null as any)).toThrow(message("path", "object"));
    }
    expect(() => p.basename("a", 5 as any)).toThrow(message("ext", "number"));
    expect(() => p.basename(5 as any, 6 as any)).toThrow(message("ext", "number"));
    expect(p.basename("a.b", undefined)).toBe("a.b");
    expect(() => p.relative(5 as any, 6 as any)).toThrow(message("from", "number"));
    expect(() => p.relative("a", 6 as any)).toThrow(message("to", "number"));
    expect(() => p.join("a", "b", {} as any)).toThrow(message("paths[2]", "object"));
    expect(() => p.join(true as any, {} as any)).toThrow(message("paths[0]", "boolean"));
    expect(() => p.resolve("a", "b", {} as any)).toThrow(message("paths[2]", "object"));
    expect(() => p.resolve(true as any, {} as any)).toThrow(message("paths[1]", "object"));
    expect(p.toNamespacedPath(5 as any)).toBe(5 as any);
  });

  test("String objects are converted first, in the order of the operands", () => {
    const log: string[] = [];
    const noisy = (name: string, text: string): any =>
      Object.assign(new String(text), { toString: () => (log.push(name), text) });
    const ran = (run: () => unknown) => {
      log.length = 0;
      try {
        run();
      } catch {}
      return log.join();
    };
    expect(ran(() => p.basename(noisy("path", "a.b"), noisy("ext", ".b")))).toBe("path,ext");
    expect(ran(() => p.basename(5 as any, noisy("ext", ".b")))).toBe("ext");
    expect(ran(() => p.relative(noisy("from", "a"), noisy("to", "b")))).toBe("from,to");
    expect(ran(() => p.join(5 as any, noisy("second", "b"), noisy("third", "c")))).toBe("second,third");
    expect(ran(() => p.resolve(noisy("first", "a"), noisy("second", "/b"), noisy("third", "c")))).toBe(
      "first,second,third",
    );
  });

  test("the functions are named and counted as they were", () => {
    for (const name of [
      "basename",
      "dirname",
      "extname",
      "format",
      "isAbsolute",
      "join",
      "normalize",
      "parse",
      "relative",
      "resolve",
      "toNamespacedPath",
    ] as const) {
      expect([name, p[name].name, p[name].length]).toEqual([name, name, 1]);
    }
  });
});

test("path.posix.resolve looks at no operand in front of one that is absolute", () => {
  expect(path.posix.resolve(5 as any, "/a", "b")).toBe("/a/b");
});

test("path.posix.parse of a name made of dots right behind the root", () => {
  expect(path.posix.parse("/..")).toEqual(path.posix.parse(wide("/..")));
  expect(path.posix.parse("a/..")).toEqual({ root: "", dir: "a", base: "..", ext: "", name: ".." });
});
