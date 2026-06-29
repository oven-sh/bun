import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import * as fs from "node:fs";
import { join } from "node:path";

// Every indexed entry (files, directories, symlinks), `/`-separated and
// relative to `root`. `glob()` defaults to `onlyFiles: true` like `Bun.Glob`.
function indexed(index: InstanceType<typeof Bun.FileIndex>): string[] {
  return index.glob("**/*", { onlyFiles: false }).sort();
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
      expect(index.errors).toBe(0);
      expect(index.watching).toBe(false);
      expect(index.onchange).toBeNull();
      expect(index.root).toBe(String(dir));
    });

    test("a missing root does not throw; ready rejects with the syscall error", async () => {
      using dir = tempDir("file-index-missing", {});
      using index = new Bun.FileIndex(join(String(dir), "does-not-exist"));
      await expect(index.ready).rejects.toMatchObject({ code: "ENOENT" });
    });

    test("an existing empty root resolves; a root deleted after construction rejects", async () => {
      using dir = tempDir("file-index-vanish", {});
      const empty = join(String(dir), "empty");
      fs.mkdirSync(empty);
      {
        using index = new Bun.FileIndex(empty);
        expect(await index.ready).toBe(index);
        expect(index.size).toBe(0);
      }
      // The constructor's probe succeeds, then the root vanishes before the
      // crawl completes: `ready` must reject with the syscall error rather
      // than resolving an empty index.
      using index = new Bun.FileIndex(empty);
      fs.rmdirSync(empty);
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

    test("range violations are RangeErrors with code ERR_OUT_OF_RANGE", async () => {
      using dir = tempDir("file-index-range", { "a.txt": "1" });
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      // Every message names the API the user actually called.
      const cases: Array<[() => unknown, string]> = [
        [() => new Bun.FileIndex(".", { maxMemory: -1 }).close(), "new Bun.FileIndex: maxMemory"],
        [() => new Bun.FileIndex(".", { maxFileSize: 0 }).close(), "new Bun.FileIndex: maxFileSize"],
        [() => index.complete("a", { limit: -1 }), "FileIndex.complete: limit"],
        [() => index.glob("**/*", { limit: -1 }), "FileIndex.glob: limit"],
        [() => index.recent(-1), "FileIndex.recent: limit"],
        [() => index.grep("a", { limit: -1 }), "FileIndex.grep: limit"],
        [() => index.grep(/a/, { limit: -1 }), "FileIndex.grep: limit"],
        [() => index.grep("a", { context: -1 }), "FileIndex.grep: context"],
        [() => index.grep("a", { maxFileSize: -1 }), "FileIndex.grep: maxFileSize"],
      ];
      for (const [call, prefix] of cases) {
        let err: any;
        try {
          call();
        } catch (e) {
          err = e;
        }
        expect(err, prefix).toBeInstanceOf(RangeError);
        expect(err.code, prefix).toBe("ERR_OUT_OF_RANGE");
        expect(err.message, prefix).toStartWith(prefix);
      }
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
        // `info/exclude` is resolved through repository discovery (the same
        // `gitdir:`/`commondir`-aware walk gitStatus uses), which — like
        // git itself — requires `.git/HEAD` to consider `.git` a git dir.
        ".git/HEAD": "ref: refs/heads/main\n",
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
      // DOCUMENTED LIMITATION (pinned so a future fix is deliberate): the
      // index stores the raw bytes, but JS only sees a lossy U+FFFD string,
      // which does not round-trip back into `has()` / `stat()`.
      const lossy = index.glob("**/*").find(p => p.includes("�"))!;
      expect(lossy).toBe("f��.bin");
      expect(index.has(lossy)).toBe(false);
      expect(index.stat(lossy)).toBeNull();
      expect(index.has("plain.txt")).toBe(true);
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
      // `cwd` is Bun.Glob's: candidates restricted to it, the query matched
      // against — and paths returned relative to — the cwd-relative path.
      const inSrc = index.complete("index", { cwd: "src" });
      expect(inSrc.map(r => r.path).sort()).toEqual(["index.ts", "server/index.ts"]);
      // The query never matches inside the `cwd` prefix itself.
      expect(index.complete("src", { cwd: "src" })).toEqual([]);
      // `positions` index the returned (cwd-relative) string.
      for (const r of index.complete("index", { cwd: "src" })) {
        expect(r.positions.map(p => r.path[p]).join("")).toBe("index");
      }
      // A cwd that is not an indexed directory matches nothing.
      expect(index.complete("index", { cwd: "nope" })).toEqual([]);
      expect(index.complete("readme", { cwd: "docs/readme.md" })).toEqual([]);
      const dirs = index.complete("", { directories: true });
      expect(dirs.map(r => r.path).sort()).toEqual(["docs", "src", "src/server"]);
      expect(() => (index as any).complete(1)).toThrow("expects a string");
    });

    // The crawl stores raw path BYTES; `path` reaches JS decoded with the
    // WHATWG replacement (a lone invalid byte becomes ONE U+FFFD), and
    // `positions` must index that JS string, not the byte string.
    test.skipIf(!isLinux)("positions index the JS string for a path with invalid UTF-8 bytes", async () => {
      using dir = tempDir("file-index-complete-invalid-utf8", {});
      // "f\xE9ab.txt": a lone 0xE9 lead byte (only Linux allows non-UTF-8
      // filename bytes). The JS path string is "f�ab.txt".
      const name = Buffer.concat([Buffer.from(`${dir}/`, "utf8"), Buffer.from([0x66, 0xe9]), Buffer.from("ab.txt")]);
      fs.writeFileSync(name, "x");
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      const results = index.complete("ab");
      expect(results.map(r => ({ path: r.path, positions: r.positions }))).toEqual([
        { path: "f�ab.txt", positions: [2, 3] },
      ]);
      expect(results[0].positions.map(p => results[0].path[p]).join("")).toBe("ab");
    });

    // The per-keystroke narrowing cache must be semantically invisible: an
    // incrementally-typed sequence (each query extending the last, which is
    // exactly what the cache accelerates) returns the same results as a cold
    // call on a fresh index, including after a mutation between keystrokes.
    test("incremental typing matches cold calls, including across a refresh()", async () => {
      const files: Record<string, string> = {};
      for (let i = 0; i < 400; i++) files[`pkg${i % 7}/src/module_${i}.ts`] = "x";
      files["src/server/index.ts"] = "x";
      files["src/server/inspector.ts"] = "x";
      using dir = tempDir("file-index-complete-cache", files);
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      const shape = (r: { path: string; score: number; positions: number[] }) =>
        `${r.path}:${r.score}:${r.positions.join(",")}`;
      async function cold(q: string, opts?: Parameters<typeof index.complete>[1]) {
        using fresh = new Bun.FileIndex(String(dir));
        await fresh.ready;
        return fresh.complete(q, opts).map(shape);
      }
      // Typed incrementally on one index (the cache narrows each step).
      for (const q of ["s", "sr", "srv", "srvi"]) {
        expect(index.complete(q).map(shape), q).toEqual(await cold(q));
      }
      // A mutation between keystrokes: "sr" primed the cache, the tree then
      // changed (refresh), and "srn" extends "sr" — a stale survivor set
      // captured before the refresh could not contain the new file.
      fs.writeFileSync(join(String(dir), "src/server/srnew.ts"), "x");
      expect(index.complete("sr").length).toBeGreaterThan(0);
      await index.refresh();
      expect(index.complete("srn").map(r => r.path)).toContain("src/server/srnew.ts");
      expect(index.complete("srn").map(shape)).toEqual(await cold("srn"));
      // And narrowing under a cwd stays equivalent too.
      for (const q of ["i", "in", "ind", "index"]) {
        expect(index.complete(q, { cwd: "src/server" }).map(shape), q).toEqual(await cold(q, { cwd: "src/server" }));
      }
    });

    // Above ~12k candidates a cold complete() is scored in parallel on the
    // work pool (PARALLEL_MIN_CANDIDATES in src/file_index/parallel.rs);
    // results must be bit-identical to the sequential paths. The oracle: the
    // identical query repeated back to back answers from the survivor cache
    // — a single-threaded re-rank of the parallel pass's survivor set — and
    // a second cold (parallel) pass must reproduce itself exactly.
    test("a parallel cold query equals its sequential cached re-rank and repeats exactly", async () => {
      // The fixture must exceed the native parallel threshold (8,192
      // candidates), so it cannot be made small; the per-test timeout
      // covers writing it out and crawling it on slow debug/ASAN runners.
      const files: Record<string, string> = {};
      for (let i = 0; i < 9_000; i++) files[`pkg${i % 40}/dir${i % 6}/main_${i}.ts`] = "";
      using dir = tempDir("file-index-complete-parallel", files);
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      // 9,000 files + the pkg/dir directories: past the parallel
      // threshold, so the full-range needles below fan out.
      expect(index.size).toBeGreaterThan(9_000);
      const shape = (r: { path: string; score: number; positions: number[] }) =>
        `${r.path}:${r.score}:${r.positions.join(",")}`;
      for (const needle of ["m", "main1"]) {
        // Bust the per-keystroke survivor cache: "@" matches nothing and
        // `needle` does not extend it, so the next call is a full cold pass.
        expect(index.complete("@")).toEqual([]);
        const cold = index.complete(needle, { limit: 32 }).map(shape);
        const cached = index.complete(needle, { limit: 32 }).map(shape);
        expect(cached, needle).toEqual(cold);
        expect(index.complete("~")).toEqual([]);
        expect(index.complete(needle, { limit: 32 }).map(shape), needle).toEqual(cold);
      }
      // A cwd-narrowed query (few candidates: always sequential) finds
      // exactly the cwd-relative paths the needle is a subsequence of —
      // the full-index parallel passes above and this never disagree on
      // membership.
      const isSubsequence = (needle: string, hay: string) => {
        let i = 0;
        for (const c of hay.toLowerCase()) if (c === needle[i]) i++;
        return i === needle.length;
      };
      const scoped = index
        .complete("main1", { cwd: "pkg7", limit: 1 << 20 })
        .map(r => r.path)
        .sort();
      const expected = index
        .glob("**/*", { cwd: "pkg7" })
        .filter(p => isSubsequence("main1", p))
        .sort();
      expect(scoped.length).toBeGreaterThan(0);
      expect(scoped).toEqual(expected);
    }, 20_000);

    test("positions index the JS string, not its UTF-8 bytes", async () => {
      using dir = tempDir("file-index-complete-utf16", {
        // "é" is 2 UTF-8 bytes / 1 UTF-16 code unit; "𝛅" (U+1D6C5) is
        // 4 UTF-8 bytes / a 2-code-unit surrogate pair. Byte offsets would
        // index past or inside the wrong characters here.
        "café.ts": "1",
        "𝛅elta/naïve.ts": "1",
        "plain.ts": "1",
      });
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      const all = [...index.complete("ts"), ...index.complete("naïve"), ...index.complete("café")];
      expect(all.length).toBeGreaterThanOrEqual(5);
      for (const r of all) {
        expect(r.positions).toEqual([...r.positions].sort((a, b) => a - b));
        for (const p of r.positions) expect(p).toBeLessThan(r.path.length);
      }
      const byChars = (q: string) => index.complete(q).map(r => [...r.positions].map(p => r.path[p]).join(""));
      // Every position resolves to exactly the matched character.
      for (const got of byChars("ts")) expect(got.toLowerCase()).toBe("ts");
      expect(byChars("café")).toEqual(["café"]);
      expect(byChars("naïve")).toEqual(["naïve"]);
      // The astral scalar costs 2 code units: "ts" in "𝛅elta/naïve.ts".
      const astral = index.complete("ts").find(r => r.path === "𝛅elta/naïve.ts")!;
      expect(astral.positions.map(p => astral.path.codePointAt(p))).toEqual([0x74, 0x73]);
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

  describe("progressive initial crawl", () => {
    // Design requirement 1: the initial crawl streams partial batches into
    // the store as directories complete, so `size` / `glob()` / `complete()`
    // work on partial data DURING the first index. `ready` means
    // "complete", not "usable".
    test("size grows and queries answer on partial data before ready", async () => {
      // The shape matters: `wide/` alone overflows the crawl's batch target
      // (4096), so its entries are delivered (and applied) while the rest of
      // the crawl is still enumerating the `chainN/d/d/…` directory chains,
      // whose tasks are serialized parent → child, which the event loop's
      // batch application cannot outrun. The chains are 220 deep, not one
      // 1300-deep path: the deepest ABSOLUTE path must stay well inside
      // macOS's PATH_MAX (1024 bytes) or the fixture cannot even be created.
      const files: Record<string, string> = {};
      // 90 directories of 50 files: enough entries for the crawl to flush
      // its first ≥4096-entry batch long before it completes, from many
      // small parallel tasks that finish early.
      const wideDirs = 90;
      const perDir = 50;
      for (let d = 0; d < wideDirs; d++) {
        for (let f = 0; f < perDir; f++) files[`wide${d}/f${f}.txt`] = "x";
      }
      // One 300-deep chain whose every level also holds a 16 KiB
      // `.gitignore` the walker must open and parse: a serialized tail the
      // event loop's batch application cannot fail to outrun.
      const depth = 300;
      let chain = "chain";
      for (let level = 0; level <= depth; level++) {
        files[`${chain}/.gitignore`] = Buffer.alloc(16 * 1024, "# nothing is ignored here\n").toString();
        if (level < depth) chain += "/d";
      }
      files[`${chain}/leaf.txt`] = "x";
      const total = wideDirs * perDir + wideDirs + (depth + 1) * 2 + 1;
      const txtFiles = wideDirs * perDir + 1;
      const deepest = Object.keys(files).reduce((a, b) => (b.length > a.length ? b : a));
      // tempDir prefixes are well under ~200 bytes on every CI platform.
      expect(deepest.length).toBeLessThan(700);
      using dir = tempDir("file-index-progressive", files);
      using index = new Bun.FileIndex(String(dir));
      expect(index.size).toBe(0);
      let settled = false;
      const ready = index.ready.finally(() => (settled = true));
      // Sample between event-loop turns; capture the first non-empty state.
      let during: { size: number; glob: string[]; complete: string[] } | null = null;
      while (!settled) {
        const size = index.size;
        if (size > 0 && during === null) {
          during = {
            size,
            glob: index.glob("**/*.txt"),
            complete: index.complete("txt", { limit: 1 << 30 }).map(m => m.path),
          };
        }
        // `setImmediate`, not a timer: one event-loop turn per sample, so
        // the window between "first batch applied" and "crawl complete" is
        // sampled as finely as the loop can turn.
        await new Promise(resolve => setImmediate(resolve));
      }
      await ready;
      const finalSize = index.size;
      expect(finalSize).toBe(total);
      // At least one batch was applied (and observable) before the crawl
      // completed, and everything it answered is a strict subset of the
      // final answer.
      expect(during).not.toBeNull();
      expect(during!.size).toBeGreaterThan(0);
      expect(during!.size).toBeLessThan(finalSize);
      const finalGlob = new Set(index.glob("**/*.txt"));
      expect(during!.glob.length).toBeGreaterThan(0);
      expect(during!.glob.length).toBeLessThan(finalGlob.size);
      expect(during!.glob.every(p => finalGlob.has(p))).toBe(true);
      const finalComplete = new Set(index.complete("txt", { limit: 1 << 30 }).map(m => m.path));
      expect(finalComplete.size).toBe(txtFiles);
      expect(during!.complete.length).toBeGreaterThan(0);
      expect(during!.complete.length).toBeLessThan(finalComplete.size);
      expect(during!.complete.every(p => finalComplete.has(p))).toBe(true);
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
      // `cwd` rebases the pattern AND the returned paths (Bun.Glob semantics).
      expect(index.glob("**/*.ts", { cwd: "src/deep" })).toEqual(["y.ts"]);
      expect(index.glob("*.ts", { cwd: "src" })).toEqual(["x.ts"]);
      expect(index.glob("deep/*", { cwd: "src" }).sort()).toEqual(["deep/y.ts", "deep/z.css"]);
      // A cwd that is not an indexed directory matches nothing.
      expect(index.glob("**/*", { cwd: "nope" })).toEqual([]);
      expect(index.glob("**/*", { cwd: "a.md" })).toEqual([]);
      // Files only by default (Bun.Glob's `onlyFiles`); `false` adds dirs.
      expect(index.glob("**/*").sort()).toEqual(["a.md", "src/deep/y.ts", "src/deep/z.css", "src/x.ts"]);
      expect(index.glob("**/*", { onlyFiles: false }).sort()).toEqual([
        "a.md",
        "src",
        "src/deep",
        "src/deep/y.ts",
        "src/deep/z.css",
        "src/x.ts",
      ]);
      expect(index.glob("**/*", { cwd: "src", onlyFiles: false }).sort()).toEqual([
        "deep",
        "deep/y.ts",
        "deep/z.css",
        "x.ts",
      ]);
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

    // The contract for `cwd` and `onlyFiles` is "exactly what Bun.Glob
    // means by them": same pattern, same cwd, same result set (over a tree
    // with nothing for gitignore to drop, the one thing FileIndex filters
    // that Bun.Glob does not).
    test("glob(pattern, { cwd }) === new Bun.Glob(pattern).scanSync({ cwd })", async () => {
      using dir = tempDir("file-index-glob-equiv", {
        "README.md": "1",
        "a.ts": "1",
        "src/index.ts": "1",
        "src/util.ts": "1",
        "src/deep/index.ts": "1",
        "src/deep/er/leaf.css": "1",
        "lib/main.rs": "1",
        "lib/sub/mod.rs": "1",
      });
      const root = String(dir);
      using index = new Bun.FileIndex(root);
      await index.ready;
      const patterns = ["**/*", "*", "*.ts", "**/*.ts", "*/*.ts", "**/index.*", "deep/**/*", "nope/**"];
      const cwds = [undefined, "src", "src/deep", "lib", "src/deep/er"];
      for (const cwd of cwds) {
        for (const pattern of patterns) {
          const abs = cwd === undefined ? root : join(root, cwd);
          const fromGlob = new Set(new Bun.Glob(pattern).scanSync({ cwd: abs }));
          const fromIndex = new Set(index.glob(pattern, { cwd, onlyFiles: true }));
          expect(fromIndex, `${pattern} in ${cwd ?? "<root>"}`).toEqual(fromGlob);
          // `onlyFiles: true` is the default.
          expect(new Set(index.glob(pattern, { cwd })), `${pattern} in ${cwd ?? "<root>"}`).toEqual(fromGlob);
        }
      }
      // `onlyFiles: false` includes directories, exactly like Bun.Glob's.
      for (const cwd of [undefined, "src"]) {
        const abs = cwd === undefined ? root : join(root, cwd);
        expect(new Set(index.glob("**/*", { cwd, onlyFiles: false }))).toEqual(
          new Set(new Bun.Glob("**/*").scanSync({ cwd: abs, onlyFiles: false })),
        );
      }
      // The fixture is not vacuous: every cwd yields something for "**/*".
      for (const cwd of cwds) expect(index.glob("**/*", { cwd }).length).toBeGreaterThan(0);
    });

    // Design requirement 5: the crawl is enumeration-only (the dirent gives
    // the kind, nothing else), so an entry's stat is filled by ONE lstat the
    // first time it is asked for and cached from then on.
    test("stat() is lazy: filled at first ask, then cached", async () => {
      using dir = tempDir("file-index-lazy-stat", {
        "a.txt": "1234",
        "gone.txt": "x",
        "src/b.txt": "y",
      });
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      // Grown AFTER `ready` and BEFORE the first stat(): the answer is the
      // file's current size, because the crawl recorded none to go stale.
      fs.writeFileSync(join(String(dir), "a.txt"), "123456789");
      expect(index.stat("a.txt")).toMatchObject({ size: 9, kind: "file" });
      // The first answer is cached; without a watcher nothing invalidates
      // it (requirement 4: the watcher, not re-statting, keeps it true).
      fs.writeFileSync(join(String(dir), "a.txt"), "12");
      expect(index.stat("a.txt")).toMatchObject({ size: 9 });
      // An indexed entry that vanished before its first stat() has nothing
      // truthful to report; the entry itself is the watcher's to remove.
      fs.rmSync(join(String(dir), "gone.txt"));
      expect(index.has("gone.txt")).toBe(true);
      expect(index.stat("gone.txt")).toBeNull();
      expect(index.stat("gone.txt")).toBeNull();
      // The kind needs no stat at all.
      expect(index.stat("src")).toMatchObject({ kind: "dir" });
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

    // `column` is in UTF-16 code units of `lineText` (the JS string), whose
    // decoder replaces an invalid UTF-8 sequence with ONE U+FFFD. A lone
    // 0xE9 lead byte before the match must therefore shift the column by
    // exactly one unit, never swallow the bytes after it.
    test("column counts an invalid UTF-8 byte before the match as one unit", async () => {
      using dir = tempDir("file-index-grep-invalid-utf8", {});
      // Line bytes: x \xE9 a b NEEDLE rest -> JS "x�abNEEDLE rest".
      fs.writeFileSync(
        join(String(dir), "inv.txt"),
        Buffer.concat([Buffer.from([0x78, 0xe9, 0x61, 0x62]), Buffer.from("NEEDLE rest\n")]),
      );
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      const hits = await collect(index.grep("NEEDLE"));
      expect(hits).toEqual([{ path: "inv.txt", line: 1, column: 5, lineText: "x�abNEEDLE rest" }]);
      expect(hits[0].lineText[hits[0].column - 1]).toBe("N");
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
      // `cwd` is Bun.Glob's: hit paths (and the `glob` option) are relative
      // to it, for the literal and the RegExp engine alike.
      for (const pattern of ["needle", /needle/] as const) {
        expect(paths(await collect(index.grep(pattern as string, { cwd: "sub" })))).toEqual(["inner.md", "inner.ts"]);
        expect(paths(await collect(index.grep(pattern as string, { cwd: "sub", glob: "*.ts" })))).toEqual(["inner.ts"]);
        // A cwd that is not an indexed directory matches nothing.
        expect(await collect(index.grep(pattern as string, { cwd: "nope" }))).toEqual([]);
      }
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

    // FileIndexOptions.maxFileSize is grep's default cap; the per-call
    // option overrides it (in both directions) on the literal AND the
    // RegExp engine, and is enforced from the OPEN file's size (the
    // enumeration-only crawl records none).
    test("the constructor's maxFileSize is grep's default cap; per-call overrides it", async () => {
      using dir = tempDir("file-index-grep-maxfilesize", {
        "small.txt": "needle\n",
        "big.txt": Buffer.alloc(8 * 1024, "needle\n").toString(),
      });
      using index = new Bun.FileIndex(String(dir), { maxFileSize: 1024 });
      await index.ready;
      const paths = (hits: { path: string }[]) => new Set(hits.map(h => h.path));
      for (const pattern of ["needle", /needle/] as const) {
        const label = String(pattern);
        // big.txt (8 KiB) is over the constructor's 1 KiB cap.
        expect(paths(await collect(index.grep(pattern as string))), label).toEqual(new Set(["small.txt"]));
        // The per-call option overrides the constructor's, both ways.
        expect(paths(await collect(index.grep(pattern as string, { maxFileSize: 64 * 1024 }))), label).toEqual(
          new Set(["big.txt", "small.txt"]),
        );
        expect(await collect(index.grep(pattern as string, { maxFileSize: 4 })), label).toEqual([]);
      }
      // Without the constructor option, the 1 MiB default admits both.
      using plain = new Bun.FileIndex(String(dir));
      await plain.ready;
      expect(paths(await collect(plain.grep("needle")))).toEqual(new Set(["big.txt", "small.txt"]));
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

    // `column` is 1-based UTF-16 code units into `lineText` (the unit JS
    // string indices use) for BOTH pattern kinds; the leaf grep speaks byte
    // offsets and the runtime converts. Byte offsets would be 12 (bmp.txt:
    // `ï` is 2 UTF-8 bytes, `—` is 3) and 10 (astral.txt: each `𝛅` is 4).
    test("column is 1-based UTF-16 code units into lineText (non-ASCII and astral planes)", async () => {
      using dir = tempDir("file-index-grep-utf16", {
        "ascii.txt": "a needle\n",
        "bmp.txt": "naïve — needle\n",
        "astral.txt": "𝛅𝛅 needle\n",
      });
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      for (const pattern of ["needle", /needle/] as const) {
        const hits = await collect(index.grep(pattern as string));
        expect(hits).toHaveLength(3);
        for (const hit of hits) {
          // The load-bearing contract: `lineText` indexed at `column - 1`
          // is where the match starts.
          expect(hit.column, `${hit.path} ${String(pattern)}`).toBe(hit.lineText.indexOf("needle") + 1);
        }
        const byPath = Object.fromEntries(hits.map(h => [h.path, h.column]));
        expect(byPath).toEqual({ "ascii.txt": 3, "bmp.txt": 9, "astral.txt": 6 });
      }
    });

    // The candidate set fans out as concurrent thread-pool chunks (32
    // candidates per chunk); the result must still be every hit, ordered by
    // (path, line, column), with `limit` returning exactly the first N.
    test("a many-file grep is chunked across the pool and stays ordered and exact", async () => {
      const files: Record<string, string> = {};
      for (let i = 0; i < 130; i++) {
        files[`d${i % 7}/f${String(i).padStart(3, "0")}.txt`] = "alpha\nneedle one needle\nomega needle\n";
      }
      files["nohit.txt"] = "nothing\n";
      using dir = tempDir("file-index-grep-chunks", files);
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      const paths = index
        .glob("**/*.txt")
        .sort()
        .filter(p => p !== "nohit.txt");
      expect(paths).toHaveLength(130);
      const hits = await collect(index.grep("needle"));
      expect(hits.map(h => `${h.path}:${h.line}:${h.column}`)).toEqual(
        paths.flatMap(p => [`${p}:2:1`, `${p}:2:12`, `${p}:3:7`]),
      );
      // `limit` is exact and is the FIRST n in that order, on both paths.
      const limited = await collect(index.grep("needle", { limit: 5 }));
      expect(limited).toEqual(hits.slice(0, 5));
      expect(await collect(index.grep(/needle/, { limit: 5 }))).toEqual(limited);
    });

    test("argument validation", async () => {
      using dir = tempDir("file-index-grep-args", { "a.txt": "x" });
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      expect(() => (index as any).grep(1)).toThrow("expects a string or a RegExp");
      expect(() => (index as any).grep(null)).toThrow("expects a string or a RegExp");
      expect(() => index.grep("")).toThrow("must not be empty");
      expect(() => (index as any).grep("x", { limit: -1 })).toThrow("must not be negative");
    });
  });

  describe("grep(RegExp)", () => {
    async function fixture() {
      const dir = tempDir("file-index-grep-regexp", {
        "a.ts": "alpha BETA\nfn foo_bar(x)\nfn fizz_buzz(y)\nBETA\n",
        "b.ts": "beta\nBETA beta BeTa\n",
        "sub/c.md": "anchor\nnot an anchor here\n",
        "bin.dat": "match\0me",
        "ctx.txt": "one\ntwo\nthree match\nfour\nfive\n",
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

    test("groups, alternation, anchors, flags, multiple matches per line", async () => {
      using fx = await fixture();
      const { index } = fx;
      // Groups + alternation.
      expect(await collect(index.grep(/fn (foo|fizz)_(bar|buzz)/))).toEqual([
        { path: "a.ts", line: 2, column: 1, lineText: "fn foo_bar(x)" },
        { path: "a.ts", line: 3, column: 1, lineText: "fn fizz_buzz(y)" },
      ]);
      // `^` anchors to the start of each line, not the start of the file.
      expect(await collect(index.grep(/^anchor/))).toEqual([
        { path: "sub/c.md", line: 1, column: 1, lineText: "anchor" },
      ]);
      // Case-sensitivity comes from the regex's own flags.
      expect((await collect(index.grep(/^beta$/))).map(h => `${h.path}:${h.line}`)).toEqual(["b.ts:1"]);
      expect((await collect(index.grep(/^beta$/i))).map(h => `${h.path}:${h.line}`)).toEqual(["a.ts:4", "b.ts:1"]);
      // Multiple matches per line, in ascending column order.
      expect(await collect(index.grep(/beta/i, { glob: "b.ts" }))).toEqual([
        { path: "b.ts", line: 1, column: 1, lineText: "beta" },
        { path: "b.ts", line: 2, column: 1, lineText: "BETA beta BeTa" },
        { path: "b.ts", line: 2, column: 6, lineText: "BETA beta BeTa" },
        { path: "b.ts", line: 2, column: 11, lineText: "BETA beta BeTa" },
      ]);
    });

    test("limit, context, and binary skipping match the literal path's semantics", async () => {
      using fx = await fixture();
      const { index } = fx;
      expect(await collect(index.grep(/beta/i))).toHaveLength(6);
      expect(await collect(index.grep(/beta/i, { limit: 2 }))).toHaveLength(2);
      expect(await collect(index.grep(/beta/i, { limit: 0 }))).toEqual([]);
      // `a.ts` line 4 is the file's last line: `after` is clamped, and the
      // empty slot after the trailing newline is not a line.
      expect(await collect(index.grep(/^BETA$/, { context: 2, glob: "a.ts" }))).toEqual([
        {
          path: "a.ts",
          line: 4,
          column: 1,
          lineText: "BETA",
          before: ["fn foo_bar(x)", "fn fizz_buzz(y)"],
          after: [],
        },
      ]);
      expect(await collect(index.grep(/three match/, { context: 2 }))).toEqual([
        {
          path: "ctx.txt",
          line: 3,
          column: 1,
          lineText: "three match",
          before: ["one", "two"],
          after: ["four", "five"],
        },
      ]);
      // Without `context` the keys are absent entirely (literal parity).
      const plain = await collect(index.grep(/three match/));
      expect(Object.keys(plain[0]).sort()).toEqual(["column", "line", "lineText", "path"]);
      // A NUL in the first 8 KiB classifies the file as binary.
      expect(await collect(index.grep(/match me/))).toEqual([]);
      expect(await collect(index.grep(/match/, { glob: "bin.dat" }))).toEqual([]);
    });

    test("literal-vs-RegExp parity on the same tree", async () => {
      using dir = tempDir("file-index-grep-parity", {
        "at0.txt": "needle at byte zero\nplain\n",
        "multi.txt": "a needle, a needle\n",
        "crlf.txt": "first\r\nthe needle line\r\nlast\r\n",
        "notrail.txt": "x\ntrailing needle",
        "none.txt": "nothing here\n",
        "bin.dat": "needle before \0 a NUL",
        "sub/deep.ts": "the needle again\n",
      });
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      // `maxFileSize: 24` splits this tree: both paths must enforce it from
      // the file's size at open time (the index has no crawl-time sizes).
      const options: Parameters<typeof index.grep>[1][] = [
        undefined,
        { context: 1 },
        { limit: 2 },
        { cwd: "sub" },
        { glob: "**/*.txt" },
        { maxFileSize: 24 },
      ];
      for (const opts of options) {
        const literal = await collect(index.grep("needle", opts));
        const regexp = await collect(index.grep(/needle/, opts));
        expect(regexp, JSON.stringify(opts)).toEqual(literal);
        expect(literal.length).toBeGreaterThan(0);
      }
      // "a needle, a needle" is two hits in multi.txt.
      const cappedPaths = (await collect(index.grep("needle", { maxFileSize: 24 }))).map(h => h.path).sort();
      expect(cappedPaths).toEqual(["multi.txt", "multi.txt", "notrail.txt", "sub/deep.ts"]);
    });

    test("a fresh global copy is used: lastIndex is neither read nor written", async () => {
      using fx = await fixture();
      const { index } = fx;
      const re = /beta/gi;
      re.lastIndex = 9999;
      expect(await collect(index.grep(re))).toHaveLength(6);
      expect(re.lastIndex).toBe(9999);
      // A sticky regex is not allowed to pin matches to lastIndex.
      const sticky = /beta/iy;
      sticky.lastIndex = 3;
      expect(await collect(index.grep(sticky))).toHaveLength(6);
    });

    // `limit` and `context` are validated (and truncated) ONCE by the native
    // option parser; the RegExp shim consumes those validated values and
    // never re-reads the user's options object.
    test("non-integer limit/context behave identically on the literal and RegExp engines", async () => {
      using dir = tempDir("file-index-grep-validated-options", {
        "ctx.txt": "one\ntwo\nthree match\nfour\nfive\n",
        "more.txt": "match a\nmatch b\nmatch c\n",
      });
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      const opts = [{ limit: 1.5 }, { context: 2.5, glob: "ctx.txt" }, { limit: 2.5, context: 1.5 }] as const;
      for (const o of opts) {
        const literal = await collect(index.grep("match", o));
        const regexp = await collect(index.grep(/match/, o));
        expect(regexp, JSON.stringify(o)).toEqual(literal);
        expect(literal.length, JSON.stringify(o)).toBeGreaterThan(0);
      }
      // Truncation, not rounding, on both engines.
      expect(await collect(index.grep(/match/, { limit: 1.5 }))).toHaveLength(1);
      expect(await collect(index.grep("match", { limit: 1.5 }))).toHaveLength(1);
    });

    test("an option getter is read exactly once per grep() call on both engines", async () => {
      using dir = tempDir("file-index-grep-option-getter", {
        "ctx.txt": "one\ntwo\nthree match\nfour\nfive match\n",
      });
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      for (const pattern of ["match", /match/] as const) {
        let reads = 0;
        const options = {
          glob: "ctx.txt",
          // A second read would observe 0 and yield no hits.
          get limit() {
            return ++reads === 1 ? 1 : 0;
          },
        };
        const hits = await collect(index.grep(pattern as string, options));
        expect({ reads, hits: hits.length }, String(pattern)).toEqual({ reads: 1, hits: 1 });
      }
    });

    // The grep builtin must not consult any user-overridable prototype
    // method or accessor: a child process tampers with the ones it would be
    // tempting to use and the search must be unaffected.
    test("tampered String/Array prototypes and a throwing RegExp flags getter cannot affect grep", async () => {
      using dir = tempDir("file-index-grep-tamper", {
        "tree/a.txt": "alpha xebra\nxx and xx\n",
        "tree/b.txt": "no hits here\n",
        "main.js": `
          const index = new Bun.FileIndex(process.argv[2]);
          await index.ready;
          String.prototype.split = () => ["TAMPERED"];
          Array.prototype.slice = () => [];
          Array.prototype.map = () => [];
          Object.defineProperty(RegExp.prototype, "flags", {
            get() {
              throw new Error("tampered flags getter");
            },
          });
          const hits = [];
          for await (const h of index.grep(/x/i, { context: 1 })) {
            hits.push(h.path + ":" + h.line + ":" + h.column + ":" + h.lineText + ":" + h.after.length);
          }
          index.close();
          console.log(JSON.stringify(hits));
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.js", join(String(dir), "tree")],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim(), exitCode, stderr: stderr.includes("tampered flags getter") }).toEqual({
        stdout: JSON.stringify([
          "a.txt:1:7:alpha xebra:1",
          "a.txt:2:1:xx and xx:0",
          "a.txt:2:2:xx and xx:0",
          "a.txt:2:8:xx and xx:0",
          "a.txt:2:9:xx and xx:0",
        ]),
        exitCode: 0,
        stderr: false,
      });
    });
  });

  // Candidates are opened by NAME after the snapshot, so a path can have
  // been swapped for anything: every read goes through one guarded
  // open(O_NOFOLLOW|O_NONBLOCK) + fstat(fd) helper, on the literal AND the
  // RegExp path.
  describe.skipIf(isWindows)("grep() candidates replaced after `ready`", () => {
    function mkfifo(path: string) {
      const { exitCode } = Bun.spawnSync({ cmd: ["mkfifo", path] });
      expect(exitCode).toBe(0);
    }

    test("a candidate swapped for a symlink outside the root never yields the target's content", async () => {
      using outside = tempDir("file-index-grep-outside", { "secret.txt": "needle OUTSIDE the root\n" });
      using dir = tempDir("file-index-grep-symlink", {
        "victim.txt": "needle inside\n",
        "zafter.txt": "needle after\n",
      });
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      // Pin the index's cached view of `victim.txt` as a regular file
      // before the swap: admission must come from the OPENED fd, never
      // from a cached (now stale) stat.
      expect(index.stat("victim.txt")?.kind).toBe("file");
      fs.unlinkSync(join(String(dir), "victim.txt"));
      fs.symlinkSync(join(String(outside), "secret.txt"), join(String(dir), "victim.txt"));
      for (const pattern of ["needle", /needle/] as const) {
        const hits = await collect(index.grep(pattern as string));
        expect(
          hits.map(h => `${h.path}:${h.lineText}`),
          String(pattern),
        ).toEqual(["zafter.txt:needle after"]);
      }
    });

    test("a candidate swapped for a writer-less FIFO terminates instead of blocking", async () => {
      using dir = tempDir("file-index-grep-fifo", {
        "victim.txt": "needle inside\n",
        "zafter.txt": "needle after\n",
      });
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      expect(index.stat("victim.txt")?.kind).toBe("file");
      fs.unlinkSync(join(String(dir), "victim.txt"));
      // A blocking `open(2)` on a FIFO with no writer never returns.
      mkfifo(join(String(dir), "victim.txt"));
      for (const pattern of ["needle", /needle/] as const) {
        const hits = await collect(index.grep(pattern as string));
        expect(
          hits.map(h => h.path),
          String(pattern),
        ).toEqual(["zafter.txt"]);
      }
    });
  });

  describe("path argument validation", () => {
    test("NUL bytes, absolute paths, and `..` components are rejected, never normalized", async () => {
      using dir = tempDir("file-index-validate", { "a.txt": "x", "a/b.txt": "y" });
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      const bad = ["..", "../x", "a/..", "a/../b", "x/../../y", "/abs", "a\0b"];
      const calls: Array<[string, (p: string) => unknown]> = [
        ["has", p => index.has(p)],
        ["stat", p => index.stat(p)],
        ["touch", p => index.touch(p)],
        ["gitDiff", p => index.gitDiff(p)],
        ["complete cwd", p => index.complete("a", { cwd: p })],
        ["glob cwd", p => index.glob("**/*", { cwd: p })],
        ["grep cwd", p => index.grep("a", { cwd: p })],
        ["grep(RegExp) cwd", p => index.grep(/a/, { cwd: p })],
      ];
      for (const [name, call] of calls) {
        for (const p of bad) {
          let err: any;
          try {
            call(p);
          } catch (e) {
            err = e;
          }
          expect(err?.code, `${name}(${JSON.stringify(p)})`).toBe("ERR_INVALID_ARG_VALUE");
          expect(err?.message, name).toContain("must be a relative path inside the index root");
        }
      }
      // Benign normalization (leading "./", trailing "/") still works.
      expect(index.has("./a.txt")).toBe(true);
      expect(index.has("a/b.txt/")).toBe(true);
      // (cwd-relative result: `cwd` has Bun.Glob's semantics.)
      expect(index.complete("b", { cwd: "./a/" }).map(r => r.path)).toEqual(["b.txt"]);
    });
  });

  describe("errors", () => {
    test("a fully enumerated tree reports 0", async () => {
      using dir = tempDir("file-index-errors-zero", { "a.txt": "1", "b/c.txt": "1" });
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      expect(index.errors).toBe(0);
    });

    // root (getuid()===0) bypasses directory permission bits, so EACCES is
    // unobtainable; Windows has no mode-bit permissions at all.
    test.skipIf(isWindows || (process.getuid?.() ?? 1) === 0)(
      "an EACCES subtree is counted in index.errors and the rest still indexes",
      async () => {
        using dir = tempDir("file-index-errors-eacces", {
          "ok.txt": "1",
          "locked/secret.txt": "1",
        });
        const locked = join(String(dir), "locked");
        fs.chmodSync(locked, 0o000);
        try {
          using index = new Bun.FileIndex(String(dir));
          await index.ready;
          expect(index.errors).toBeGreaterThan(0);
          // The unreadable directory entry itself and its readable sibling
          // are indexed; nothing below the unreadable directory is.
          expect(indexed(index)).toEqual(["locked", "ok.txt"]);
        } finally {
          fs.chmodSync(locked, 0o755);
        }
      },
    );
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
      // Whatever fit is still fully queryable (`size` counts directories).
      expect(index.glob("**/*", { onlyFiles: false }).length).toBe(index.size);

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

    test("the touch/recency ring survives refresh()", async () => {
      using dir = tempDir("file-index-refresh-touch", {
        "aaa.txt": "1",
        "bbb.txt": "1",
        "zzz.txt": "1",
      });
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      index.touch("zzz.txt");
      index.touch("bbb.txt");
      expect(index.recent()).toEqual(["bbb.txt", "zzz.txt"]);
      // The frecency boost floats the touched paths above the alphabetical tie.
      expect(
        index
          .complete("")
          .slice(0, 2)
          .map(r => r.path),
      ).toEqual(["bbb.txt", "zzz.txt"]);
      await index.refresh();
      // Recency (and its order) is re-keyed by path across the store swap.
      expect(index.recent()).toEqual(["bbb.txt", "zzz.txt"]);
      expect(
        index
          .complete("")
          .slice(0, 2)
          .map(r => r.path),
      ).toEqual(["bbb.txt", "zzz.txt"]);
      // A touched path that no longer exists is dropped, not resurrected.
      fs.rmSync(join(String(dir), "bbb.txt"));
      await index.refresh();
      expect(index.recent()).toEqual(["zzz.txt"]);
    });
  });

  describe("close() and Symbol.dispose", () => {
    test("close is idempotent, releases memory, and later calls throw", async () => {
      using dir = tempDir("file-index-close", { "a.txt": "needle" });
      // `using`: if an assertion below throws, the index is still released.
      using index = new Bun.FileIndex(String(dir));
      await index.ready;
      expect(index.memoryUsage).toBeGreaterThan(0);
      index.close();
      index.close();
      expect(index.size).toBe(0);
      expect(index.memoryUsage).toBe(0);
      expect(index.watching).toBe(false);
      const closed = /FileIndex is closed/;
      // ERR_INVALID_STATE is what Node uses for "you closed/consumed this".
      let stateErr: any;
      try {
        index.glob("**/*");
      } catch (e) {
        stateErr = e;
      }
      expect(stateErr.code).toBe("ERR_INVALID_STATE");
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
        using index = new Bun.FileIndex(String(dir));
        index.close();
        expect(await index.ready).toBe(index);
        expect(index.size).toBe(0);
      }
      {
        using index = new Bun.FileIndex(String(dir));
        await index.ready;
        const refresh = index.refresh();
        // Iterators obtained BEFORE close(): the native pull promise still
        // settles (no hang), but the first next() after close() is done.
        const literal = index.grep("needle")[Symbol.asyncIterator]();
        const regexp = index.grep(/needle/)[Symbol.asyncIterator]();
        index.close();
        expect(await refresh).toBe(index);
        expect(await literal.next()).toEqual({ done: true, value: undefined });
        expect(await regexp.next()).toEqual({ done: true, value: undefined });
      }
      {
        // Negative contract: without an intervening close() the same
        // pre-obtained iterator yields its hit.
        using index = new Bun.FileIndex(String(dir));
        await index.ready;
        const iter = index.grep("needle")[Symbol.asyncIterator]();
        expect((await iter.next()).value).toMatchObject({ path: "a.txt", line: 1 });
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

    // The only reference to the wrapper is the in-flight crawl task's
    // `Strong`; the conservative test-frame root holds only `ready`.
    function readyOnly(path: string): Promise<InstanceType<typeof Bun.FileIndex>> {
      return new Bun.FileIndex(path).ready;
    }

    test("an in-flight crawl keeps an otherwise-unreferenced index alive", async () => {
      const files: Record<string, string> = {};
      for (let i = 0; i < 300; i++) files[`d${i % 20}/f${i}.txt`] = "x";
      using dir = tempDir("file-index-gc-inflight", files);
      const ready = readyOnly(String(dir));
      // Hammer the GC while the crawl is in flight: the wrapper must not be
      // collected before its completion task resolves `ready` with it.
      for (let i = 0; i < 24; i++) Bun.gc(true);
      const index = await ready;
      expect(index.size).toBe(320);
      expect(indexed(index)).toContain("d0/f0.txt");
      index.close();
    });

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
