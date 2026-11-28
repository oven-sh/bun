/**
 * @note `fs.glob` et. al. are powered by {@link Bun.Glob}, which is extensively
 * tested elsewhere. These tests check API compatibility with Node.js.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tempDirWithFiles } from "harness";
import fs from "node:fs";

let tmp: string;
beforeAll(() => {
  tmp = tempDirWithFiles("fs-glob", {
    "foo.txt": "foo",
    a: {
      "bar.txt": "bar",
      "baz.js": "baz",
    },
    "folder.test": {
      "file.txt": "content",
      "another-folder": {
        "some-file.txt": "content",
      },
    },
  });
});

afterAll(() => {
  return fs.promises.rm(tmp, { recursive: true, force: true });
});

describe("fs.glob", () => {
  it("has a length of 3", () => {
    expect(fs).toHaveProperty("glob");
    expect(typeof fs.glob).toEqual("function");
    expect(fs.glob).toHaveLength(3);
  });

  it("is named 'glob'", () => {
    expect(fs.glob.name).toEqual("glob");
  });

  it("when successful, passes paths to the callback", done => {
    fs.glob("*.txt", { cwd: tmp }, (err, paths) => {
      expect(err).toBeNull();
      expect(paths.sort()).toStrictEqual(["foo.txt"]);
      done();
    });
  });

  it("can filter out files", done => {
    const exclude = (path: string) => path.endsWith(".js");
    fs.glob("a/**", { cwd: tmp, exclude }, (err, paths) => {
      if (err) done(err);
      if (isWindows) {
        expect(paths.sort()).toStrictEqual(["a", "a\\bar.txt"]);
      } else {
        expect(paths.sort()).toStrictEqual(["a", "a/bar.txt"]);
      }
      done();
    });
  });

  it("can filter out files (2)", done => {
    const exclude = ["**/*.js"];
    fs.glob("a/*", { cwd: tmp, exclude }, (err, paths) => {
      if (err) done(err);
      if (isWindows) {
        expect(paths).toStrictEqual(["a\\bar.txt"]);
      } else {
        expect(paths).toStrictEqual(["a/bar.txt"]);
      }
      done();
    });
  });

  describe("invalid arguments", () => {
    it("throws if no callback is provided", () => {
      // @ts-expect-error
      expect(() => fs.glob("*.txt")).toThrow(TypeError);
      // @ts-expect-error
      expect(() => fs.glob("*.txt", undefined)).toThrow(TypeError);
      // @ts-expect-error
      expect(() => fs.glob("*.txt", { cwd: tmp })).toThrow(TypeError);
      // @ts-expect-error
      expect(() => fs.glob("*.txt", { cwd: tmp }, undefined)).toThrow(TypeError);
    });
  });

  it("matches directories", () => {
    const paths = fs.globSync("*.test", { cwd: tmp });
    expect(paths).toContain("folder.test");
  });

  it("supports arrays of patterns", () => {
    const expected = isWindows ? ["a\\bar.txt", "a\\baz.js"] : ["a/bar.txt", "a/baz.js"];
    expect(fs.globSync(["a/bar.txt", "a/baz.js"], { cwd: tmp })).toStrictEqual(expected);
  });
}); // </fs.glob>

