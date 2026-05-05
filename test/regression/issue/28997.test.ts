// https://github.com/oven-sh/bun/issues/28997
//
// cpSync should create missing parent directories for symlinks, matching its
// behavior for regular files and matching Node.js.
import { expect, test } from "bun:test";
import { cpSync, lstatSync, readFileSync, symlinkSync } from "fs";
import { tempDir } from "harness";
import { join } from "path";

test("cpSync copies a symlink into a missing parent directory", () => {
  using dir = tempDir("cp-sync-symlink-28997", {
    "target.md": "# Hello",
  });
  const root = String(dir);

  // Absolute target so the test works on Windows too.
  symlinkSync(join(root, "target.md"), join(root, "link.md"));

  // Regular file into a missing parent directory still works (baseline).
  cpSync(join(root, "target.md"), join(root, "out/target.md"), { recursive: true });
  expect(lstatSync(join(root, "out/target.md")).isFile()).toBe(true);

  // The bug: symlink into a missing parent directory threw ENOENT.
  // After the fix, the parent directory is created and the symlink is copied.
  cpSync(join(root, "link.md"), join(root, "out2/link.md"), { recursive: true });
  expect(lstatSync(join(root, "out2/link.md")).isSymbolicLink()).toBe(true);
  expect(readFileSync(join(root, "out2/link.md"), "utf8")).toBe("# Hello");
});

test("cpSync copies a symlink into a deeply nested missing parent directory", () => {
  using dir = tempDir("cp-sync-symlink-28997-nested", {
    "target.md": "# Hello",
  });
  const root = String(dir);

  symlinkSync(join(root, "target.md"), join(root, "link.md"));

  cpSync(join(root, "link.md"), join(root, "a/b/c/link.md"), { recursive: true });
  expect(lstatSync(join(root, "a/b/c/link.md")).isSymbolicLink()).toBe(true);
  expect(readFileSync(join(root, "a/b/c/link.md"), "utf8")).toBe("# Hello");
});
