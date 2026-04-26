/**
 * @note `fs.glob` et. al. are powered by {@link Bun.Glob}, which is extensively
 * tested elsewhere. These tests check API compatibility with Node.js.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { isWindows, tempDir, tempDirWithFiles } from "harness";
import fs from "node:fs";
import path, { sep } from "node:path";

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
  return fs.promises.rmdir(tmp, { recursive: true });
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
    ["a/**", isWindows ? ["a\\bar.txt", "a\\baz.js"] : ["a/bar.txt", "a/baz.js"]],
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
    const expected = isWindows ? ["a\\bar.txt"] : ["a/bar.txt"];
    expect(fs.globSync("a/*", { cwd: tmp, exclude })).toStrictEqual(expected);
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
    const expected = isWindows ? ["a\\bar.txt"] : ["a/bar.txt"];
    expect(Array.fromAsync(fs.promises.glob("a/*", { cwd: tmp, exclude }))).resolves.toStrictEqual(expected);
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

// https://github.com/oven-sh/bun/issues/29699
describe.skipIf(isWindows)("does not descend into directory symlinks (matches Node)", () => {
  let dir: ReturnType<typeof tempDir>;
  let root: string;

  beforeAll(() => {
    // pnpm-style symlink cycle: a/node_modules/b -> b, b/node_modules/c -> c,
    //                           c/node_modules/a -> a. If glob followed directory
    // symlinks, a `**/*.test.ts` search rooted at `a/` would loop indefinitely.
    dir = tempDir("fs-glob-symlink", {
      a: { src: { "foo.test.ts": "export {}" }, node_modules: {} },
      b: { src: { "bar.test.ts": "export {}" }, node_modules: {} },
      c: { node_modules: {} },
      // Plus a flat symlink pointing at a sibling directory (exercises the
      // non-cycle case where Node still does not descend).
      flat: { dir: { "inside.txt": "x" } },
      // A symlink pointing directly at a file (Node does match these).
      "target.txt": "t",
    });
    root = String(dir);
    fs.symlinkSync("../../b", path.join(root, "a/node_modules/b"), "dir");
    fs.symlinkSync("../../c", path.join(root, "b/node_modules/c"), "dir");
    fs.symlinkSync("../../a", path.join(root, "c/node_modules/a"), "dir");
    fs.symlinkSync("dir", path.join(root, "flat/link"), "dir");
    fs.symlinkSync("target.txt", path.join(root, "alias.txt"), "file");
  });

  afterAll(() => {
    dir[Symbol.dispose]();
  });

  it("fs.promises.glob does not loop on a pnpm-style symlink cycle", async () => {
    const matches: string[] = [];
    for await (const file of fs.promises.glob("**/*.test.ts", { cwd: path.join(root, "a") })) {
      matches.push(file);
      if (matches.length > 2) break; // guard: the bug emitted infinite matches
    }
    expect(matches).toStrictEqual(["src/foo.test.ts"]);
  });

  it("fs.globSync does not descend into a directory symlink", () => {
    expect(fs.globSync("*/*.txt", { cwd: path.join(root, "flat") }).sort()).toStrictEqual(["dir/inside.txt"]);
  });

  it("fs.globSync still matches symlinks that point at files", () => {
    expect(fs.globSync("*.txt", { cwd: root }).sort()).toStrictEqual(["alias.txt", "target.txt"]);
  });

  it("literal path segments still traverse symlinks", () => {
    // Node's nuance: *wildcard* segments don't descend into symlinks, but
    // *literal* path segments do. Dropping that distinction regresses common
    // patterns like `src/*.ts` where `src` could itself be a symlink.
    const cwd = path.join(root, "flat");
    expect(fs.globSync("link/*.txt", { cwd }).sort()).toStrictEqual(["link/inside.txt"]);
    expect(fs.globSync("link/inside.txt", { cwd }).sort()).toStrictEqual(["link/inside.txt"]);
    // But a wildcard segment that happens to match the symlink name still
    // does not descend.
    expect(fs.globSync("l*/*.txt", { cwd })).toStrictEqual([]);
  });

  it("absolute patterns with a literal prefix through a symlink", () => {
    const cwd = path.join(root, "flat");
    expect(fs.globSync(path.join(cwd, "link/*.txt"))).toStrictEqual([path.join(cwd, "link/inside.txt")]);
  });

  it("literal segments after a wildcard still traverse symlinks", () => {
    // `*/link/*.txt`: `*` matches `flat` (a real dir), then the literal
    // `link` names a symlink. Literal segments cross symlinks, so this
    // descends — matching Node.
    expect(fs.globSync("*/link/*.txt", { cwd: root })).toStrictEqual(["flat/link/inside.txt"]);
    // `**/link/*.txt` is different: once `**` is active, the walker is
    // in wildcard mode even when the next segment is a literal, so the
    // symlink boundary blocks descent. Node returns `[]` here too.
    expect(fs.globSync("**/link/*.txt", { cwd: root })).toStrictEqual([]);
  });

  it("**/literal through a self-referential symlink does not loop", () => {
    // `**/node_modules/a/*.txt` against `a/node_modules/a -> ../..`: when the
    // literal 'a' crosses the symlink the globstar must *not* re-activate on
    // the far side — otherwise the walk revisits `a/node_modules/a/...`
    // forever until ENAMETOOLONG. Node returns exactly one match.
    using dir = tempDir("glob-cycle-literal", {
      "x.txt": "root-x",
      a: { node_modules: {} },
    });
    fs.symlinkSync("../..", path.join(String(dir), "a/node_modules/a"), "dir");
    expect(fs.globSync("**/node_modules/a/*.txt", { cwd: String(dir) })).toStrictEqual(["a/node_modules/a/x.txt"]);
  });

  it("symlink is emitted as a leaf match alongside the descent it enables", () => {
    // `**/a/a/*` against `a/a/a -> target`: the matching `a` literal in the
    // active set narrows descent, but the terminal `*` in the full active
    // set also matches the symlink name directly. Both `a/a/a` (the symlink
    // itself) and `a/a/a/leaf.txt` (from the descent) should be returned —
    // matching Node. Before this fix the walker narrowed descent but skipped
    // the terminal-match check on the full set.
    using dir = tempDir("glob-leaf-and-descent", {
      a: { a: {} },
      target: { "leaf.txt": "x" },
    });
    fs.symlinkSync("../../target", path.join(String(dir), "a/a/a"), "dir");
    expect(fs.globSync("**/a/a/*", { cwd: String(dir) }).sort()).toStrictEqual([
      path.join("a", "a", "a"),
      path.join("a", "a", "a", "leaf.txt"),
    ]);
  });

  it("trailing slashes match the named directory", () => {
    // `a/` is Node-idiomatic for "match directory `a`". `Bun.Glob`
    // handles the trailing separator natively via `Component.trailing_sep`.
    expect(fs.globSync("a/", { cwd: root })).toStrictEqual(["a"]);
    expect(fs.globSync("a/src/", { cwd: root })).toStrictEqual(["a/src"]);
  });

  it("literal prefix naming a regular file returns []", () => {
    // Opening `target.txt/` as a directory would throw ENOTDIR; Node returns
    // `[]` silently and so do we.
    expect(fs.globSync("target.txt/*.js", { cwd: root })).toStrictEqual([]);
  });

  it("self-referential symlink in the literal prefix returns [] (not ELOOP)", () => {
    // Opening `loop/` as a directory throws ELOOP for a self-referential
    // symlink `loop -> loop`. Node swallows this and returns `[]`; so do we.
    using dir = tempDir("glob-loop", {});
    fs.symlinkSync("loop", path.join(String(dir), "loop"), "dir");
    expect(fs.globSync("loop/*.txt", { cwd: String(dir) })).toStrictEqual([]);
    expect(fs.globSync("loop/inside.txt", { cwd: String(dir) })).toStrictEqual([]);
  });

  it("brace alternative that names a symlink still descends", () => {
    // `{link,dir}/*.txt` should yield matches for both branches; `link` is
    // a symlink. The walker's per-branch literal check sees `link` as a
    // literal alternative of the brace, so descent is allowed.
    const cwd = path.join(root, "flat");
    expect(fs.globSync("{link,dir}/*.txt", { cwd }).sort()).toStrictEqual(["dir/inside.txt", "link/inside.txt"]);
  });

  it("mixed-wildcard brace alternative preserves the literal branch's symlink descent", () => {
    // `{link,d*}/*.txt`: `link` is a literal alt (descends through the
    // symlink), `d*` is a wildcard alt (matches `dir` but would not re-cross
    // a symlink it hit). The walker's `hasLiteralMatch` inspects each brace
    // branch separately, so entry `link` is classified as a literal match
    // regardless of the presence of `*` in the other alt.
    const cwd = path.join(root, "flat");
    expect(fs.globSync("{link,d*}/*.txt", { cwd }).sort()).toStrictEqual(["dir/inside.txt", "link/inside.txt"]);
  });

  it("nested brace alternative containing a leaf-local brace still expands it for symlink descent", () => {
    // `{{x,y}_{link,d*},other}/file.txt`: the first directory segment is a
    // compound brace whose literal alternatives include `x_link` (matching
    // the `x_link` symlink via the literal branch of `{link,d*}`). The
    // walker's per-segment literal check must recognize that a brace with
    // mixed-wildcard alternatives still has a *literal branch* the entry
    // matched — otherwise descent through `x_link` gets blocked because
    // the raw component slice contains `*`.
    using inner = tempDir("fs-glob-nested-brace", {
      x_dir: { "file.txt": "d" },
      y_dir: { "file.txt": "y" },
      other: { "file.txt": "o" },
      // target for the `x_link` symlink below
      target: { "file.txt": "l" },
    });
    const cwd = String(inner);
    fs.symlinkSync("target", path.join(cwd, "x_link"), "dir");
    expect(fs.globSync("{{x,y}_{link,d*},other}/file.txt", { cwd }).sort()).toStrictEqual([
      "other/file.txt",
      "x_dir/file.txt",
      "x_link/file.txt",
      "y_dir/file.txt",
    ]);
  });
}); // </symlink behavior>

