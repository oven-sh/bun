import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/37849
// A child that sends an IPC message and then exits must still get the message
// delivered, even when the parent learns of the exit before it polls the IPC
// socket. That is always the case on the waiter-thread process-exit path
// (BUN_FEATURE_FLAG_FORCE_WAITER_THREAD=1, also taken when pidfd is
// unavailable): the exit's deferred socket close used to win against the
// readable event and drop the message.
//
// The fixture makes the race deterministic: the child writes a sentinel file
// after process.send(), and the parent stays off its event loop (blocking in
// spawnSync) until the sentinel exists plus one extra spawnSync, so the child
// has fully exited before the parent processes either event.
const fixture = `
import { existsSync, rmSync } from "node:fs";

const N = 4;
let delivered = 0, lost = 0;
for (let i = 0; i < N; i++) {
  const sentinel = "sentinel-" + i;
  rmSync(sentinel, { force: true });
  const { promise, resolve } = Promise.withResolvers();
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      "-e",
      'process.send("hello"); require("fs").writeFileSync("' + sentinel + '", "x"); Promise.resolve().then(() => process.exit(0));',
    ],
    ipc: resolve,
    stdio: ["inherit", "inherit", "inherit"],
  });
  while (!existsSync(sentinel)) {
    Bun.spawnSync({ cmd: [process.execPath, "-e", "0"] });
  }
  Bun.spawnSync({ cmd: [process.execPath, "-e", "0"] });
  (await Promise.race([promise, Bun.sleep(3000).then(() => "TIMEOUT")])) === "hello" ? delivered++ : lost++;
  await child.exited;
  rmSync(sentinel, { force: true });
}
console.log(JSON.stringify({ delivered, lost }));
`;

async function run(extraEnv: Record<string, string>) {
  using dir = tempDir("ipc-exit-message", { "parent.ts": fixture });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "parent.ts"],
    cwd: String(dir),
    env: { ...bunEnv, ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ delivered: 4, lost: 0 });
  expect(exitCode).toBe(0);
}

test.concurrent.skipIf(isWindows)(
  "ipc message sent right before child exit is delivered (waiter thread)",
  async () => {
    // The feature flag is only read when BUN_GARBAGE_COLLECTOR_LEVEL is set.
    await run({ BUN_GARBAGE_COLLECTOR_LEVEL: "1", BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" });
  },
  30_000,
);

test.concurrent.skipIf(isWindows)(
  "ipc message sent right before child exit is delivered (pidfd)",
  async () => {
    await run({});
  },
  30_000,
);
