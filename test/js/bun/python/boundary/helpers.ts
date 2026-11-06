import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { join } from "node:path";

/**
 * Runs one of `fixtures/`. A program that does not end is killed shortly before the limit of the test (the default one of these
 * files): the runner does not kill the children of a test that has timed out if other tests run at the same time.
 */
export const runFixture = (name: string, ...args: string[]) => runFixtureWith({}, name, ...args);

export async function runFixtureWith(env: Record<string, string>, name: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "fixtures", name), ...args],
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
    timeout: isDebug || isASAN ? 115_000 : 4_500,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode: proc.signalCode ?? exitCode };
}
