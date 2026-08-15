/**
 * The build system's own typecheck, `bunx tsc --noEmit -p scripts/build/tsconfig.json`
 * from scripts/build/CLAUDE.md. Nothing else in CI runs it, so it used to rot:
 * main accumulated errors in files nobody was editing. The project loads
 * packages/bun-types against the @types/node pinned in the root package.json,
 * so a bun-types change can break it just as well as a build-script change can.
 *
 * This is a lint over the source tree, not a test of the bun under test: tsc
 * runs under node, which takes a couple of seconds regardless of whether the
 * build being tested is a debug or ASAN one (under a debug bun the same run
 * takes minutes). It needs the root devDependencies, so it cannot live in
 * test/internal/source-lints/, whose workflow runs on a bare checkout.
 */
import { expect, test } from "bun:test";
import { bunEnv, isCI, nodeExe } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
// The typescript pinned in the root package.json, which is what `bunx tsc` in
// the repo root runs.
const tsc = join(repoRoot, "node_modules", "typescript", "bin", "tsc");
const node = nodeExe();

// CI always has both: the test runner itself is node and it installs the root
// devDependencies before running anything, so a missing one there is a real
// failure. Locally, skip when either is missing.
test.skipIf(!isCI && (node === null || !existsSync(tsc)))("scripts/build typechecks", async () => {
  if (node === null) throw new Error("node is not on PATH");
  await using proc = Bun.spawn({
    cmd: [node, tsc, "--noEmit", "--pretty", "false", "-p", "scripts/build/tsconfig.json"],
    cwd: repoRoot,
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // tsc lists the errors on stdout; keep it in the assertion so a failure shows
  // them rather than just the exit code.
  expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
});
