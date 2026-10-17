/**
 * Regression tests for scripts/build/fetch-cli.ts::applyPatch: `git apply`
 * from a repo subdirectory treats `diff --git` patch paths as toplevel-
 * relative and silently skips them with exit 0 (git-apply(1)). See the
 * doc comment on applyPatch for the full mechanism.
 */
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { applyPatch } from "../../scripts/build/fetch-cli.ts";

const ORIGINAL = "line one\nline two\nline three\n";
const PATCHED = "line one\nline two (patched)\nline three\n";

/** A patch with a `diff --git` header, the form that tripped the bug. */
const GIT_HEADER_PATCH = `diff --git a/src/file.c b/src/file.c
index 1111111..2222222 100644
--- a/src/file.c
+++ b/src/file.c
@@ -1,3 +1,3 @@
 line one
-line two
+line two (patched)
 line three
`;

/** The same change as a plain unified diff (what most of patches/ uses). */
const PLAIN_PATCH = `--- a/src/file.c
+++ b/src/file.c
@@ -1,3 +1,3 @@
 line one
-line two
+line two (patched)
 line three
`;

/** git repo → vendor/<dep>/src/file.c; returns the `dest` fetch-cli passes. */
function makeDepTree(): { dir: ReturnType<typeof tempDir>; dest: string; target: string } {
  const dir = tempDir("apply-patch", {
    "vendor/mydep/src/file.c": ORIGINAL,
  });
  // Repo above dest is the precondition for the toplevel-relative rewrite.
  const init = spawnSync("git", ["init", "-q"], { cwd: String(dir), encoding: "utf8" });
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
  const dest = join(String(dir), "vendor", "mydep");
  return { dir, dest, target: join(dest, "src", "file.c") };
}

describe("applyPatch (scripts/build/fetch-cli.ts)", () => {
  test("applies a diff --git patch from a repo subdirectory", () => {
    const { dir, dest, target } = makeDepTree();
    using _ = dir;

    // Pre-fix: "Skipped patch 'src/file.c'." (only under -v), exit 0, file untouched.
    applyPatch(dest, "test.patch", GIT_HEADER_PATCH);

    expect(readFileSync(target, "utf8")).toBe(PATCHED);
  });

  test("applies a plain unified diff from a repo subdirectory", () => {
    const { dir, dest, target } = makeDepTree();
    using _ = dir;

    applyPatch(dest, "test.patch", PLAIN_PATCH);

    expect(readFileSync(target, "utf8")).toBe(PATCHED);
  });

  test("a patch that does not apply is reported as an error", () => {
    const { dir, dest } = makeDepTree();
    using _ = dir;

    const bad = GIT_HEADER_PATCH.replace("-line two\n", "-does not exist\n");
    expect(() => applyPatch(dest, "test.patch", bad)).toThrow(/Patch failed/);
  });

  test("ignores inherited GIT_DIR / GIT_WORK_TREE", () => {
    // These (set by git hooks) bypass GIT_CEILING_DIRECTORIES entirely.
    const { dir, dest, target } = makeDepTree();
    using _ = dir;

    const saved = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
    process.env.GIT_DIR = join(String(dir), ".git");
    process.env.GIT_WORK_TREE = String(dir);
    try {
      applyPatch(dest, "test.patch", GIT_HEADER_PATCH);
      expect(readFileSync(target, "utf8")).toBe(PATCHED);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
