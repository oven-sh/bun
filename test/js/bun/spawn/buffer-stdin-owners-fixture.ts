// Runs one child per owner of a buffer-stdin writer in this process (Bun.spawn,
// Bun.spawnSync, the shell's `< ${buffer}` redirect). Each child prints how many
// stdin bytes it received; the results go out as one "RESULT <json>" line.
// spawn-pipe-start-error.test.ts runs this with BUN_DEBUG_StaticPipeWriter set and
// counts the writers this process creates and frees.
import { $ } from "bun";

const input = Buffer.alloc(4096, "x");
const cmd = [process.execPath, "-e", "console.log((await Bun.stdin.bytes()).length)"];
// The children must neither inherit the fault injection (their own stdio is not
// under test) nor log writer events into the stdout this process is measured by.
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => key !== "BUN_INTERNAL_FAIL_PIPE_WRITER_WRITE" && key !== "BUN_DEBUG_StaticPipeWriter",
  ),
);

const results: Record<string, { stdout: string; exitCode: number }> = {};

{
  await using proc = Bun.spawn({ cmd, env, stdin: input, stdout: "pipe", stderr: "inherit" });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  results.spawn = { stdout: stdout.trim(), exitCode };
}

{
  const { stdout, exitCode } = Bun.spawnSync({ cmd, env, stdin: input, stdout: "pipe", stderr: "inherit" });
  results.spawnSync = { stdout: stdout.toString().trim(), exitCode };
}

{
  const { stdout, exitCode } = await $`${cmd} < ${input}`.env(env).quiet();
  results.shell = { stdout: stdout.toString().trim(), exitCode };
}

console.log("RESULT " + JSON.stringify(results));
