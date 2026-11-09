import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { join } from "node:path";

// The script packs bun-types, installs it into a scratch project, and then
// type-checks it once per preset, which outlives the 5s default that a plain
// `bun test <this file>` (.github/workflows/bun-types.yml) runs with.
const TIMEOUT = 1000 * 60 * 3;

const REPO_ROOT = join(import.meta.dir, "../../..");
const SCRIPT = join(REPO_ROOT, "packages/bun-types/scripts/inventory.ts");

// Every preset of the script, in the order it runs them. A preset that the
// script drops or skips fails the comparison below.
const PRESETS = ["esnext", "esnext-dom", "es2022", "es2022-dom", "no-lib", "test-globals", "vitest-globals"];

async function runInventory(...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), SCRIPT, ...args],
    env: bunEnv,
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// packages/bun-types/scripts/inventory.ts resolves every global and module export
// that bun-types contributes, for each preset, and writes the result to
// ./inventory/<preset>.txt. A change to packages/bun-types that moves what a user
// sees shows up as a diff in those files. When the diff is intended, regenerate
// them with `bun packages/bun-types/scripts/inventory.ts` and commit the result.
//
// Driving the TypeScript checker in-process under a debug build is very slow,
// so this runs on release builds only, like the type-checking cases in
// bun-types.test.ts.
test.concurrent.skipIf(isDebug)(
  "the inventory snapshots match packages/bun-types",
  async () => {
    const { stdout, stderr, exitCode } = await runInventory("--check");

    // On a mismatch stdout carries the diff of each preset that differs.
    expect(stderr).toBe("");
    expect(stdout).toBe(PRESETS.map(preset => `${preset}: ok\n`).join(""));
    expect(exitCode).toBe(0);
  },
  TIMEOUT,
);

test.concurrent.skipIf(isDebug)(
  "--check fails for a snapshot that differs and for a snapshot that is missing",
  async () => {
    const committed = await Bun.file(join(import.meta.dir, "inventory", "test-globals.txt")).text();
    using dir = tempDir("bun-types-inventory", {
      "test-globals.txt": committed + "var notInThePackage: never\n",
    });
    const out = String(dir);

    const { stdout, stderr, exitCode } = await runInventory(
      ...["--check", "--out", out, "--preset", "test-globals", "--preset", "vitest-globals"],
    );

    const lines = stdout.split("\n");
    expect(stderr).toBe("");
    expect(lines[0]).toBe(`test-globals: differs from ${join(out, "test-globals.txt")}`);
    expect(lines).toContain("-var notInThePackage: never");
    expect(lines).toContain(`vitest-globals: ${join(out, "vitest-globals.txt")} does not exist`);
    expect(exitCode).toBe(1);
  },
  TIMEOUT,
);
