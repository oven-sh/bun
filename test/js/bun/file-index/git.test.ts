import { describe, expect, test } from "bun:test";
import { bunEnv, isWindows, tempDir } from "harness";
import * as fs from "node:fs";
import { join } from "node:path";

// `gitStatus()` / `gitDiff()` never spawn git; these tests spawn the real git
// binary to build fixtures and to differentially verify the results.
const gitEnv = {
  ...bunEnv,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "bun",
  GIT_AUTHOR_EMAIL: "bun@example.com",
  GIT_AUTHOR_DATE: "2024-01-01T00:00:00Z",
  GIT_COMMITTER_NAME: "bun",
  GIT_COMMITTER_EMAIL: "bun@example.com",
  GIT_COMMITTER_DATE: "2024-01-01T00:00:00Z",
};

function git(cwd: string, ...args: string[]): string {
  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: ["git", "-c", "core.autocrlf=false", ...args],
    cwd,
    env: gitEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} exited with ${exitCode}:\n${stderr.toString()}`);
  }
  return stdout.toString();
}

function initRepo(root: string) {
  git(root, "init", "-q", "-b", "main");
}

type StatusFile = { path: string; status: string };

// The only porcelain-v1 deviations bun_git documents (src/git/status.rs):
// type changes report `M` instead of `T`, and every unmerged shape collapses
// to `UU`. Both listings are normalized through this before comparison.
function normalizeXY(xy: string): string {
  if (xy.includes("U") || xy === "AA" || xy === "DD") return "UU";
  return xy.replaceAll("T", "M");
}

function sortFiles(files: StatusFile[]): StatusFile[] {
  return files.toSorted((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : a.status < b.status ? -1 : a.status > b.status ? 1 : 0,
  );
}

/// `git status --porcelain=v1 -z --untracked-files=all --no-renames`, parsed.
function gitStatusFiles(cwd: string): StatusFile[] {
  const raw = git(cwd, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames");
  const files: StatusFile[] = [];
  for (const entry of raw.split("\0")) {
    if (entry.length === 0) continue;
    files.push({ path: entry.slice(3), status: normalizeXY(entry.slice(0, 2)) });
  }
  return sortFiles(files);
}

async function bunGitStatus(root: string) {
  using index = new Bun.FileIndex(root);
  await index.ready;
  return await index.gitStatus();
}

async function bunStatusFiles(root: string): Promise<StatusFile[]> {
  const status = await bunGitStatus(root);
  expect(status).not.toBeNull();
  return sortFiles(status!.files.map(f => ({ path: f.path, status: normalizeXY(f.status) })));
}

/// The differential assertion: a fresh FileIndex's gitStatus() must agree
/// with the real `git status --porcelain=v1` on the same tree.
async function expectStatusMatchesGit(root: string, label: string) {
  const fromGit = gitStatusFiles(root);
  const fromBun = await bunStatusFiles(root);
  expect(fromBun, label).toEqual(fromGit);
  return fromGit;
}

async function bunGitDiff(root: string, path: string) {
  using index = new Bun.FileIndex(root);
  await index.ready;
  return await index.gitDiff(path);
}

type Diff = NonNullable<Awaited<ReturnType<typeof bunGitDiff>>>;

/// Replay `hunks` over `oldText`. Every input in these tests ends with "\n",
/// so re-appending the terminator each hunk line drops is exact.
function applyHunks(oldText: string, hunks: Diff["hunks"]): string {
  const oldLines = oldText.length === 0 ? [] : oldText.split("\n").slice(0, -1);
  let out = "";
  let cursor = 0;
  for (const hunk of hunks) {
    const start = hunk.oldLines === 0 ? hunk.oldStart : hunk.oldStart - 1;
    expect(start).toBeGreaterThanOrEqual(cursor);
    while (cursor < start) out += `${oldLines[cursor++]}\n`;
    for (const line of hunk.lines) {
      if (line.kind === "add") {
        out += `${line.text}\n`;
        continue;
      }
      expect(cursor).toBeLessThan(oldLines.length);
      expect(line.text).toBe(oldLines[cursor]);
      if (line.kind === "context") out += `${oldLines[cursor]}\n`;
      cursor++;
    }
  }
  while (cursor < oldLines.length) out += `${oldLines[cursor++]}\n`;
  return out;
}

describe("Bun.FileIndex gitStatus()", () => {
  test("resolves null when root is not inside a git work tree", async () => {
    using dir = tempDir("file-index-git-none", { "a.txt": "alpha\n" });
    expect(await bunGitStatus(String(dir))).toBeNull();
  });

  test("throws after close()", async () => {
    using dir = tempDir("file-index-git-closed", { "a.txt": "alpha\n" });
    const index = new Bun.FileIndex(String(dir));
    await index.ready;
    index.close();
    expect(() => index.gitStatus()).toThrow("FileIndex is closed");
    expect(() => index.gitDiff("a.txt")).toThrow("FileIndex is closed");
  });

  test("matches `git status --porcelain=v1` through a scripted sequence", async () => {
    using dir = tempDir("file-index-git-seq", {
      "a.txt": "alpha\n",
      "b.txt": "bravo\n",
      "exec.sh": "#!/bin/sh\n",
      "src/c.txt": "charlie\n",
    });
    const root = String(dir);
    initRepo(root);
    await expectStatusMatchesGit(root, "everything untracked before the first add");
    git(root, "add", ".");
    await expectStatusMatchesGit(root, "everything staged as added");
    git(root, "commit", "-q", "-m", "init");

    const clean = await bunGitStatus(root);
    expect(clean).not.toBeNull();
    expect(clean!.branch).toBe("main");
    expect(clean!.detached).toBe(false);
    expect(clean!.oid).toBe(git(root, "rev-parse", "HEAD").trim());
    expect(clean!.files).toEqual([]);
    expect(gitStatusFiles(root)).toEqual([]);

    // After every step, gitStatus() must agree with git. The steps build on
    // each other, so each comparison covers a growing mix of XY codes.
    const steps: Array<[string, () => void]> = [
      ["modify a tracked file (' M')", () => fs.writeFileSync(join(root, "a.txt"), "alpha rewritten\n")],
      ["stage that modification ('M ')", () => void git(root, "add", "a.txt")],
      ["modify again after staging ('MM')", () => fs.writeFileSync(join(root, "a.txt"), "alpha rewritten twice\n")],
      ["touch without changing content (clean)", () => fs.utimesSync(join(root, "b.txt"), new Date(), new Date())],
      ["delete a tracked file (' D')", () => fs.rmSync(join(root, "b.txt"))],
      ["stage that deletion ('D ')", () => void git(root, "rm", "-q", "--cached", "b.txt")],
      [
        "new file in a new directory ('??')",
        () => {
          fs.mkdirSync(join(root, "deep/nested"), { recursive: true });
          fs.writeFileSync(join(root, "deep/nested/new.txt"), "new\n");
        },
      ],
      ["stage the new file ('A ')", () => void git(root, "add", "deep")],
      ["modify the staged new file ('AM')", () => fs.writeFileSync(join(root, "deep/nested/new.txt"), "newer\n")],
      ["chmod +x a tracked file", () => fs.chmodSync(join(root, "exec.sh"), 0o755)],
      ["rename a tracked file (' D' + '??')", () => fs.renameSync(join(root, "src/c.txt"), join(root, "src/c2.txt"))],
      ["stage the rename ('D ' + 'A ')", () => void git(root, "add", "-A", "src")],
    ];
    for (const [label, step] of steps) {
      step();
      await expectStatusMatchesGit(root, label);
    }
    // The sequence really produced a non-trivial final state.
    expect((await bunStatusFiles(root)).length).toBeGreaterThanOrEqual(5);
  });

  test("untracked files excluded by .gitignore never appear", async () => {
    using dir = tempDir("file-index-git-ignore", {
      ".gitignore": "ignored/\n*.log\n",
      "kept.txt": "kept\n",
      "debug.log": "nope\n",
      "ignored/deep/x.txt": "nope\n",
      "sub/.gitignore": "local.txt\n",
      "sub/local.txt": "nope\n",
      "sub/seen.txt": "seen\n",
    });
    const root = String(dir);
    initRepo(root);
    const fromGit = await expectStatusMatchesGit(root, "untracked listing");
    const paths = fromGit.map(f => f.path);
    expect(paths).toEqual([".gitignore", "kept.txt", "sub/.gitignore", "sub/seen.txt"]);
  });

  test("a tracked file matched by a .gitignore rule is statted, not reported deleted", async () => {
    using dir = tempDir("file-index-git-tracked-ignored", {
      "kept.txt": "kept\n",
      "generated.txt": "v1\n",
      "out/built.js": "v1\n",
    });
    const root = String(dir);
    initRepo(root);
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "init");
    // The rules arrive AFTER the files were tracked: git still tracks them,
    // but FileIndex's crawl excludes them from the in-memory store.
    fs.writeFileSync(join(root, ".gitignore"), "generated.txt\nout/\n");
    {
      using index = new Bun.FileIndex(root);
      await index.ready;
      expect(index.has("generated.txt")).toBe(false);
      expect(index.has("out/built.js")).toBe(false);
      // Untouched on disk: must NOT be reported (and never as " D").
      expect(sortFiles((await index.gitStatus())!.files)).toEqual([{ path: ".gitignore", status: "??" }]);
    }
    fs.writeFileSync(join(root, "generated.txt"), "v2 modified in the worktree\n");
    await expectStatusMatchesGit(root, "tracked-but-gitignored file modified");
    expect(await bunStatusFiles(root)).toEqual([
      { path: ".gitignore", status: "??" },
      { path: "generated.txt", status: " M" },
    ]);
    // A user `ignore:` pattern (no .gitignore involvement) behaves the same.
    fs.rmSync(join(root, ".gitignore"));
    {
      using index = new Bun.FileIndex(root, { ignore: ["generated.txt"] });
      await index.ready;
      expect(index.has("generated.txt")).toBe(false);
      expect(sortFiles((await index.gitStatus())!.files)).toEqual([{ path: "generated.txt", status: " M" }]);
    }
    // A tracked, ignored file that really IS gone still reports " D".
    fs.rmSync(join(root, "generated.txt"));
    fs.writeFileSync(join(root, ".gitignore"), "generated.txt\nout/\n");
    expect(await bunStatusFiles(root)).toEqual(await expectStatusMatchesGit(root, "really deleted"));
  });

  test("empty repository with no commits", async () => {
    using dir = tempDir("file-index-git-empty", { "a.txt": "alpha\n" });
    const root = String(dir);
    initRepo(root);
    const status = await bunGitStatus(root);
    expect(status).not.toBeNull();
    expect(status!.branch).toBe("main");
    expect(status!.oid).toBeNull();
    expect(status!.detached).toBe(false);
    await expectStatusMatchesGit(root, "unborn HEAD, untracked file");
    git(root, "add", "a.txt");
    await expectStatusMatchesGit(root, "unborn HEAD, staged file");
  });

  test("detached HEAD", async () => {
    using dir = tempDir("file-index-git-detached", { "a.txt": "alpha\n" });
    const root = String(dir);
    initRepo(root);
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "init");
    git(root, "checkout", "-q", "--detach");
    fs.writeFileSync(join(root, "a.txt"), "alpha rewritten\n");
    const status = await bunGitStatus(root);
    expect(status).not.toBeNull();
    expect(status!.detached).toBe(true);
    expect(status!.branch).toBeNull();
    expect(status!.oid).toBe(git(root, "rev-parse", "HEAD").trim());
    await expectStatusMatchesGit(root, "detached HEAD with a modified file");
  });

  test("after `git gc` (packfiles) and `git pack-refs --all`", async () => {
    using dir = tempDir("file-index-git-gc", {
      "a.txt": "one\ntwo\nthree\n",
      "b/large.txt": Buffer.alloc(4096, "x").toString(),
    });
    const root = String(dir);
    initRepo(root);
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "one");
    fs.writeFileSync(join(root, "a.txt"), "one\ntwo\nthree\nfour\n");
    git(root, "commit", "-q", "-am", "two");
    git(root, "gc", "-q", "--aggressive", "--prune=now");
    git(root, "pack-refs", "--all");
    // The fixture really is packed: no loose branch ref, no loose objects.
    expect(fs.existsSync(join(root, ".git/refs/heads/main"))).toBe(false);
    expect(fs.readdirSync(join(root, ".git/objects/pack")).some(f => f.endsWith(".pack"))).toBe(true);

    const clean = await bunGitStatus(root);
    expect(clean).not.toBeNull();
    expect(clean!.branch).toBe("main");
    expect(clean!.oid).toBe(git(root, "rev-parse", "HEAD").trim());
    expect(clean!.files).toEqual([]);

    fs.writeFileSync(join(root, "a.txt"), "one\nTWO\nthree\nfour\n");
    fs.rmSync(join(root, "b/large.txt"));
    await expectStatusMatchesGit(root, "modifications over a fully packed repository");

    // gitDiff reads the old blob out of the packfile.
    const diff = await bunGitDiff(root, "a.txt");
    expect(diff).not.toBeNull();
    expect(diff!.oldText).toBe("one\ntwo\nthree\nfour\n");
    expect(diff!.newText).toBe("one\nTWO\nthree\nfour\n");
    expect(applyHunks(diff!.oldText!, diff!.hunks)).toBe(diff!.newText!);
  });

  test("an index rooted in a subdirectory of the work tree reports root-relative paths under it", async () => {
    using dir = tempDir("file-index-git-subdir", {
      "top.txt": "top\n",
      "sub/in.txt": "in\n",
      "sub/other.txt": "other\n",
    });
    const root = String(dir);
    initRepo(root);
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "init");
    fs.writeFileSync(join(root, "top.txt"), "top changed\n");
    fs.writeFileSync(join(root, "sub/in.txt"), "in changed\n");
    fs.writeFileSync(join(root, "sub/new.txt"), "new\n");

    const status = await bunGitStatus(join(root, "sub"));
    expect(status).not.toBeNull();
    expect(status!.branch).toBe("main");
    // Only paths under `root`, relative to `root` (not to the work tree).
    expect(sortFiles(status!.files)).toEqual([
      { path: "in.txt", status: " M" },
      { path: "new.txt", status: "??" },
    ]);

    const diff = await bunGitDiff(join(root, "sub"), "in.txt");
    expect(diff).not.toBeNull();
    expect(diff!.oldText).toBe("in\n");
    expect(diff!.newText).toBe("in changed\n");
  });

  test("linked worktree created with `git worktree add`", async () => {
    using dir = tempDir("file-index-git-worktree", {
      "main/a.txt": "alpha\n",
      "main/b.txt": "bravo\n",
    });
    const main = join(String(dir), "main");
    const linked = join(String(dir), "linked");
    initRepo(main);
    git(main, "add", ".");
    git(main, "commit", "-q", "-m", "init");
    git(main, "worktree", "add", "-q", "-b", "feature", linked);
    // The linked worktree's `.git` is a file with `gitdir:` indirection.
    expect(fs.statSync(join(linked, ".git")).isFile()).toBe(true);

    fs.writeFileSync(join(linked, "a.txt"), "alpha in the linked worktree\n");
    fs.writeFileSync(join(linked, "untracked.txt"), "untracked\n");
    const status = await bunGitStatus(linked);
    expect(status).not.toBeNull();
    expect(status!.branch).toBe("feature");
    expect(status!.oid).toBe(git(linked, "rev-parse", "HEAD").trim());
    await expectStatusMatchesGit(linked, "linked worktree");
    // The main worktree is unaffected and still reports its own branch.
    const mainStatus = await bunGitStatus(main);
    expect(mainStatus!.branch).toBe("main");
    expect(mainStatus!.files).toEqual([]);

    const diff = await bunGitDiff(linked, "a.txt");
    expect(diff).not.toBeNull();
    expect(diff!.oldText).toBe("alpha\n");
    expect(diff!.newText).toBe("alpha in the linked worktree\n");
  });
});

describe("Bun.FileIndex gitDiff()", () => {
  test("resolves null outside a git work tree", async () => {
    using dir = tempDir("file-index-diff-none", { "a.txt": "alpha\n" });
    expect(await bunGitDiff(String(dir), "a.txt")).toBeNull();
  });

  test("exact hunk for a single-line edit", async () => {
    const oldText = "a\nb\nc\nd\ne\n";
    using dir = tempDir("file-index-diff-one", { "f.txt": oldText });
    const root = String(dir);
    initRepo(root);
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "init");
    const newText = "a\nb\nX\nd\ne\n";
    fs.writeFileSync(join(root, "f.txt"), newText);

    const diff = await bunGitDiff(root, "f.txt");
    expect(diff).not.toBeNull();
    expect(diff!.oldText).toBe(oldText);
    expect(diff!.newText).toBe(newText);
    expect(diff!.hunks).toEqual([
      {
        oldStart: 1,
        oldLines: 5,
        newStart: 1,
        newLines: 5,
        lines: [
          { kind: "context", text: "a" },
          { kind: "context", text: "b" },
          { kind: "del", text: "c" },
          { kind: "add", text: "X" },
          { kind: "context", text: "d" },
          { kind: "context", text: "e" },
        ],
      },
    ]);
    expect(applyHunks(oldText, diff!.hunks)).toBe(newText);
  });

  test("modify + delete + append against a committed file", async () => {
    const oldText = Array.from({ length: 12 }, (_, i) => `line ${i + 1}\n`).join("");
    using dir = tempDir("file-index-diff-multi", { "f.txt": oldText });
    const root = String(dir);
    initRepo(root);
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "init");

    const lines = oldText.split("\n").slice(0, -1);
    lines[2] = "LINE THREE";
    lines.splice(6, 1);
    lines.push("line 13");
    const newText = `${lines.join("\n")}\n`;
    fs.writeFileSync(join(root, "f.txt"), newText);

    const diff = await bunGitDiff(root, "f.txt");
    expect(diff).not.toBeNull();
    expect(diff!.oldText).toBe(oldText);
    expect(diff!.newText).toBe(newText);
    const all = diff!.hunks.flatMap(h => h.lines);
    expect(all.filter(l => l.kind === "del").map(l => l.text)).toEqual(["line 3", "line 7"]);
    expect(all.filter(l => l.kind === "add").map(l => l.text)).toEqual(["LINE THREE", "line 13"]);
    for (const hunk of diff!.hunks) {
      const lines = hunk.lines;
      expect(lines.filter(l => l.kind !== "add").length).toBe(hunk.oldLines);
      expect(lines.filter(l => l.kind !== "del").length).toBe(hunk.newLines);
    }
    expect(applyHunks(oldText, diff!.hunks)).toBe(newText);

    // An unmodified sibling commit state: identical contents, no hunks.
    git(root, "add", "f.txt");
    git(root, "commit", "-q", "-m", "update");
    const clean = await bunGitDiff(root, "f.txt");
    expect(clean).not.toBeNull();
    expect(clean!.oldText).toBe(newText);
    expect(clean!.newText).toBe(newText);
    expect(clean!.hunks).toEqual([]);
  });

  test("a file not in HEAD has a null oldText and one all-add hunk", async () => {
    using dir = tempDir("file-index-diff-new", { "committed.txt": "x\n" });
    const root = String(dir);
    initRepo(root);
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "init");
    fs.mkdirSync(join(root, "fresh"));
    fs.writeFileSync(join(root, "fresh/new.txt"), "one\ntwo\n");

    const diff = await bunGitDiff(root, "fresh/new.txt");
    expect(diff).not.toBeNull();
    expect(diff!.oldText).toBeNull();
    expect(diff!.newText).toBe("one\ntwo\n");
    expect(diff!.hunks).toEqual([
      {
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 2,
        lines: [
          { kind: "add", text: "one" },
          { kind: "add", text: "two" },
        ],
      },
    ]);
    expect(applyHunks("", diff!.hunks)).toBe("one\ntwo\n");
  });

  test("a deleted file has a null newText and one all-del hunk", async () => {
    using dir = tempDir("file-index-diff-del", { "gone.txt": "one\ntwo\n" });
    const root = String(dir);
    initRepo(root);
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "init");
    fs.rmSync(join(root, "gone.txt"));

    const diff = await bunGitDiff(root, "gone.txt");
    expect(diff).not.toBeNull();
    expect(diff!.oldText).toBe("one\ntwo\n");
    expect(diff!.newText).toBeNull();
    expect(diff!.hunks).toEqual([
      {
        oldStart: 1,
        oldLines: 2,
        newStart: 0,
        newLines: 0,
        lines: [
          { kind: "del", text: "one" },
          { kind: "del", text: "two" },
        ],
      },
    ]);
    expect(applyHunks(diff!.oldText!, diff!.hunks)).toBe("");
  });

  test("a path in neither HEAD nor the worktree resolves null", async () => {
    using dir = tempDir("file-index-diff-missing", { "a.txt": "alpha\n" });
    const root = String(dir);
    initRepo(root);
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "init");
    expect(await bunGitDiff(root, "does/not/exist.txt")).toBeNull();
  });

  test("a binary file yields null texts and no hunks", async () => {
    const oldBytes = Buffer.from([0x62, 0x69, 0x6e, 0x00, 0x01, 0x02, 0x0a]);
    using dir = tempDir("file-index-diff-binary", { "bin.dat": oldBytes, "text.txt": "text\n" });
    const root = String(dir);
    initRepo(root);
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "init");
    fs.writeFileSync(join(root, "bin.dat"), Buffer.from([0x62, 0x69, 0x6e, 0x00, 0xff, 0x0a]));

    // Modified binary: both sides withheld, no hunks.
    expect(await bunGitDiff(root, "bin.dat")).toEqual({ oldText: null, newText: null, hunks: [] });
    // A new, untracked binary file: same shape (the worktree side is binary).
    fs.writeFileSync(join(root, "new.dat"), Buffer.from([0x00, 0x01]));
    expect(await bunGitDiff(root, "new.dat")).toEqual({ oldText: null, newText: null, hunks: [] });
    // The text sibling is unaffected.
    const text = await bunGitDiff(root, "text.txt");
    expect(text!.oldText).toBe("text\n");
  });

  test.skipIf(isWindows)("a symlink diffs its target string and never reads through the link", async () => {
    // The link target lives OUTSIDE the index root: if gitDiff() opened
    // through the link it would read out-of-root file contents.
    using dir = tempDir("file-index-diff-symlink", {
      "outside/secret.txt": "OUT-OF-ROOT SECRET CONTENTS\n",
      "repo/a.txt": "alpha\n",
    });
    const outside = join(String(dir), "outside", "secret.txt");
    const root = join(String(dir), "repo");
    fs.symlinkSync(outside, join(root, "link"));
    initRepo(root);
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "init");

    // Unmodified: both sides are the link target *string* (git mode 120000).
    const clean = await bunGitDiff(root, "link");
    expect(clean).toEqual({ oldText: outside, newText: outside, hunks: [] });

    // Re-point the link: the diff is target-string vs target-string.
    fs.rmSync(join(root, "link"));
    fs.symlinkSync(join(String(dir), "outside"), join(root, "link"));
    const repointed = await bunGitDiff(root, "link");
    expect(repointed!.oldText).toBe(outside);
    expect(repointed!.newText).toBe(join(String(dir), "outside"));
    // Negative contract: the linked file's contents never appear anywhere.
    expect(JSON.stringify(repointed)).not.toContain("SECRET CONTENTS");
    expect(JSON.stringify(clean)).not.toContain("SECRET CONTENTS");

    // An untracked symlink (no HEAD side) still reads only the link target.
    fs.symlinkSync(outside, join(root, "newlink"));
    const fresh = await bunGitDiff(root, "newlink");
    expect(fresh!.oldText).toBeNull();
    expect(fresh!.newText).toBe(outside);
  });

  test("invalid arguments throw synchronously", async () => {
    using dir = tempDir("file-index-diff-args", { "a.txt": "alpha\n" });
    using index = new Bun.FileIndex(String(dir));
    await index.ready;
    // @ts-expect-error - path is required
    expect(() => index.gitDiff()).toThrow("expects a string");
    expect(() => index.gitDiff("")).toThrow("must not be empty");
    for (const bad of ["../x", "a/../../x", "/abs", "a\0b"]) {
      let err: any;
      try {
        index.gitDiff(bad);
      } catch (e) {
        err = e;
      }
      expect(err?.code, bad).toBe("ERR_INVALID_ARG_VALUE");
      expect(err?.message, bad).toContain("FileIndex.gitDiff");
    }
  });
});

describe("Bun.FileIndex gitignore differential vs git", () => {
  // A deterministic PRNG (mulberry32) so the "randomized" tree is the same
  // on every run: a regression here is reproducible, not flaky.
  function rng(seed: number) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildSeededTree(seed: number) {
    const rand = rng(seed);
    const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
    const dirs = ["", "src", "src/deep", "src/deep/er", "lib", "lib/sub", "dist", "docs"];
    const names = ["a", "b", "keep", "skip", "index", "main", "dist", "node_modules"];
    const exts = [".ts", ".log", ".md", ".tmp", ""];
    const files: Record<string, string> = {};
    for (let i = 0; i < 120; i++) {
      const d = pick(dirs);
      const f = `${pick(names)}${i}${pick(exts)}`;
      files[d ? `${d}/${f}` : f] = `${i}\n`;
    }
    // .gitignore stacks at several depths covering negation, anchoring,
    // dir-only, `**`, and the parent-excluded rule.
    files[".gitignore"] = "*.log\n!keep*.log\n/dist/\n**/*.tmp\nnode_modules*\n";
    files["src/.gitignore"] = "deep/er/\n!*.tmp\nmain*\n";
    files["lib/.gitignore"] = "!*.log\nsub/skip*\n";
    files["docs/.gitignore"] = "*\n!*.md\n!.gitignore\n";
    // Guaranteed witnesses for each rule so the comparison is never vacuous.
    files["build.log"] = "ignored\n";
    files["keep1.log"] = "re-included\n";
    files["dist/out.js"] = "dir-only\n";
    files["src/x.tmp"] = "re-included under src\n";
    files["lib/x.tmp"] = "ignored\n";
    files["src/deep/er/buried.ts"] = "parent-excluded\n";
    files["docs/readme.md"] = "kept\n";
    files["docs/notes.txt"] = "dropped\n";
    return files;
  }

  test("indexed set === `git ls-files --cached --others --exclude-standard`", async () => {
    using dir = tempDir("file-index-gitignore-diff", buildSeededTree(0x5eed01));
    const root = String(dir);
    initRepo(root);
    const fromGit = git(root, "ls-files", "--cached", "--others", "--exclude-standard", "-z")
      .split("\0")
      .filter(p => p.length > 0)
      .sort();
    using index = new Bun.FileIndex(root);
    await index.ready;
    // `ls-files` lists files only; the index also holds directories.
    const fromBun = index
      .glob("**/*")
      .filter(p => index.stat(p)!.kind !== "dir")
      .sort();
    expect(fromGit.length).toBeGreaterThan(20);
    expect(fromBun).toEqual(fromGit);
  });

  test("probe paths agree with `git check-ignore --no-index -v --non-matching -z --stdin`", async () => {
    using dir = tempDir("file-index-checkignore-diff", buildSeededTree(0xc0ffee));
    const root = String(dir);
    initRepo(root);
    using index = new Bun.FileIndex(root);
    await index.ready;
    const indexedSet = new Set(index.glob("**/*"));
    // Probe everything that actually exists on disk (recursive walk) so each
    // side classifies the identical universe of real paths.
    const probes = fs
      .readdirSync(root, { recursive: true, withFileTypes: true })
      .filter(e => e.isFile())
      .map(e => `${e.parentPath.slice(root.length + 1)}/${e.name}`.replace(/^\//, ""))
      .filter(p => !p.startsWith(".git/"))
      .sort();
    expect(probes.length).toBeGreaterThan(40);

    const { stdout, exitCode, stderr } = Bun.spawnSync({
      cmd: ["git", "-c", "core.autocrlf=false", "check-ignore", "--no-index", "-v", "--non-matching", "-z", "--stdin"],
      cwd: root,
      env: gitEnv,
      stdin: Buffer.from(probes.join("\0") + "\0"),
      stdout: "pipe",
      stderr: "pipe",
    });
    // 0 = some ignored, 1 = none ignored; anything else is a real failure.
    expect([0, 1], stderr.toString()).toContain(exitCode);
    // -v -z output is <source> NUL <linenum> NUL <pattern> NUL <pathname> NUL;
    // a non-matching path has all three metadata fields empty.
    const fields = stdout.toString().split("\0");
    const gitIgnored = new Set<string>();
    for (let i = 0; i + 3 < fields.length; i += 4) {
      // `!pattern` = the deciding rule was a negation: the path is NOT ignored.
      if (fields[i] !== "" && !fields[i + 2].startsWith("!")) gitIgnored.add(fields[i + 3]);
    }
    const disagreements = probes
      .map(p => ({ path: p, git: gitIgnored.has(p), bun: !indexedSet.has(p) }))
      .filter(x => x.git !== x.bun);
    expect(disagreements).toEqual([]);
    // The fixture exercises both outcomes.
    expect(probes.some(p => gitIgnored.has(p))).toBe(true);
    expect(probes.some(p => !gitIgnored.has(p))).toBe(true);
  });
});
