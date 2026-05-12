import { $ } from "bun";
import { bunEnv, bunExe } from "harness";

test("child_process ipc", async () => {
  const output = await $`${bunExe()} ${import.meta.dir}/fixtures/ipc_fixture.js`.text();
  // node (v23.4.0) has identical output
  expect(output).toMatchInlineSnapshot(`
    "Parent received: {"status":"Child process started"}
    Child process exited with code 0
    send returned false
    uncaughtException ERR_IPC_CHANNEL_CLOSED
    cb ERR_IPC_CHANNEL_CLOSED
    "
  `);
});

// https://github.com/oven-sh/bun/issues/30569
test("process.send() returns false under IPC backpressure", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), import.meta.dir + "/fixtures/ipc-backpressure-fixture.js"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // `bunEnv` enables ASAN in debug builds, which prints one-off warnings to
  // stderr on some hosts. Strip those before asserting the child was silent.
  const stderrLines = stderr
    .split("\n")
    .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  expect(stderrLines).toBe("");

  expect(stdout).not.toContain("NEVER_BACKPRESSURED");
  // Child ran out of kernel buffer and process.send() returned false.
  const firstFalse = stdout.match(/firstFalseAt=(\d+)/);
  expect(firstFalse).not.toBeNull();
  expect(Number(firstFalse[1])).toBeGreaterThan(0);
  // The drain callback (3rd arg to process.send) fired, which is the only
  // way the child could unref the channel and exit cleanly.
  expect(stdout).toContain("drained");
  const drained = stdout.match(/drained maxCount=(\d+) falseReturns=(\d+)/);
  expect(drained).not.toBeNull();
  expect(Number(drained[2])).toBeGreaterThan(0);
  // The parent received every message the child sent.
  const parent = stdout.match(/parent received=(\d+) exit=0/);
  expect(parent).not.toBeNull();
  expect(Number(parent[1])).toBe(Number(drained[1]));

  expect(exitCode).toBe(0);
});
