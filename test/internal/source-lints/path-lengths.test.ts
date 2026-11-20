import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..", "..", "..");

// Where long paths are not switched on, git on Windows cannot create a folder whose whole path has 248 characters or more,
// and the folder that the repository is cloned into counts: the checkout fails.
test("no path of the repository has over 200 characters", () => {
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    cwd: root,
  });
  const paths = stdout.toString().split("\0").filter(Boolean);
  expect(paths.filter(file => file.length > 200 && existsSync(path.join(root, file)))).toEqual([]);
  expect(paths.length).toBeGreaterThan(10_000);
  expect(exitCode).toBe(0);
});
