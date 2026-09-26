/**
 * @note `fs.glob` et. al. are powered by {@link Bun.Glob}, which is extensively
 * tested elsewhere. These tests check API compatibility with Node.js.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tempDirWithFiles } from "harness";
import fs from "node:fs";
import path from "node:path";

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
      expect(() => fs.glob("*.txt")).toThrow(TypeError);
      expect(() => fs.glob("*.txt", undefined)).toThrow(TypeError);
      expect(() => fs.glob("*.txt", { cwd: tmp })).toThrow(TypeError);
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

      const paths = [];
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

describe("fs.glob walk", () => {
  it.concurrent("does not call path.join() or path.resolve() once per entry", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 200; i++) files[`f${i}.txt`] = "";
    using flat = tempDir("fs-glob-flat", files);
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const path = require("node:path");
          const calls = { join: 0, resolve: 0 };
          for (const name of ["join", "resolve"]) {
            const original = path[name];
            path[name] = (...args) => (calls[name]++, original(...args));
          }
          const fs = require("node:fs");
          const cwd = process.argv[1];
          const sync = fs.globSync("*.txt", { cwd }).length;
          const async = (await Array.fromAsync(fs.promises.glob("*.txt", { cwd }))).length;
          console.log(JSON.stringify({ sync, async, perEntry: calls.join >= 200 || calls.resolve >= 200 }));
        `,
        String(flat),
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ sync: 200, async: 200, perEntry: false });
    expect(exitCode).toBe(0);
  });
});

describe("fs.promises.glob on a tree", () => {
  // The async walk starts the readdir of the next few directories before it
  // visits them. The result must not depend on that: same entries, same order
  // as the sync walk, also when a directory has more subdirectories than the
  // walk reads ahead.
  let cwd: string;
  beforeAll(() => {
    const files: Record<string, string> = { "top.txt": "", ".hidden/h.txt": "" };
    for (let i = 0; i < 20; i++) {
      files[`d${i}/a.txt`] = "";
      files[`d${i}/b.js`] = "";
      files[`d${i}/sub/c.txt`] = "";
      files[`d${i}/sub/deep/d.txt`] = "";
    }
    cwd = tempDirWithFiles("fs-glob-tree", files);
  });
  afterAll(() => fs.promises.rm(cwd, { recursive: true, force: true }));

  describe.each(["**", "**/*.txt", "*/*/*.txt", "**/sub/**", "d1*/**/*.txt", "d3/sub/deep/*", "*/missing/*"])(
    "%j",
    pattern => {
      it("gives what globSync gives", async () => {
        const expected = fs.globSync(pattern, { cwd });
        expect(await Array.fromAsync(fs.promises.glob(pattern, { cwd }))).toEqual(expected);
        const dirents = (await Array.fromAsync(fs.promises.glob(pattern, { cwd, withFileTypes: true }))) as fs.Dirent[];
        expect(dirents.map(dirent => path.relative(cwd, path.join(dirent.parentPath, dirent.name)) || ".")).toEqual(
          expected,
        );
      });
    },
  );

  // The walk does not await the readdir that it starts ahead of time. A
  // rejection of that readdir must still reach the consumer, and only the
  // consumer: it is not an unhandled rejection.
  describe.each([
    ["the root", "*.txt", "true"],
    ["a queued directory", "*/*.txt", 'path.endsWith("d3")'],
  ])("a readdir of %s that fails to sort", (_, pattern, fails) => {
    it.concurrent("rejects the iteration", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const fsp = require("node:fs/promises");
          const readdir = fsp.readdir;
          fsp.readdir = async (path, options) =>
            ${fails} ? { sort() { throw new Error("cannot sort"); } } : readdir(path, options);
          try {
            for await (const entry of fsp.glob(${JSON.stringify(pattern)}, { cwd: process.argv[1] })) {}
            console.log("no error");
          } catch (error) {
            console.log("caught:", error.message);
          }
        `,
          cwd,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr }).toEqual({ stdout: "caught: cannot sort\n", stderr: "" });
      expect(exitCode).toBe(0);
    });
  });

  it.concurrent("reads the next directories while it matches the current one", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const fsp = require("node:fs/promises");
          const readdir = fsp.readdir;
          let inFlight = 0;
          let maxInFlight = 0;
          fsp.readdir = async (path, options) => {
            maxInFlight = Math.max(maxInFlight, ++inFlight);
            try {
              return await readdir(path, options);
            } finally {
              inFlight--;
            }
          };
          const entries = await Array.fromAsync(fsp.glob("**/*.txt", { cwd: process.argv[1] }));
          console.log(JSON.stringify({ entries: entries.length, maxInFlight }));
        `,
        cwd,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // 8 is the read-ahead window. Below the root a directory has at most one subdirectory, and the walk starts that
    // one read after the read it awaited has settled, so the count never goes above the window.
    expect(JSON.parse(stdout)).toEqual({ entries: 61, maxInFlight: 8 });
    expect(exitCode).toBe(0);
  });

  it("stops without an error when the consumer breaks out early", async () => {
    const seen: string[] = [];
    for await (const entry of fs.promises.glob("**/*.txt", { cwd })) {
      seen.push(entry);
      if (seen.length === 3) break;
    }
    expect(seen).toHaveLength(3);
  });
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