// Cross-platform edge cases — no symlink fixtures, so these run on every
// OS. Covers patterns the walker needs to handle: trailing slashes,
// consecutive separators, ENOTDIR/ENOENT/ELOOP on the cwd, and
// user-exclude error propagation.
describe("fs.glob edge cases", () => {
  function seg(...parts: string[]) {
    return parts.join(sep);
  }

  it("trailing slash on a wildcard pattern filters to directories", () => {
    using dir = tempDir("glob-trail", {
      a: {
        sub1: { ".keep": "" },
        sub2: { ".keep": "" },
        "file.txt": "f",
      },
    });
    expect(fs.globSync("a/*/", { cwd: String(dir) }).sort()).toStrictEqual([seg("a", "sub1"), seg("a", "sub2")]);
    expect(fs.globSync("a/*", { cwd: String(dir) }).sort()).toStrictEqual([
      seg("a", "file.txt"),
      seg("a", "sub1"),
      seg("a", "sub2"),
    ]);
  });

  it("consecutive separators in a pattern do not break matching", () => {
    // Node normalizes `a//b/*.txt` to `a/b/*.txt` in output; the walker
    // should accept the input pattern either way and yield the normalized
    // path.
    using dir = tempDir("glob-dbl", {
      a: { b: { "x.txt": "x" } },
    });
    expect(fs.globSync("a//b/*.txt", { cwd: String(dir) })).toStrictEqual([seg("a", "b", "x.txt")]);
    expect(fs.globSync("a///b/*.txt", { cwd: String(dir) })).toStrictEqual([seg("a", "b", "x.txt")]);
  });

  it("exclude callback errors propagate (not swallowed by ENOENT/ENOTDIR handling)", async () => {
    using dir = tempDir("glob-exclude", { "a.txt": "a", "b.txt": "b" });
    const boom = Object.assign(new Error("exclude blew up"), { code: "ENOENT" });
    const exclude = () => {
      throw boom;
    };
    expect(() => fs.globSync("*.txt", { cwd: String(dir), exclude })).toThrow(boom);
    expect(async () => {
      for await (const _ of fs.promises.glob("*.txt", { cwd: String(dir), exclude })) break;
    }).toThrow(boom);
  });

  it("pattern that is entirely separators does not throw", () => {
    // `fs.globSync('/')` — Bun.Glob itself doesn't match root patterns
    // (a known limitation; Node returns `['/']` but Bun returns `[]`). We
    // just want to ensure we don't throw or hang on this shape.
    const _ = fs.globSync(sep);
    expect(Array.isArray(_)).toBe(true);
  });

  it("brace alternatives in a pattern yield every matching path", () => {
    using dir = tempDir("glob-braces", {
      a: { "x.txt": "x" },
      b: { "y.txt": "y" },
      c: { "z.txt": "z" },
    });
    // Simple flat brace.
    expect(fs.globSync("{a,b}/*.txt", { cwd: String(dir) }).sort()).toStrictEqual([
      seg("a", "x.txt"),
      seg("b", "y.txt"),
    ]);
    // Nested braces.
    expect(fs.globSync("{a,{b,c}}/*.txt", { cwd: String(dir) }).sort()).toStrictEqual([
      seg("a", "x.txt"),
      seg("b", "y.txt"),
      seg("c", "z.txt"),
    ]);
  });
});
