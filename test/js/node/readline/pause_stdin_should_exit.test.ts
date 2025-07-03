import { bunEnv, bunExe } from "harness";

function prettyReadResult(result: { done: boolean; value?: Uint8Array }): { done: boolean; value: string | undefined } {
  return { done: result.done, value: result.value ? new TextDecoder().decode(result.value) : undefined };
}

test("pause stdin should exit", async () => {
  // can't use spawnSync because it doesn't provide any stdin
  const result2 = Bun.spawn({
    cmd: [bunExe(), "test/js/node/readline/pause_stdin_should_exit.js"],
    env: bunEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });
  await result2.exited;
  const stdout = await result2.stdout.getReader().read();
  const stderr = await result2.stderr.getReader().read();
  expect(prettyReadResult(stdout)).toEqual({ done: false, value: "pause\nresume\n" });
  expect(prettyReadResult(stderr)).toEqual({ done: true, value: undefined });
});
