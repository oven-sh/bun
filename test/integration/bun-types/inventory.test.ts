import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";
import { join } from "node:path";

// The script packs bun-types, installs it into a scratch project, and then
// type-checks it five times, which outlives the 5s default that a plain
// `bun test <this file>` runs with. Same reason as bun-types.test.ts.
setDefaultTimeout(1000 * 60 * 3);

const REPO_ROOT = join(import.meta.dir, "../../..");
const SCRIPT = join(REPO_ROOT, "packages/bun-types/scripts/inventory.ts");

// packages/bun-types/scripts/inventory.ts resolves every global and module export
// that bun-types contributes, for each `lib` preset, and writes the result to
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

  if (exitCode !== 0) {
    console.log(stdout);
    console.log(stderr);
  }
  expect(stdout).not.toContain("differs from");
  expect(exitCode).toBe(0);
});