describe("fs.globSync", () => {
  it("has a length of 2", () => {
    expect(fs).toHaveProperty("globSync");
    expect(typeof fs.globSync).toBe("function");
    expect(fs.globSync).toHaveLength(2);
  });

  it("is named 'globSync'", () => {
    expect(fs.globSync.name).toEqual("globSync");
  });

  it.each([
    ["*.txt", ["foo.txt"]],
    ["a/**", isWindows ? ["a", "a\\bar.txt", "a\\baz.js"] : ["a", "a/bar.txt", "a/baz.js"]],
  ])("fs.glob(%p, { cwd: /tmp/fs-glob }) === %p", (pattern, expected) => {
    expect(fs.globSync(pattern, { cwd: tmp }).sort()).toStrictEqual(expected);
  });

  describe("when process.cwd() is set", () => {
    let oldProcessCwd: () => string;
    beforeAll(() => {
      oldProcessCwd = process.cwd;
      process.cwd = () => tmp;
    });
    afterAll(() => {
      process.cwd = oldProcessCwd;
    });

    it("respects the new cwd", () => {
      expect(fs.globSync("*.txt")).toStrictEqual(["foo.txt"]);
    });
  });

  it("can filter out files", () => {
    const exclude = (path: string) => path.endsWith(".js");
    const expected = isWindows ? ["a", "a\\bar.txt"] : ["a", "a/bar.txt"];
    expect(fs.globSync("a/**", { cwd: tmp, exclude }).sort()).toStrictEqual(expected);
  });
  it("can filter out files (2)", () => {
    const exclude = ["**/*.js"];
    const expected = isWindows ? ["a\\bar.txt"] : ["a/bar.txt"];
    expect(fs.globSync("a/*", { cwd: tmp, exclude })).toStrictEqual(expected);
  });

  it("works without providing options", () => {
    const oldProcessCwd = process.cwd;
    try {
      process.cwd = () => tmp;

      const paths = fs.globSync("*.txt");
      expect(paths).toContain("foo.txt");
    } finally {
      process.cwd = oldProcessCwd;
    }
  });

  it("matches directories", () => {
    const paths = fs.globSync("*.test", { cwd: tmp });
    expect(paths).toContain("folder.test");
  });

  it("supports arrays of patterns", () => {
    const expected = isWindows ? ["a\\bar.txt", "a\\baz.js"] : ["a/bar.txt", "a/baz.js"];
    expect(fs.globSync(["a/bar.txt", "a/baz.js"], { cwd: tmp })).toStrictEqual(expected);
  });
}); // </fs.globSync>

