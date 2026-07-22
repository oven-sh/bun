/**
 * Regression tests for scripts/build/fetch-cli.ts::applyPatch.
 *
 * vendor/<dep>/ is a subdirectory of the bun repo's worktree. `git apply
 * --no-index` still runs repo discovery, and from a subdirectory a patch
 * with a `diff --git a/... b/...` header has its paths interpreted as
 * TOPLEVEL-relative: "When running from a subdirectory in a repository,
 * patched paths outside the directory are ignored" (git-apply(1)). The
 * dep's `src/foo.c` is outside the `vendor/<dep>/` prefix, so git says
 * "Skipped patch '...'" (only under -v) and exits 0 having touched
 * nothing. applyPatch used to check only the exit status, so such a patch
 * was silently dropped and the .ref stamp certified an unpatched tree.
 *
 * These tests recreate the layout (git repo → subdir → extracted source)
 * and drive applyPatch directly.
 */
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { applyPatch } from "../../scripts/build/fetch-cli.ts";

const ORIGINAL = "line one\nline two\nline three\n";
const PATCHED_LINE = "line two (patched)";

/** A patch with a `diff --git` header, the form that tripped the bug. */
const GIT_HEADER_PATCH = `diff --git a/src/file.c b/src/file.c
index 1111111..2222222 100644
--- a/src/file.c
+++ b/src/file.c
@@ -1,3 +1,3 @@
 line one
-line two
+${PATCHED_LINE}
 line three
`;

/** The same change as a plain unified diff (what most of patches/ uses). */
const PLAIN_PATCH = `--- a/src/file.c
+++ b/src/file.c
@@ -1,3 +1,3 @@
 line one
-line two
+${PATCHED_LINE}
 line three
`;

/**
 * Recreate fetch-cli's environment: a git repo with an extracted dep
 * source tree under vendor/<dep>/. Returns the absolute dep dir (what
 * fetch-cli passes as `dest`).
 */
function makeDepTree(): { dir: ReturnType<typeof tempDir>; dest: string; target: string } {
  const dir = tempDir("apply-patch", {
    "vendor/mydep/src/file.c": ORIGINAL,
  });
  // A real repo, so `git apply`'s setup_git_directory() finds a worktree
  // above dest — the precondition for the toplevel-relative path rewrite.
  const init = spawnSync("git", ["init", "-q"], { cwd: String(dir), encoding: "utf8" });
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
  const dest = join(String(dir), "vendor", "mydep");
  return { dir, dest, target: join(dest, "src", "file.c") };
}

describe("applyPatch (scripts/build/fetch-cli.ts)", () => {
  test("applies a diff --git patch from a repo subdirectory", () => {
    const { dir, dest, target } = makeDepTree();
    using _ = dir;

    // Before the fix: git discovers the enclosing repo, treats "src/file.c"
    // as toplevel-relative (outside the vendor/mydep/ prefix), prints
    // "Skipped patch 'src/file.c'." only under -v, and exits 0 — applyPatch
    // returns normally and the file is untouched.
    applyPatch(dest, "test.patch", GIT_HEADER_PATCH);

    expect(readFileSync(target, "utf8")).toContain(PATCHED_LINE);
  });

  test("applies a plain unified diff from a repo subdirectory", () => {
    const { dir, dest, target } = makeDepTree();
    using _ = dir;

    applyPatch(dest, "test.patch", PLAIN_PATCH);

    expect(readFileSync(target, "utf8")).toContain(PATCHED_LINE);
  });

  test("a patch that does not apply is reported as an error", () => {
    const { dir, dest } = makeDepTree();
    using _ = dir;

    const bad = GIT_HEADER_PATCH.replace("-line two\n", "-does not exist\n");
    expect(() => applyPatch(dest, "test.patch", bad)).toThrow(/Patch failed/);
  });

  test("ignores inherited GIT_DIR / GIT_WORK_TREE", () => {
    // A build kicked off from a git hook inherits GIT_DIR/GIT_WORK_TREE,
    // which bypass GIT_CEILING_DIRECTORIES entirely. applyPatch must drop
    // them so the ceiling takes effect.
    const { dir, dest, target } = makeDepTree();
    using _ = dir;

    const saved = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
    process.env.GIT_DIR = join(String(dir), ".git");
    process.env.GIT_WORK_TREE = String(dir);
    try {
      applyPatch(dest, "test.patch", GIT_HEADER_PATCH);
      expect(readFileSync(target, "utf8")).toContain(PATCHED_LINE);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
