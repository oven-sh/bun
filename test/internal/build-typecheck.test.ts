/**
 * The build system's own typecheck, `bunx tsc --noEmit -p scripts/build/tsconfig.json`
 * from scripts/build/CLAUDE.md. Nothing else in CI runs it, so it used to rot:
 * main accumulated errors in files nobody was editing. The project loads
 * packages/bun-types against the @types/node pinned in the root package.json,
 * so a bun-types change can break it just as well as a build-script change can.
 */
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isCI, nodeExe } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
// The typescript pinned in the root package.json, which is what `bunx tsc` in
// the repo root runs. CI installs the root devDependencies before the tests
// run; locally, skip when they are not installed.
const tsc = join(repoRoot, "node_modules", "typescript", "bin", "tsc");

test.skipIf(!isCI && !existsSync(tsc))("scripts/build typechecks", async () => {
  await using proc = Bun.spawn({
    // tsc is plain JavaScript. Prefer node so the check takes the same few
    // seconds under a debug or ASAN build of bun as under a release build.
    cmd: [nodeExe() ?? bunExe(), tsc, "--noEmit", "--pretty", "false", "-p", "scripts/build/tsconfig.json"],
    cwd: repoRoot,
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // tsc lists the errors on stdout; keep it in the assertion so a failure shows
  // them rather than just the exit code.
  expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
});
