import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..", "..", "..");

// `git add` leaves out a new file in a folder that .gitignore matches, and `git status` does not show it, even where the
// files beside it are tracked. A test written into such a folder runs where it was written and never in CI.
test("no tracked file of the compiler or its tests is ignored", () => {
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: ["git", "ls-files", "-z", "--cached", "--ignored", "--exclude-standard", "--", "src/aot", "test/aot"],
    cwd: root,
  });
  expect(stdout.toString().split("\0").filter(Boolean)).toEqual([]);
  expect(exitCode).toBe(0);
});

test("every source file that .prettierignore names is there", () => {
  const named = readFileSync(path.join(root, ".prettierignore"), "utf8")
    .split(/\r?\n/)
    .filter(line => line.startsWith("src/") && !/[*?[]/.test(line));
  expect(named).toContain("src/js/node/repl.ts");
  expect(named.filter(file => !existsSync(path.join(root, file)))).toEqual([]);
});
