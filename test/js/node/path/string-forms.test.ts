// src/runtime/node/path.rs reads strings in place, in either width, and returns substrings of its arguments.
// The two widths have different search kernels, and short 8-bit paths have a fast path.
import { heapStats, jscDescribe } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const flat = (text: string) => (text.charCodeAt(0), text);
const copy = (text: string) => flat(Buffer.from(text, "utf16le").toString("utf16le"));
const wide = (text: string) => flat("日" + text + "本").slice(1, -1);
const narrowCopy = (text: string) => Buffer.from(text, "latin1").toString("latin1");

// A string that is looked up as a property key takes the storage of the equal key that is there, of either width, and
// so do the substrings that were made of it before.
const keys: Record<string, boolean> = {};
function substringOfKey(text: string, key: (text: string) => string, base: (text: string) => string) {
  keys[key(text)] = true;
  const whole = base(text);
  const part = whole.slice(2, -3);
  if (!keys[whole]) throw new Error(`${whole} is not among the keys`);
  return part;
}

const forms: Record<string, (text: string) => any> = {
  flat: text => flat(text + ""),
  rope: text => (text.length < 2 ? text : copy(text.slice(0, text.length >> 1)) + copy(text.slice(text.length >> 1))),
  ropeOfThree: text =>
    text.length < 3 ? text : copy(text.slice(0, 1)) + (copy(text.slice(1, 2)) + copy(text.slice(2))),
  ropeOf8Bit: text =>
    text.length < 2 ? text : narrowCopy(text.slice(0, text.length >> 1)) + narrowCopy(text.slice(text.length >> 1)),
  ropeOfBothWidths: text =>
    text.length < 2 ? text : narrowCopy(text.slice(0, text.length >> 1)) + copy(text.slice(text.length >> 1)),
  substring: text => flat("<<" + text + ">>>").slice(2, -3),
  substringOfWhatBecame16Bit: text => substringOfKey("[[" + text + "]]]", copy, narrowCopy),
  substringOfWhatBecame8Bit: text => substringOfKey("((" + text + ")))", narrowCopy, copy),
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
    const message = (name: string, got: string) => `The "${name}" argument must be of type string. Received ${got}`;
    for (const name of ["basename", "dirname", "extname", "isAbsolute", "normalize", "parse"] as const) {
      expect(() => p[name](5 as any)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
          name: "TypeError",
          message: message("path", "type number (5)"),
        }),
      );
      expect(() => (p[name] as any)()).toThrow(message("path", "undefined"));
      expect(() => p[name]([] as any)).toThrow(message("path", "an instance of Array"));
      expect(() => p[name](null as any)).toThrow(message("path", "null"));
    }
    expect(() => p.basename("a", 5 as any)).toThrow(message("suffix", "type number (5)"));
    expect(() => p.basename(5 as any, 6 as any)).toThrow(message("suffix", "type number (6)"));
    expect(() => p.basename("a", null as any)).toThrow(message("suffix", "null"));
    expect(p.basename("a.b", undefined)).toBe("a.b");
    expect(() => p.relative(5 as any, 5 as any)).toThrow(message("from", "type number (5)"));
    expect(() => p.relative("a", 6 as any)).toThrow(message("to", "type number (6)"));
    expect(() => p.matchesGlob(5 as any, 6 as any)).toThrow(message("path", "type number (5)"));
    expect(() => p.matchesGlob("a", 6 as any)).toThrow(message("pattern", "type number (6)"));
    expect(() => p.join(5 as any)).toThrow(message("path", "type number (5)"));
    expect(() => p.join("a", "b", {} as any)).toThrow(message("path", "an instance of Object"));
    expect(() => p.join(true as any, {} as any)).toThrow(message("path", "type boolean (true)"));
    expect(() => p.resolve(5 as any)).toThrow(message("paths[0]", "type number (5)"));
    expect(() => p.resolve(true as any, {} as any)).toThrow(message("paths[1]", "an instance of Object"));
    expect(() => p.resolve("a", "b", {} as any)).toThrow(message("paths[2]", "an instance of Object"));
    expect(() => p.resolve("a", null as any, "b", "c", "d")).toThrow(message("paths[1]", "null"));
    expect(p.toNamespacedPath(5 as any)).toBe(5 as any);
  });
});

