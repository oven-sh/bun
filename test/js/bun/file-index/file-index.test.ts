import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import * as fs from "node:fs";
import { join } from "node:path";

// Every indexed path is `/`-separated and relative to `root`.
function indexed(index: InstanceType<typeof Bun.FileIndex>): string[] {
  return index.glob("**/*").sort();
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

describe("Bun.FileIndex", () => {
  describe("construction & ready", () => {
    test("ready resolves with the index and queries see the crawl", async () => {
      using dir = tempDir("file-index-ready", {
        "a.txt": "alpha",
        "src/b.txt": "beta",
      });
      using index = new Bun.FileIndex(String(dir));
      // Before `ready`, queries operate on whatever is indexed (nothing yet).
      expect(index.size).toBe(0);
      expect(index.truncated).toBe(false);
      expect(await index.ready).toBe(index);
      expect(index.ready).toBe(index.ready);
      expect(indexed(index)).toEqual(["a.txt", "src", "src/b.txt"]);
      expect(index.size).toBe(3);
      expect(index.memoryUsage).toBeGreaterThan(0);
      expect(index.truncated).toBe(false);
      expect(index.watching).toBe(false);
      expect(index.root).toBe(String(dir));
    });

    test("a missing root does not throw; ready rejects with the syscall error", async () => {
      using dir = tempDir("file-index-missing", {});
      using index = new Bun.FileIndex(join(String(dir), "does-not-exist"));
      await expect(index.ready).rejects.toMatchObject({ code: "ENOENT" });
    });

    test("invalid arguments throw synchronously", () => {
      expect(() => new (Bun.FileIndex as any)()).toThrow("expects a directory path string");
      expect(() => new Bun.FileIndex("")).toThrow("root must not be empty");
      expect(() => new (Bun.FileIndex as any)(".", 1)).toThrow("options must be an object");
      expect(() => new Bun.FileIndex(".", { maxMemory: -1 })).toThrow("positive integer");
      expect(() => new Bun.FileIndex(".", { maxFileSize: 0 })).toThrow("positive integer");
      expect(() => new (Bun.FileIndex as any)(".", { ignore: 7 })).toThrow("array of strings");
      expect(() => new (Bun.FileIndex as any)(".", { onchange: 42 })).toThrow("onchange must be a function");
    });
  });

  describe("gitignore semantics", () => {
    test("nested .gitignore: negation, dir-only, anchoring, deep re-include, pruned dirs", async () => {
      using dir = tempDir("file-index-gitignore", {
        ".gitignore": "ignored_dir/\n*.log\n/top.txt\ndist/\n",
        "a.txt": "alpha",
        "top.txt": "anchored to the root",
        "sub/top.txt": "not anchored here",
        "build.log": "ignored",
        "keep.log": "ignored too",
        "ignored_dir/x.txt": "pruned",
        // The deeper file is never read because its directory is pruned, so
        // the `!x.txt` re-include cannot resurrect it (git's parent-dir rule).
        "ignored_dir/.gitignore": "!x.txt\n",
        "dist/out.js": "dir-only pattern",
        "x/dist": "a *file* named dist is not matched by `dist/`",
        "logs/.gitignore": "!important.log\n",
        "logs/important.log": "deep re-include wins",
        "logs/other.log": "still ignored",
        "src/.gitignore": "generated/\n",
        "src/main.ts": "code",
        "src/generated/out.ts": "pruned",
      });
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      expect(indexed(index)).toEqual([
        ".gitignore",
        "a.txt",
        "logs",
        "logs/.gitignore",
        "logs/important.log",
        "src",
        "src/.gitignore",
        "src/main.ts",
        "sub",
        "sub/top.txt",
        "x",
        "x/dist",
      ]);
    });

    test(".git is always skipped and .git/info/exclude is honored", async () => {
      using dir = tempDir("file-index-exclude", {
        ".git/config": "[core]",
        ".git/info/exclude": "secret.txt\n*.tmp\n",
        "secret.txt": "excluded",
        "a.tmp": "excluded by exclude, re-included by the user chain",
        "kept.txt": "kept",
      });
      {
        using index = new Bun.FileIndex(String(dir));
        await index.ready;
        expect(indexed(index)).toEqual(["kept.txt"]);
      }
      {
        // The user `ignore` chain is deeper than `.git/info/exclude`, so its
        // negation wins.
        using index = new Bun.FileIndex(String(dir), { ignore: ["!a.tmp"] });
        await index.ready;
        expect(indexed(index)).toEqual(["a.tmp", "kept.txt"]);
      }
      {
        using index = new Bun.FileIndex(String(dir), { gitignore: false });
        await index.ready;
        expect(indexed(index)).toEqual(["a.tmp", "kept.txt", "secret.txt"]);
      }
    });

    test("gitignore: false ignores .gitignore files but still applies `ignore`", async () => {
      using dir = tempDir("file-index-nogitignore", {
        ".gitignore": "*.md\n",
        "README.md": "kept when gitignore is off",
        "note.txt": "always",
      });
      using index = new Bun.FileIndex(String(dir), { gitignore: false, ignore: ["*.txt"] });
      await index.ready;
      expect(indexed(index)).toEqual([".gitignore", "README.md"]);
    });

    test.skipIf(isWindows)("symlinks are indexed as symlinks and never followed", async () => {
      using dir = tempDir("file-index-symlink", {
        "real/inner.txt": "x",
      });
      fs.symlinkSync("real", join(String(dir), "linkdir"));
      fs.symlinkSync("nope", join(String(dir), "danglink"));
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      expect(indexed(index)).toEqual(["danglink", "linkdir", "real", "real/inner.txt"]);
      expect(index.stat("linkdir")?.kind).toBe("symlink");
      expect(index.stat("danglink")?.kind).toBe("symlink");
      expect(index.has("linkdir/inner.txt")).toBe(false);
    });

    test.skipIf(isWindows)("non-UTF-8 file names are indexed without crashing", async () => {
      using dir = tempDir("file-index-nonutf8", { "plain.txt": "x" });
      const bad = Buffer.concat([Buffer.from(join(String(dir), "f")), Buffer.from([0xff, 0xfe]), Buffer.from(".bin")]);
      fs.writeFileSync(bad, "data");
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      expect(index.size).toBe(2);
      expect(index.glob("**/*")).toHaveLength(2);
    });
  });

  describe("complete()", () => {
    // Disposes both the index and the temp tree when the test ends.
    async function fixture() {
      const dir = tempDir("file-index-complete", {
        "abc.ts": "1",
        "a-b-c.ts": "1",
        "axxbxxc.ts": "1",
        "src/index.ts": "1",
        "src/server/index.ts": "1",
        "docs/readme.md": "1",
      });
      const index = new Bun.FileIndex(String(dir));
      await index.ready;
      return {
        index,
        [Symbol.dispose]() {
          index.close();
          dir[Symbol.dispose]();
        },
      };
    }

    test("ranks tighter matches first and reports ascending positions", async () => {
      using fx = await fixture();
      const { index } = fx;
      const results = index.complete("abc");
      expect(results.length).toBeGreaterThanOrEqual(3);
      expect(results[0].path).toBe("abc.ts");
      expect(results.map(r => r.path)).toContain("a-b-c.ts");
      expect(results.map(r => r.path)).toContain("axxbxxc.ts");
      for (const r of results) {
        expect(typeof r.score).toBe("number");
        expect(r.positions).toEqual([...r.positions].sort((a, b) => a - b));
        expect(r.positions.map(p => r.path[p].toLowerCase()).join("")).toBe("abc");
      }
      expect(results[0].score).toBeGreaterThan(results[results.length - 1].score);
    });

    test("no match, empty needle, limit, cwd and directories options", async () => {
      using fx = await fixture();
      const { index } = fx;
      expect(index.complete("zzzzzz")).toEqual([]);
      // An empty needle matches everything (bounded by `limit`).
      expect(index.complete("", { limit: 2 })).toHaveLength(2);
      expect(index.complete("", { limit: 0 })).toEqual([]);
      const inSrc = index.complete("index", { cwd: "src" });
      expect(inSrc.map(r => r.path).sort()).toEqual(["src/index.ts", "src/server/index.ts"]);
      const dirs = index.complete("", { directories: true });
      expect(dirs.map(r => r.path).sort()).toEqual(["docs", "src", "src/server"]);
      expect(() => (index as any).complete(1)).toThrow("expects a string");
    });

    test("touch() boosts a path in complete() and recent() is most-recent-first", async () => {
      using fx = await fixture();
      const { index } = fx;
      expect(index.recent()).toEqual([]);
      index.touch("axxbxxc.ts");
      index.touch("docs/readme.md");
      expect(index.recent()).toEqual(["docs/readme.md", "axxbxxc.ts"]);
      expect(index.recent(1)).toEqual(["docs/readme.md"]);
      // Touching an unknown path is a no-op, not an error.
      index.touch("nope.ts");
      expect(index.recent()).toEqual(["docs/readme.md", "axxbxxc.ts"]);
      // The frecency bonus floats the touched paths to the top of an
      // otherwise-tied (empty needle) ranking.
      expect(
        index
          .complete("")
          .slice(0, 2)
          .map(r => r.path),
      ).toEqual(["docs/readme.md", "axxbxxc.ts"]);
    });
  });

  describe("glob() / has() / stat()", () => {
    test("matches indexed paths with no I/O", async () => {
      using dir = tempDir("file-index-glob", {
        "a.md": "1",
        "src/x.ts": Buffer.alloc(10, "z").toString(),
        "src/deep/y.ts": "1",
        "src/deep/z.css": "1",
      });
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      expect(index.glob("**/*.ts").sort()).toEqual(["src/deep/y.ts", "src/x.ts"]);
      expect(index.glob("*.ts")).toEqual([]);
      expect(index.glob("**/*.ts", { cwd: "src/deep" })).toEqual(["src/deep/y.ts"]);
      expect(index.glob("**/*.ts", { limit: 1 })).toHaveLength(1);
      expect(index.glob("**/*.ts", { limit: 0 })).toEqual([]);
      expect(() => (index as any).glob()).toThrow("expects a string");

      expect(index.has("src/x.ts")).toBe(true);
      expect(index.has("./src/x.ts")).toBe(true);
      expect(index.has("src/x.ts/")).toBe(true);
      expect(index.has("missing.ts")).toBe(false);

      const st = index.stat("src/x.ts")!;
      expect(st.size).toBe(10);
      expect(st.kind).toBe("file");
      expect(st.mtimeMs).toBeGreaterThan(0);
      expect(typeof st.mode).toBe("number");
      expect(index.stat("src")?.kind).toBe("dir");
      expect(index.stat("missing.ts")).toBeNull();
    });
  });

  describe("grep()", () => {
    test("literal search: byte 0, multiple hits per line, CRLF, no trailing newline", async () => {
      using dir = tempDir("file-index-grep", {
        "at0.txt": "needle at byte zero\nplain\n",
        "multi.txt": "a needle, a needle\n",
        "crlf.txt": "first\r\nthe needle line\r\nlast\r\n",
        "notrail.txt": "x\ntrailing needle",
        "none.txt": "nothing here\n",
      });
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      const hits = await collect(index.grep("needle"));
      const byPath = (p: string) => hits.filter(h => h.path === p);
      expect(byPath("at0.txt")).toEqual([{ path: "at0.txt", line: 1, column: 1, lineText: "needle at byte zero" }]);
      expect(byPath("multi.txt")).toEqual([
        { path: "multi.txt", line: 1, column: 3, lineText: "a needle, a needle" },
        { path: "multi.txt", line: 1, column: 13, lineText: "a needle, a needle" },
      ]);
      expect(byPath("crlf.txt")).toEqual([{ path: "crlf.txt", line: 2, column: 5, lineText: "the needle line" }]);
      expect(byPath("notrail.txt")).toEqual([
        { path: "notrail.txt", line: 2, column: 10, lineText: "trailing needle" },
      ]);
      expect(byPath("none.txt")).toEqual([]);
      expect(hits).toHaveLength(5);
    });

    test("binary (NUL) and oversized files are skipped; glob/cwd/limit/case options", async () => {
      using dir = tempDir("file-index-grep-opts", {
        "bin.dat": "needle before \0 a NUL",
        "small.ts": "needle\n",
        "sub/inner.ts": "needle\n",
        "sub/inner.md": "needle\n",
        "upper.txt": "NeEdLe\n",
      });
      // 2 MiB > the 1 MiB default maxFileSize.
      await Bun.write(join(String(dir), "huge.txt"), Buffer.alloc(2 * 1024 * 1024, "needle\n"));
      using index = new Bun.FileIndex(String(dir));
      await index.ready;

      const paths = (hits: { path: string }[]) => hits.map(h => h.path).sort();
      expect(paths(await collect(index.grep("needle")))).toEqual(["small.ts", "sub/inner.md", "sub/inner.ts"]);
      // A larger per-call maxFileSize admits the big file.
      expect(
        paths(await collect(index.grep("needle", { maxFileSize: 4 * 1024 * 1024, glob: "huge.txt", limit: 1 }))),
      ).toEqual(["huge.txt"]);
      expect(paths(await collect(index.grep("needle", { glob: "**/*.ts" })))).toEqual(["small.ts", "sub/inner.ts"]);
      expect(paths(await collect(index.grep("needle", { cwd: "sub" })))).toEqual(["sub/inner.md", "sub/inner.ts"]);
      expect(await collect(index.grep("needle", { limit: 2 }))).toHaveLength(2);
      expect(await collect(index.grep("needle", { limit: 0 }))).toEqual([]);
      expect(paths(await collect(index.grep("nEEdle")))).toEqual([]);
      expect(paths(await collect(index.grep("nEEdle", { caseSensitive: false })))).toEqual([
        "small.ts",
        "sub/inner.md",
        "sub/inner.ts",
        "upper.txt",
      ]);
    });

    test("context lines surround each hit and are clamped to the file", async () => {
      using dir = tempDir("file-index-grep-context", {
        "ctx.txt": "one\ntwo\nthree needle\nfour\nfive\n",
        "edge.txt": "needle\nafter\n",
      });
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      const hits = await collect(index.grep("needle", { context: 2 }));
      expect(hits).toEqual([
        {
          path: "ctx.txt",
          line: 3,
          column: 7,
          lineText: "three needle",
          before: ["one", "two"],
          after: ["four", "five"],
        },
        { path: "edge.txt", line: 1, column: 1, lineText: "needle", before: [], after: ["after"] },
      ]);
      // Without `context` the keys are absent entirely.
      const plain = await collect(index.grep("needle", { glob: "edge.txt" }));
      expect(Object.keys(plain[0]).sort()).toEqual(["column", "line", "lineText", "path"]);
    });

    test("argument validation", async () => {
      using dir = tempDir("file-index-grep-args", { "a.txt": "x" });
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      expect(() => index.grep(/needle/)).toThrow("RegExp patterns are not implemented yet");
      expect(() => (index as any).grep(1)).toThrow("expects a string");
      expect(() => index.grep("")).toThrow("must not be empty");
      expect(() => (index as any).grep("x", { limit: -1 })).toThrow("must not be negative");
    });
  });

  describe("memory budget", () => {
    test("a tiny maxMemory truncates instead of crashing or exceeding the cap", async () => {
      const files: Record<string, string> = {};
      for (let i = 0; i < 200; i++) files[`dir${i % 10}/file-${i}.txt`] = "x";
      using dir = tempDir("file-index-budget", files);
      const maxMemory = 2048;
      using index = new Bun.FileIndex(String(dir), { maxMemory });
      await index.ready;
      expect(index.truncated).toBe(true);
      expect(index.memoryUsage).toBeLessThanOrEqual(maxMemory);
      expect(index.size).toBeLessThan(210);
      // Whatever fit is still fully queryable.
      expect(index.glob("**/*").length).toBe(index.size);

      using big = new Bun.FileIndex(String(dir));
      await big.ready;
      expect(big.truncated).toBe(false);
      expect(big.size).toBe(210);
      expect(big.memoryUsage).toBeGreaterThan(index.memoryUsage);
    });
  });

  describe("refresh()", () => {
    test("re-crawls and picks up created and deleted entries", async () => {
      using dir = tempDir("file-index-refresh", { "a.txt": "1", "b.txt": "1" });
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      expect(indexed(index)).toEqual(["a.txt", "b.txt"]);
      fs.writeFileSync(join(String(dir), "c.txt"), "1");
      fs.rmSync(join(String(dir), "a.txt"));
      expect(await index.refresh()).toBe(index);
      expect(indexed(index)).toEqual(["b.txt", "c.txt"]);
    });
  });

  describe("close() and Symbol.dispose", () => {
    test("close is idempotent, releases memory, and later calls throw", async () => {
      using dir = tempDir("file-index-close", { "a.txt": "needle" });
      const index = new Bun.FileIndex(String(dir));
      await index.ready;
      expect(index.memoryUsage).toBeGreaterThan(0);
      index.close();
      index.close();
      expect(index.size).toBe(0);
      expect(index.memoryUsage).toBe(0);
      expect(index.watching).toBe(false);
      const closed = /FileIndex is closed/;
      expect(() => index.glob("**/*")).toThrow(closed);
      expect(() => index.complete("a")).toThrow(closed);
      expect(() => index.has("a.txt")).toThrow(closed);
      expect(() => index.stat("a.txt")).toThrow(closed);
      expect(() => index.touch("a.txt")).toThrow(closed);
      expect(() => index.recent()).toThrow(closed);
      expect(() => index.refresh()).toThrow(closed);
      expect(() => index.grep("needle")).toThrow(closed);
      expect(await index.ready).toBe(index);
    });

    test("in-flight promises still settle after close()", async () => {
      using dir = tempDir("file-index-close-inflight", { "a.txt": "needle\n" });
      {
        // Closed before the initial crawl completes: `ready` still resolves.
        const index = new Bun.FileIndex(String(dir));
        index.close();
        expect(await index.ready).toBe(index);
        expect(index.size).toBe(0);
      }
      {
        const index = new Bun.FileIndex(String(dir));
        await index.ready;
        const refresh = index.refresh();
        const hits = collect(index.grep("needle"));
        index.close();
        expect(await refresh).toBe(index);
        expect(await hits).toHaveLength(1);
      }
    });

    test("`using` disposes the index", async () => {
      using dir = tempDir("file-index-dispose", { "a.txt": "1" });
      let captured!: InstanceType<typeof Bun.FileIndex>;
      {
        using index = new Bun.FileIndex(String(dir));
        captured = index;
        await index.ready;
        expect(index.size).toBe(1);
      }
      expect(() => captured.glob("**/*")).toThrow("FileIndex is closed");
    });
  });

  describe("GC", () => {
    // Creating in a separate function keeps the indexes out of the test
    // frame's conservative roots.
    async function createMany(path: string, count: number): Promise<number> {
      const all: InstanceType<typeof Bun.FileIndex>[] = [];
      for (let i = 0; i < count; i++) all.push(new Bun.FileIndex(path));
      await Promise.all(all.map(x => x.ready));
      for (const x of all) expect(x.size).toBe(3);
      const during = heapStats().objectTypeCounts.FileIndex ?? 0;
      all.length = 0;
      return during;
    }

    test("unreferenced indexes are collected once idle", async () => {
      using dir = tempDir("file-index-gc", { "a.txt": "1", "b/c.txt": "2" });
      const during = await createMany(String(dir), 64);
      expect(during).toBeGreaterThanOrEqual(64);
      let after = during;
      for (let i = 0; i < 20 && after >= during; i++) {
        Bun.gc(true);
        await Bun.sleep(10);
        after = heapStats().objectTypeCounts.FileIndex ?? 0;
      }
      expect(after).toBeLessThan(during);
    });
  });
});
