import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

async function run(env: Record<string, string>) {
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", "console.log('ok')"], env: { ...bunEnv, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test("mimalloc reads its options from the environment, in either case", async () => {
  const upper = await run({ MIMALLOC_VERBOSE: "1", MIMALLOC_PURGE_DELAY: "123" });
  expect(upper.stderr).toContain("option 'purge_delay': 123");
  expect({ stdout: upper.stdout, exitCode: upper.exitCode }).toEqual({ stdout: "ok\n", exitCode: 0 });
  const lower = await run({ mimalloc_verbose: "1", mimalloc_max_errors: "7" });
  expect(lower.stderr).toContain("option 'max_errors': 7");
  const legacy = await run({ MIMALLOC_VERBOSE: "1", MIMALLOC_RESET_DELAY: "321" });
  expect(legacy.stderr).toContain("option 'purge_delay': 321");
});

test("mimalloc says nothing without options in the environment", async () => {
  expect(await run({ NOT_MIMALLOC_VERBOSE: "1" })).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 });
});
