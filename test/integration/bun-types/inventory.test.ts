import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";
import { join } from "node:path";

// The script packs bun-types, installs it into a scratch project, and then
// type-checks it once per preset, which outlives the 5s default that a plain
// `bun test <this file>` runs with. Same reason as bun-types.test.ts.
setDefaultTimeout(1000 * 60 * 3);

const REPO_ROOT = join(import.meta.dir, "../../..");
const SCRIPT = join(REPO_ROOT, "packages/bun-types/scripts/inventory.ts");

// Every preset of the script, in the order it runs them. A preset that the
// script drops or skips fails the comparison below.
const PRESETS = ["esnext", "esnext-dom", "es2022", "es2022-dom", "no-lib", "test-globals", "vitest-globals"];

// packages/bun-types/scripts/inventory.ts resolves every global and module export
// that bun-types contributes, for each preset, and writes the result to
// ./inventory/<preset>.txt. A change to packages/bun-types that moves what a user
// sees shows up as a diff in those files. When the diff is intended, regenerate
// them with `bun packages/bun-types/scripts/inventory.ts` and commit the result.
//
// Driving the TypeScript checker in-process under a debug build is very slow,
// so this runs on release builds only, like the type-checking cases in
// bun-types.test.ts.
test.skipIf(isDebug)("the inventory snapshots match packages/bun-types", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), SCRIPT, "--check"],
    env: bunEnv,
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // On a mismatch stdout carries the diff of each preset that differs.
  expect(stderr).toBe("");
  expect(stdout).toBe(PRESETS.map(preset => `${preset}: ok\n`).join(""));
  expect(exitCode).toBe(0);
});
