import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";

$.nothrow();

const ENOENT = "mkdir: No such file or directory\n";

describe.concurrent("bunshell mkdir", () => {
  // An empty operand used to be joined onto the shell's cwd, which resolved to
  // the cwd itself: `mkdir ""` reported the cwd as existing and `mkdir -p ""`
  // exited 0.
  test.each([
    ['mkdir ""', () => $`mkdir ""`],
    ['mkdir ${""}', () => $`mkdir ${""}`],
    ['mkdir -p ""', () => $`mkdir -p ""`],
    ['mkdir -pv ""', () => $`mkdir -pv ""`],
    ['mkdir -v ""', () => $`mkdir -v ""`],
  ])("%s fails with ENOENT", async (_name, command) => {
    using dir = tempDir("mkdir-empty", {});
    const cwd = String(dir);

    const { stdout, stderr, exitCode } = await command().cwd(cwd).quiet();

    expect(stdout.toString()).toBe("");
    expect(stderr.toString()).toBe(ENOENT);
    expect(exitCode).toBe(1);
    expect(readdirSync(cwd)).toEqual([]);
  });

  test("the other operands are still created when one is empty", async () => {
    using dir = tempDir("mkdir-empty-multi", {});
    const cwd = String(dir);

    const { stdout, stderr, exitCode } = await $`mkdir -p a "" b/c`.cwd(cwd).quiet();

    expect(stdout.toString()).toBe("");
    expect(stderr.toString()).toBe(ENOENT);
    expect(exitCode).toBe(1);
    expect(readdirSync(cwd).sort()).toEqual(["a", "b"]);
    expect(readdirSync(join(cwd, "b"))).toEqual(["c"]);
  });
});
