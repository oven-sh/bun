import { spawnSync } from "bun";
import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

it("process.exit(1) works", () => {
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/exit-code-1.js"]);
  expect(exitCode).toBe(1);
});

it("await on a thrown value reports exit code 1", () => {
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/exit-code-await-throw-1.js"]);
  expect(exitCode).toBe(1);
});

it("unhandled promise rejection reports exit code 1", () => {
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/exit-code-unhandled-throw.js"]);
  expect(exitCode).toBe(1);
});

it("handled promise rejection reports exit code 0", () => {
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/exit-code-handled-throw.js"]);
  expect(exitCode).toBe(1);
});

it("process.exit(0) works", () => {
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/exit-code-0.js"]);
  expect(exitCode).toBe(0);
});

it("uncaught exception during top-level await is immediately fatal", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), import.meta.dir + "/exit-code-uncaught-during-tla-fixture.mjs"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Module evaluation must not resume after the default-fatal throw.
  expect(stdout).toBe("");
  expect(stderr).toContain("boom-during-tla");
  expect(exitCode).toBe(1);
});

it("unhandled rejection during top-level await is immediately fatal (#22546)", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), import.meta.dir + "/exit-code-unhandled-rejection-during-tla-fixture.mjs"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(stderr).toContain("rejected-during-tla");
  expect(exitCode).toBe(1);
});

it("uncaught exception during top-level await is survivable with a listener", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), import.meta.dir + "/exit-code-uncaught-during-tla-handled-fixture.mjs"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("caught:boom-during-tla\nmodule-end\n");
  expect(stderr).not.toContain("boom-during-tla");
  expect(exitCode).toBe(0);
});