test.each(Object.entries(forms))("node:url reads a %s as the same characters in 16-bit storage", (_, form) => {
  const { different, compare } = createComparison();
  const answerOf = (run: () => unknown) => {
    try {
      return run();
    } catch (error) {
      return (error as NodeJS.ErrnoException).code;
    }
  };
  for (const text of createPaths(2, 1500)) {
    for (const windows of [false, true]) {
      compare(
        [text, windows, "pathToFileURL"],
        answerOf(() => pathToFileURL(form(text), { windows }).href),
        answerOf(() => pathToFileURL(wide(text), { windows }).href),
      );
      const url = "file:///" + encodeURI(text.replaceAll("\\", "/"));
      compare(
        [url, windows, "fileURLToPath"],
        answerOf(() => fileURLToPath(form(url), { windows })),
        answerOf(() => fileURLToPath(wide(url), { windows })),
      );
    }
  }
  expect(different).toEqual([]);
});

test("the parts of a path that is then looked up among keys in 16-bit storage", () => {
  // JSON.parse keeps the long strings of a text that has a character above U+00FF in 16 bits.
  const { report } = JSON.parse('{"title":"\u2603","report":"/var/data/reports/2026/summary.final.csv"}');
  const visited: Record<string, boolean> = { [report]: true };
  const resolved = path.posix.resolve(report);
  const folder = path.posix.dirname(resolved);
  const name = path.posix.basename(resolved);
  const nameWithoutSuffix = path.posix.basename(resolved, ".csv");
  const extension = path.posix.extname(resolved);
  const below = path.posix.relative("/var/data", resolved);
  const parsed = path.posix.parse(resolved);
  expect(visited[resolved]).toBe(true);
  expect({
    joined: path.posix.join(folder, "notes.txt"),
    resolved: path.posix.resolve(folder, ".."),
    normalized: path.posix.normalize(below),
    folderOfFolder: path.posix.dirname(folder),
    folderOfBelow: path.posix.dirname(below),
    extensionOfName: path.posix.extname(name),
    extensionOfRest: path.posix.extname(nameWithoutSuffix),
    nameOfExtension: path.posix.basename(extension),
    parsedName: path.posix.parse(name),
    formatted: path.posix.format({ dir: parsed.dir, name: parsed.name, ext: ".txt" }),
    joinedOnWindows: path.win32.join(parsed.dir, parsed.base),
    url: pathToFileURL(folder, { windows: false }).href,
  }).toEqual({
    joined: "/var/data/reports/2026/notes.txt",
    resolved: "/var/data/reports",
    normalized: "reports/2026/summary.final.csv",
    folderOfFolder: "/var/data/reports",
    folderOfBelow: "reports/2026",
    extensionOfName: ".csv",
    extensionOfRest: ".final",
    nameOfExtension: ".csv",
    parsedName: { root: "", dir: "", base: "summary.final.csv", ext: ".csv", name: "summary.final" },
    formatted: "/var/data/reports/2026/summary.final.txt",
    joinedOnWindows: "\\var\\data\\reports\\2026\\summary.final.csv",
    url: "file:///var/data/reports/2026",
  });
});

