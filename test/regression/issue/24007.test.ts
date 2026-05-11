/**
 * Regression test for GitHub issue #24007
 * https://github.com/oven-sh/bun/issues/24007
 *
 * Issue: Bun's glob/readdir functionality failed on bind-mounted paths in Docker
 * because certain filesystems (sshfs, fuse, NFS, bind mounts) don't provide d_type
 * information in directory entries (returns DT_UNKNOWN).
 *
 * Fix: Added lstatat() fallback when d_type is unknown, following the lazy stat
 * pattern from PR #18172.
 *
 * See also: test/cli/run/glob-on-fuse.test.ts for FUSE filesystem testing.
 */
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import fs from "node:fs";
import path from "node:path";

describe.concurrent("issue #24007 - glob with recursive patterns", () => {
  test("recursive glob pattern **/*.ts finds nested files", () => {
    using dir = tempDir("issue-24007", {
      "server/api/health.get.ts": "export default () => 'ok';",
      "server/api/users/list.ts": "export default () => [];",
      "server/routes/index.ts": "export default {};",
      "server/routes/admin/dashboard.ts": "export default {};",
      "config.ts": "export default {};",
    });

    const cwd = String(dir);

    // Test recursive pattern with **
    const results = fs.globSync("**/*.ts", { cwd });

    expect(results).toContain("config.ts");
    expect(results).toContain(path.join("server", "api", "health.get.ts"));
    expect(results).toContain(path.join("server", "api", "users", "list.ts"));
    expect(results).toContain(path.join("server", "routes", "index.ts"));
    expect(results).toContain(path.join("server", "routes", "admin", "dashboard.ts"));
    expect(results.length).toBe(5);
  });

  test("recursive glob pattern server/**/*.ts finds files in subdirectory", () => {
    using dir = tempDir("issue-24007-subdir", {
      "server/api/health.get.ts": "x",
      "server/routes/status.ts": "x",
      "other/file.ts": "x",
    });

    const cwd = String(dir);
    const results = fs.globSync("server/**/*.ts", { cwd });

    expect(results).toContain(path.join("server", "api", "health.get.ts"));
    expect(results).toContain(path.join("server", "routes", "status.ts"));
    expect(results).not.toContain(path.join("other", "file.ts"));
    expect(results.length).toBe(2);
  });

  test("top-level glob pattern server/*.ts finds direct children", () => {
    using dir = tempDir("issue-24007-toplevel", {
      "server/index.ts": "x",
      "server/config.ts": "x",
      "server/nested/deep.ts": "x",
    });

    const cwd = String(dir);
    const results = fs.globSync("server/*.ts", { cwd });

    expect(results).toContain(path.join("server", "index.ts"));
    expect(results).toContain(path.join("server", "config.ts"));
    expect(results).not.toContain(path.join("server", "nested", "deep.ts"));
    expect(results.length).toBe(2);
  });

  test("Bun.Glob recursive scan finds nested files", () => {
    using dir = tempDir("issue-24007-bun-glob", {
      "api/health.get.ts": "x",
      "api/users/index.ts": "x",
      "routes/home.ts": "x",
    });

    const cwd = String(dir);
    const glob = new Bun.Glob("**/*.ts");
    const results = Array.from(glob.scanSync({ cwd }));

    expect(results).toContain(path.join("api", "health.get.ts"));
    expect(results).toContain(path.join("api", "users", "index.ts"));
    expect(results).toContain(path.join("routes", "home.ts"));
    expect(results.length).toBe(3);
  });

  test("fs.readdirSync with recursive option finds all files", () => {
    using dir = tempDir("issue-24007-readdir", {
      "a/b/c/file.txt": "content",
      "a/b/file.txt": "content",
      "a/file.txt": "content",
      "file.txt": "content",
    });

    const cwd = String(dir);
    const results = fs.readdirSync(cwd, { recursive: true });

    expect(results).toContain("file.txt");
    expect(results).toContain(path.join("a", "file.txt"));
    expect(results).toContain(path.join("a", "b", "file.txt"));
    expect(results).toContain(path.join("a", "b", "c", "file.txt"));
  });

  test("fs.readdirSync with recursive and withFileTypes returns correct types", () => {
    using dir = tempDir("issue-24007-dirent", {
      "dir/subdir/file.txt": "content",
      "dir/another.txt": "content",
    });

    const cwd = String(dir);
    const results = fs.readdirSync(cwd, { recursive: true, withFileTypes: true });

    // Find the nested file in dir/subdir/
    const expectedParent = path.join(cwd, "dir", "subdir");
    const nestedFile = results.find(d => d.name === "file.txt" && d.parentPath === expectedParent);
    expect(nestedFile).toBeDefined();
    expect(nestedFile!.isFile()).toBe(true);

    // Find a directory entry
    const dirEntry = results.find(d => d.name === "subdir");
    expect(dirEntry).toBeDefined();
    expect(dirEntry!.isDirectory()).toBe(true);
  });
});
