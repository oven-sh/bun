// Checks node:path against outputs recorded from Node.js for a corpus of generated
// inputs (mixed separators, drive letters, UNC and \\?\ prefixes, reserved device
// names, non-Latin-1 and astral characters). Every case here is independent of
// process.cwd().
//
// The corpus lives in node-path-parity.json as [namespace, fn, args, expected]
// where `expected` is a string/boolean, a parse() object, or { error: { code, message } }.
import { describe, expect, test } from "bun:test";
import path from "node:path";
import fixture from "./node-path-parity.json" with { type: "json" };

type Row = ["posix" | "win32", string, unknown[], unknown];

describe("node:path matches Node.js", () => {
  const rows = fixture as Row[];
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = `${row[0]}.${row[1]}`;
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(row);
  }

  for (const [key, list] of groups) {
    test(`${key} (${list.length} cases)`, () => {
      for (const [ns, fn, args, expected] of list) {
        const impl = path[ns][fn];
        if (expected && typeof expected === "object" && "error" in (expected as object)) {
          const { code, message } = (expected as { error: { code: string; message: string } }).error;
          let thrown: unknown;
          try {
            impl(...args);
          } catch (e) {
            thrown = e;
          }
          expect(thrown, `${key}(${JSON.stringify(args)})`).toMatchObject({ code, message });
        } else {
          expect(impl(...args), `${key}(${JSON.stringify(args)})`).toEqual(expected);
        }
      }
    });
  }
});

// Inputs longer than the native implementation's on-stack scratch space.
describe("node:path long inputs", () => {
  const segment = "/segment_name";
  const long = segment.repeat(400); // 5200 characters
  const longWin = long.replaceAll("/", "\\");

  test("posix", () => {
    expect(path.posix.normalize(long + "/./x/../")).toBe(long + "/");
    expect(path.posix.join(long, "..", "y")).toBe(long.slice(0, -segment.length) + "/y");
    expect(path.posix.resolve(long, "a/../b")).toBe(long + "/b");
    expect(path.posix.relative(long, long + "/child/leaf")).toBe("child/leaf");
    expect(path.posix.relative(long + "/a", long + "/b")).toBe("../b");
    expect(path.posix.dirname(long)).toBe(long.slice(0, -segment.length));
    expect(path.posix.basename(long + "/file.txt", ".txt")).toBe("file");
    expect(path.posix.parse(long + "/file.txt")).toEqual({
      root: "/",
      dir: long,
      base: "file.txt",
      ext: ".txt",
      name: "file",
    });
    // UTF-16 variant
    const wide = long + "/日本語";
    expect(path.posix.normalize(wide + "/./")).toBe(wide + "/");
    expect(path.posix.join(wide, "ファイル.txt")).toBe(wide + "/ファイル.txt");
  });

  test("win32", () => {
    expect(path.win32.normalize("C:" + long + "/./x/../")).toBe("C:" + longWin + "\\");
    expect(path.win32.join("C:\\", long, "..", "y")).toBe("C:" + longWin.slice(0, -segment.length) + "\\y");
    expect(path.win32.resolve("C:" + long, "a/../b")).toBe("C:" + longWin + "\\b");
    expect(path.win32.relative("C:" + long, "C:" + long + "/child/leaf")).toBe("child\\leaf");
    expect(path.win32.relative("C:" + longWin + "\\İ", "C:" + longWin + "\\İ\\x")).toBe("x");
    expect(path.win32.toNamespacedPath("C:" + long)).toBe("\\\\?\\C:" + longWin);
    expect(path.win32.toNamespacedPath("\\\\server\\share" + longWin)).toBe("\\\\?\\UNC\\server\\share" + longWin);
    expect(path.win32.dirname("C:" + longWin)).toBe("C:" + longWin.slice(0, -segment.length));
    expect(path.win32.parse("C:" + longWin + "\\file.txt")).toEqual({
      root: "C:\\",
      dir: "C:" + longWin,
      base: "file.txt",
      ext: ".txt",
      name: "file",
    });
  });

  test("many arguments", () => {
    const parts = Array.from({ length: 40 }, (_, i) => `p${i}`);
    expect(path.posix.join(...parts)).toBe(parts.join("/"));
    expect(path.win32.join(...parts)).toBe(parts.join("\\"));
    expect(path.posix.resolve("/root", ...parts)).toBe("/root/" + parts.join("/"));
    expect(path.win32.resolve("C:\\root", ...parts)).toBe("C:\\root\\" + parts.join("\\"));
    // Validation happens from the last argument backwards and stops at the first absolute path.
    expect(path.posix.resolve(1 as any, "/abs", "x")).toBe("/abs/x");
    expect(() => path.posix.resolve("/abs", 1 as any, "x")).toThrow('The "paths[1]" argument must be of type string');
    expect(path.win32.resolve(1 as any, "C:\\abs", "x")).toBe("C:\\abs\\x");
    expect(() => path.win32.resolve(1 as any, "\\abs", "x")).toThrow('The "paths[0]" argument must be of type string');
  });
});

describe("node:path module shape", () => {
  test("matches Node.js", () => {
    const keys = [
      "resolve",
      "normalize",
      "isAbsolute",
      "join",
      "relative",
      "toNamespacedPath",
      "dirname",
      "basename",
      "extname",
      "format",
      "parse",
      "matchesGlob",
      "sep",
      "delimiter",
      "win32",
      "posix",
      "_makeLong",
    ];
    expect(Object.keys(path.posix)).toEqual(keys);
    expect(Object.keys(path.win32)).toEqual(keys);
    for (const ns of [path.posix, path.win32]) {
      for (const key of keys.slice(0, 11)) {
        expect(typeof ns[key]).toBe("function");
        expect(ns[key].name).toBe(key === "format" ? "bound _format" : key);
      }
      expect(ns._makeLong).toBe(ns.toNamespacedPath);
    }
    expect(path.posix.resolve.length).toBe(0);
    expect(path.posix.join.length).toBe(0);
    expect(path.posix.relative.length).toBe(2);
    expect(path.posix.basename.length).toBe(2);
    expect(path.posix.format.length).toBe(1);
    expect(path.posix.matchesGlob.length).toBe(2);
    // Functions do not depend on `this`.
    const { join, basename } = path.win32;
    expect(join("a", "b")).toBe("a\\b");
    expect(basename("C:\\x\\y.z", ".z")).toBe("y");
  });
});
