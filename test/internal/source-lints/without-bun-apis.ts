/**
 * Runs a build script with the Bun APIs disabled: a preload replaces each
 * function on the `Bun` object with one that throws. A script that still calls
 * a Bun API exits with an error. `only` limits this to the named functions.
 *
 * The codegen scripts use this to show that they need only `node:` APIs, a step
 * toward a build that runs them under Node (#6887). The script runs under the
 * bun that runs the test, which is a released bun in the source-lints workflow.
 */
import { bunEnv } from "harness";
import { join } from "node:path";

const preload = join(import.meta.dirname, "without-bun-apis-fixture.ts");

export async function runWithoutBunApis(args: string[], options: { cwd?: string; only?: string[] } = {}) {
  await using proc = Bun.spawn({
    cmd: [process.execPath, "--preload", preload, ...args],
    cwd: options.cwd,
    env: { ...bunEnv, DISABLED_BUN_APIS: options.only?.join(",") ?? "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}
