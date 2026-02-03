import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/26704
// Child processes should not inherit BUN_INSPECT* environment variables
// to prevent hangs when forking from VSCode's JavaScript Debug Terminal.

test("child_process.spawn does not inherit BUN_INSPECT* env vars", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { spawn } = require("child_process");
      const child = spawn(process.execPath, ["-e", "console.log(JSON.stringify({BUN_INSPECT: process.env.BUN_INSPECT, BUN_INSPECT_CONNECT_TO: process.env.BUN_INSPECT_CONNECT_TO, BUN_INSPECT_NOTIFY: process.env.BUN_INSPECT_NOTIFY}))"], { stdio: "inherit" });
      child.on("exit", (code) => process.exit(code));
      `,
    ],
    env: {
      ...bunEnv,
      BUN_INSPECT: "ws://127.0.0.1:6499",
      BUN_INSPECT_CONNECT_TO: "ws://127.0.0.1:6500",
      BUN_INSPECT_NOTIFY: "ws://127.0.0.1:6501",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const result = JSON.parse(stdout.trim());
  expect(result.BUN_INSPECT).toBeUndefined();
  expect(result.BUN_INSPECT_CONNECT_TO).toBeUndefined();
  expect(result.BUN_INSPECT_NOTIFY).toBeUndefined();
  expect(exitCode).toBe(0);
});

test("child_process.spawnSync does not inherit BUN_INSPECT* env vars", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { spawnSync } = require("child_process");
      const result = spawnSync(process.execPath, ["-e", "console.log(JSON.stringify({BUN_INSPECT: process.env.BUN_INSPECT, BUN_INSPECT_CONNECT_TO: process.env.BUN_INSPECT_CONNECT_TO, BUN_INSPECT_NOTIFY: process.env.BUN_INSPECT_NOTIFY}))"]);
      console.log(result.stdout.toString());
      process.exit(result.status);
      `,
    ],
    env: {
      ...bunEnv,
      BUN_INSPECT: "ws://127.0.0.1:6499",
      BUN_INSPECT_CONNECT_TO: "ws://127.0.0.1:6500",
      BUN_INSPECT_NOTIFY: "ws://127.0.0.1:6501",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const result = JSON.parse(stdout.trim());
  expect(result.BUN_INSPECT).toBeUndefined();
  expect(result.BUN_INSPECT_CONNECT_TO).toBeUndefined();
  expect(result.BUN_INSPECT_NOTIFY).toBeUndefined();
  expect(exitCode).toBe(0);
});

test("child_process filters BUN_INSPECT* even when explicitly passed in options.env", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { spawn } = require("child_process");
      const child = spawn(process.execPath, ["-e", "console.log(JSON.stringify({BUN_INSPECT: process.env.BUN_INSPECT}))"], {
        stdio: "inherit",
        env: { ...process.env, BUN_INSPECT: "explicit-value" }
      });
      child.on("exit", (code) => process.exit(code));
      `,
    ],
    env: {
      ...bunEnv,
      BUN_INSPECT: "ws://127.0.0.1:6499",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const result = JSON.parse(stdout.trim());
  // When user explicitly passes env, the BUN_INSPECT should still be filtered
  // since allowing it would cause the same hang issue
  expect(result.BUN_INSPECT).toBeUndefined();
  expect(exitCode).toBe(0);
});