describe("fs.promises.glob", () => {
  it("has a length of 2", () => {
    expect(fs.promises).toHaveProperty("glob");
    expect(typeof fs.promises.glob).toBe("function");
    expect(fs.promises.glob).toHaveLength(2);
  });

  it("is named 'glob'", () => {
    expect(fs.promises.glob.name).toEqual("glob");
  });

  describe("invalid arguments", () => {
    // Node's fs.promises.glob is an async generator: the iterator is always
    // returned and validation errors reject the first .next() instead of
    // throwing synchronously at the call site.
    it.each([
      ["non-string pattern", () => fs.promises.glob(1 as any)],
      ["non-object options", () => fs.promises.glob("*", 1 as any)],
      ["object pattern", () => fs.promises.glob({} as any)],
      ["non-string array element", () => fs.promises.glob(["*", 1] as any)],
      ["invalid exclude", () => fs.promises.glob("*", { exclude: "bad" as any })],
      ["invalid followSymlinks", () => fs.promises.glob("*", { followSymlinks: 1 as any })],
    ])("%s: returns iterator, first .next() rejects", async (_name, mk) => {
      let it: any;
      expect(() => (it = mk())).not.toThrow();
      expect(typeof it[Symbol.asyncIterator]).toBe("function");
      const next = it.next();
      expect(next).toBeInstanceOf(Promise);
      await expect(next).rejects.toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    });

    it("for-await catches the validation error", async () => {
      const it = fs.promises.glob("*", { exclude: "bad" as any });
      let caught: any;
      try {
        for await (const _ of it) {
        }
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(TypeError);
      expect(caught.code).toBe("ERR_INVALID_ARG_TYPE");
    });
  });

  it("returns an AsyncIterable over matched paths", async () => {
    const iter = fs.promises.glob("*.txt", { cwd: tmp });
    // FIXME: .toHaveProperty does not support symbol keys
    expect(iter[Symbol.asyncIterator]).toBeDefined();
    for await (const path of iter) {
      expect(path).toMatch(/\.txt$/);
    }
  });

  it("works without providing options", async () => {
    const oldProcessCwd = process.cwd;
    try {
      process.cwd = () => tmp;

      const iter = fs.promises.glob("*.txt");
      expect(iter[Symbol.asyncIterator]).toBeDefined();

      const paths: string[] = [];
      for await (const path of iter) {
        paths.push(path);
      }

      expect(paths).toContain("foo.txt");
    } finally {
      process.cwd = oldProcessCwd;
    }
  });

  it("matches directories", async () => {
    const iter = fs.promises.glob("*.test", { cwd: tmp });
    expect(iter[Symbol.asyncIterator]).toBeDefined();
    let count = 0;
    for await (const path of iter) {
      expect(path).toBe("folder.test");
      count++;
    }
    expect(count).toBe(1);
  });

  it("can filter out files", async () => {
    const exclude = (path: string) => path.endsWith(".js");
    const expected = isWindows ? ["a", "a\\bar.txt"] : ["a", "a/bar.txt"];
    const paths = await Array.fromAsync(fs.promises.glob("a/**", { cwd: tmp, exclude }));
    expect(paths.sort()).toStrictEqual(expected);
  });

  it("can filter out files (2)", async () => {
    const exclude = ["**/*.js"];
    const expected = isWindows ? ["a\\bar.txt"] : ["a/bar.txt"];
    expect(Array.fromAsync(fs.promises.glob("a/*", { cwd: tmp, exclude }))).resolves.toStrictEqual(expected);

    const exclude2 = ["folder.test/another-folder"];
    const expected2 = isWindows ? ["folder.test\\file.txt"] : ["folder.test/file.txt"];
    expect(
      Array.fromAsync(fs.promises.glob("folder.test/**/*", { cwd: tmp, exclude: exclude2 })),
    ).resolves.toStrictEqual(expected2);
  });

  it("supports arrays of patterns", async () => {
    const expected = isWindows ? ["a\\bar.txt", "a\\baz.js"] : ["a/bar.txt", "a/baz.js"];
    expect(Array.fromAsync(fs.promises.glob(["a/bar.txt", "a/baz.js"], { cwd: tmp }))).resolves.toStrictEqual(expected);
  });
}); // </fs.promises.glob>

// Node v26.12.1 ships brace-expansion 5.0.9. Node v26.3.0 shipped 5.0.5. The lists are the output of Node v26.12.1.
describe("brace expansion", () => {
  // `{},}` is a group of `}` and the empty string. 5.0.5 lost the empty string when the group came after
  // another group.
  describe("a `{},}` group after another group keeps its empty alternative", () => {
    const files = { a: "", "a}": "", b: "", "b}": "", "1": "", "1}": "", "2": "", "2}": "", c: "" };

    describe.each<[string, (pattern: string, options: fs.GlobOptionsWithoutFileTypes) => Promise<string[]>]>([
      ["fs.globSync", async (pattern, options) => fs.globSync(pattern, options)],
      [
        "fs.glob",
        (pattern, options) => {
          const { promise, resolve, reject } = Promise.withResolvers<string[]>();
          fs.glob(pattern, options, (err, paths) => (err ? reject(err) : resolve(paths)));
          return promise;
        },
      ],
      ["fs.promises.glob", (pattern, options) => Array.fromAsync(fs.promises.glob(pattern, options))],
    ])("%s", (_name, glob) => {
      it.each([
        ["{a,b}{},}", ["a", "a}", "b", "b}"]],
        ["{1..2}{},}", ["1", "1}", "2", "2}"]],
      ])("in the pattern %p", async (pattern, expected) => {
        using dir = tempDir("fs-glob-braces", files);
        expect((await glob(pattern, { cwd: String(dir) })).sort()).toStrictEqual(expected);
      });

      it("in an exclude pattern", async () => {
        using dir = tempDir("fs-glob-braces", files);
        const paths = await glob("*", { cwd: String(dir), exclude: ["{a,b}{},}"] });
        expect(paths.sort()).toStrictEqual(["1", "1}", "2", "2}", "c"]);
      });
    });

    // One row for each way to expand the group in front. A row matches each of its names with and without the `}`.
    describe("whatever the group in front is", () => {
      const rows: [string, string, string[]][] = [
        ["a sequence that counts down", "{3..1}{},}", ["1", "2", "3"]],
        ["a sequence with a step", "{0..8..4}{},}", ["0", "4", "8"]],
        ["a sequence with a negative step", "{8..0..-4}{},}", ["0", "4", "8"]],
        ["a sequence with the padding of its second bound", "{10..08}{},}", ["08", "09", "10"]],
        ["a padded sequence that starts below zero", "{-01..1}{},}", ["-01", "000", "001"]],
        ["a sequence of letters with a step", "{p..t..2}{},}", ["p", "r", "t"]],
        ["a sequence of letters that counts down", "{t..p..2}{},}", ["p", "r", "t"]],
        ["a sequence of capital letters", "{J..L}{},}", ["J", "K", "L"]],
        ["`${`, which opens no group", "x${a,b}{},}", ["x${a,b}"]],
        ["`${` after a group", "{a,b}${c}{},}", ["a${c}", "b${c}"]],
        ["`${` before a sequence", "${a,b}{1..2}{},}", ["${a,b}1", "${a,b}2"]],
        ["a group whose only comma is in a nested group", "x{{a,b}}{},}", ["x{a}", "x{b}"]],
        ["a group that stays one string", "{${a,b}}{},}", ["{${a,b}}"]],
        ["a group with a nested sequence", "{a,b{1..2}}{},}", ["a", "b1", "b2"]],
        ["a nested group with text after it", "y{c,d{e,f}g}{},}", ["yc", "ydeg", "ydfg"]],
        ["a group with an empty alternative and one more group", "{,a}{c,d}{},}", ["ac", "ad", "c", "d"]],
      ];
      // Names that a wrong expansion of one of the rows matches.
      const decoys = "5 5} 07 11 01 q s $a a$c xa xb b3 yd ydg {a} 00 -1 1}} M x$a x$b x${a,b}x".split(" ");
      const withAndWithoutBrace = (names: string[]) => names.flatMap(name => [name, name + "}"]).sort();

      let dir: string;
      beforeAll(() => {
        const names = rows.flatMap(([, , names]) => withAndWithoutBrace(names)).concat(decoys);
        dir = tempDirWithFiles("fs-glob-braces", Object.fromEntries(names.map(name => [name, ""])));
      });
      afterAll(() => fs.promises.rm(dir, { recursive: true, force: true }));

      it.each(rows)("%s: %p", (_name, pattern, names) => {
        expect(fs.globSync(pattern, { cwd: dir }).sort()).toStrictEqual(withAndWithoutBrace(names));
      });
    });
  });

  // 5.0.5 had no limit on the length. The junk alternatives expand to equal strings that end in a run of slashes:
  // minimatch keeps one of them and splits it at the slashes, so these long patterns cost little.
  describe("the list of expansions is cut where its total length passes 4,000,000 characters", () => {
    const fill = (length: number, char: string) => Buffer.alloc(length, char).toString();
    /** 2^groups equal expansions of `length` characters each. */
    const junk = (groups: number, length: number) => fill(5 * groups, "{x,x}") + fill(length - groups, "/");
    const pad = (length: number) => "z" + fill(length - 1, "/");

    it.each([
      ["`a` ends on character 4,000,000 and stays", `{${junk(7, 31249)},${pad(127)},a}`, ["a"]],
      ["`a` ends on character 4,000,001 and goes", `{${junk(7, 31249)},${pad(128)},a}`, []],
      [
        "`ab` of a second group ends on character 4,000,000 and stays",
        `{${junk(6, 31000)},${pad(15966)},a}{,b}`,
        ["a", "ab"],
      ],
      ["`ab` of a second group ends on character 4,000,002 and goes", `{${junk(6, 31000)},${pad(15967)},a}{,b}`, ["a"]],
      ["a group is cut to what fits, and the next prefix goes on", `{,q}{a,${junk(7, 31250)}}`, ["a", "qa"]],
    ])("%s", (_name, pattern, expected) => {
      using dir = tempDir("fs-glob-braces", { a: "", ab: "", qa: "" });
      expect(fs.globSync(pattern, { cwd: String(dir) }).sort()).toStrictEqual(expected);
    });
  });

  // A `{}` group has no alternatives, so this pattern is the name of one file. 5.0.5 expanded the rest of the
  // pattern twice for each such group (CVE-2026-13149): 2^32 times here, which the spawn timeout does not wait for.
  it("a run of `{},` groups does not take exponential time", async () => {
    const name = "a" + Buffer.alloc(3 * 32, "{},").toString();
    using dir = tempDir("fs-glob-braces", { [name]: "" });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `console.log(JSON.stringify(require("node:fs").globSync(${JSON.stringify(name)})))`],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: JSON.stringify([name]),
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  }, 60_000);
});

describe("fs.globSync exclude with withFileTypes", () => {
  it("invokes the exclude callback with Dirents when cwd differs from process.cwd()", () => {
    using dir = tempDir("glob-exclude-dirent", {
      "skip/inner.txt": "x",
      "keep/inner.txt": "y",
    });
    // The Dirents handed to exclude must be stat'ed relative to options.cwd,
    // not process.cwd() (a relative lookup would silently skip the callback).
    const seen: string[] = [];
    const results = fs.globSync("**", {
      cwd: dir,
      withFileTypes: true,
      exclude: (dirent: any) => {
        seen.push(dirent.name);
        return dirent.name === "skip";
      },
    }) as any[];
    expect(seen).toContain("skip");
    const names = results.map(d => d.name);
    expect(names).toContain("keep");
    expect(names).not.toContain("skip");
    // skip/inner.txt pruned with its directory; keep/inner.txt survives
    const inners = results.filter(d => d.name === "inner.txt");
    expect(inners).toHaveLength(1);
    expect(String(inners[0].parentPath).replaceAll("\\", "/")).toEndWith("keep");
  });
});