describe.each(["latin1", "utf16le"] as const)("a path that is cut from a long %s string", encoding => {
  const [count, size] = [16, 1 << 20];
  const directories = "/some-directory/another-directory";
  function cut(text: string, resolvesIt: boolean) {
    const whole = Buffer.alloc(size);
    whole.write(text, encoding);
    const part = whole.toString(encoding).slice(0, text.length);
    if (resolvesIt) new Map().set(part, true);
    expect(jscDescribe(part).includes("rope")).toBe(!resolvesIt);
    return part;
  }

  test.each([
    ["posix.resolve", "", (it: string) => path.posix.resolve(it)],
    ["posix.resolve of two", "", (it: string) => path.posix.resolve("/a", it)],
    ["posix.relative", "", (it: string) => path.posix.relative("/", it)],
    ["win32.resolve", "C:", (it: string) => path.win32.resolve(it)],
    ["win32.relative", "C:", (it: string) => path.win32.relative("C:\\", it)],
    ["win32.toNamespacedPath", "C:", (it: string) => path.win32.toNamespacedPath(it)],
    ["posix.extname", "", (it: string) => path.posix.extname(it)],
  ])("is not kept alive by the result of %s", (_, drive, call) => {
    for (const resolvesIt of [false, true]) {
      const text = (index: number) => drive + `${directories}/${index}.ext`.replaceAll("/", drive ? "\\" : "/");
      const results: string[] = [];
      Bun.gc(true);
      const before = heapStats().extraMemorySize;
      for (let index = 0; index < count; index++) results.push(call(cut(text(index), resolvesIt)));
      Bun.gc(true);
      expect(heapStats().extraMemorySize - before).toBeLessThan((count * size) / 2);
      expect(results).toEqual(results.map((_, index) => call(text(index))));
    }
  });
});

test("path.relative() to a substring that the GC resolves during the call", async () => {
  // The GC formats the stack of an error once one of its functions is dead. That resolves the function names, and a
  // name of at most 12 characters is copied out of its base. `large` exceeds the heap limit, so allocating the cell of
  // the result runs one GC and allocating its characters runs another. Setup in a first call can use up the first GC.
  const limit = 20_000;
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        import { jscDescribe } from "bun:jsc";
        import { posix, win32 } from "node:path";
        function substring(text) {
          const whole = Buffer.alloc(2 << 20, "y");
          whole.write(text, 1 << 20);
          return whole.toString("latin1").slice(1 << 20, (1 << 20) + text.length);
        }
        let error;
        function prepare(to) {
          const large = [1];
          let inner = new Function("const error = new Error(); Bun.gc(true); return error");
          error = Object.defineProperty(() => [inner()], "name", { value: to })();
          inner = null;
          large.length = ${limit};
        }
        const all = [];
        function relative(path, root, name, replacesResolve) {
          const from = Buffer.from(root + Buffer.alloc(${limit}, path.sep + "a") + path.sep + name).toString();
          const to = substring(root + path.sep + "bcdefgh");
          all.push(to);
          if (replacesResolve) path.resolve = operand => (operand === to && prepare(to), operand);
          else prepare(to);
          return path.relative(from, to);
        }
        for (const [path, root] of [[posix, ""], [win32, "C:"]])
          for (const replacesResolve of [false, true])
            for (const name of ["a", "\\u65e5", "a", "\\u65e5"])
              console.log(relative(path, root, name, replacesResolve).slice(-10));
        console.log(all.some(to => !jscDescribe(to).includes("rope")));
      `,
    ],
    env: {
      ...bunEnv,
      BUN_JSC_gcMaxHeapSize: String(limit),
      BUN_JSC_useConcurrentGC: "0",
      BUN_JSC_useGenerationalGC: "0",
      BUN_JSC_sweepSynchronously: "1",
      MIMALLOC_PURGE_DELAY: "0",
      // bmalloc has no SystemHeap on Windows.
      ...(isWindows ? {} : { Malloc: "1", ASAN_OPTIONS: "detect_leaks=0" }),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.split(/\r?\n/), stderr, exitCode }).toEqual({
    stdout: [...Array(8).fill("../bcdefgh"), ...Array(8).fill("..\\bcdefgh"), "true", ""],
    stderr: "",
    exitCode: 0,
  });
});

test("path.posix.resolve looks at no operand in front of one that is absolute", () => {
  expect(path.posix.resolve(5 as any, "/a", "b")).toBe("/a/b");
});

test("path.posix.parse of a name made of dots right behind the root", () => {
  expect(path.posix.parse("/..")).toEqual(path.posix.parse(wide("/..")));
  expect(path.posix.parse("a/..")).toEqual({ root: "", dir: "a", base: "..", ext: "", name: ".." });
});
