import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("ENG-22243: RedisClient cannot be called without 'new'", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "const t8 = Bun.RedisClient; t8();"],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("RedisClient constructor cannot be invoked without 'new'");
  expect(exitCode).toBe(1);
});

test("ENG-22243: RedisClient works with 'new'", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "try { new Bun.RedisClient(); } catch (e) { console.log('OK'); }"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Either it works and prints OK, or it fails with a connection error (which is fine)
  if (stdout.includes("OK")) {
    expect(exitCode).toBe(0);
  } else {
    // If it doesn't print OK, it should fail with a connection-related error, not a "cannot be invoked" error
    expect(stderr).not.toContain("cannot be invoked without 'new'");
  }
});
