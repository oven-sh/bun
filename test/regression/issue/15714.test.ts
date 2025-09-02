import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

test("shell: piping assignments into command should not crash (issue #15714)", async () => {
  // Test the exact case from the issue
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "exec", "FOO=bar BAR=baz | echo hi"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout1, stderr1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);

  expect(exitCode1).toBe(0);
  expect(normalizeBunSnapshot(stdout1)).toMatchInlineSnapshot(`"hi"`);
  expect(stderr1).toBe("");

  // Test with multiple assignments
  await using proc2 = Bun.spawn({
    cmd: [bunExe(), "exec", "A=1 B=2 C=3 | echo test"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

  expect(exitCode2).toBe(0);
  expect(normalizeBunSnapshot(stdout2)).toMatchInlineSnapshot(`"test"`);
  expect(stderr2).toBe("");

  // Test with single assignment
  await using proc3 = Bun.spawn({
    cmd: [bunExe(), "exec", "FOO=bar | echo single"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout3, stderr3, exitCode3] = await Promise.all([proc3.stdout.text(), proc3.stderr.text(), proc3.exited]);

  expect(exitCode3).toBe(0);
  expect(normalizeBunSnapshot(stdout3)).toMatchInlineSnapshot(`"single"`);
  expect(stderr3).toBe("");

  // Test assignments in middle of pipeline
  await using proc4 = Bun.spawn({
    cmd: [bunExe(), "exec", "echo start | FOO=bar BAR=baz | echo end"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout4, stderr4, exitCode4] = await Promise.all([proc4.stdout.text(), proc4.stderr.text(), proc4.exited]);

  expect(exitCode4).toBe(0);
  expect(normalizeBunSnapshot(stdout4)).toMatchInlineSnapshot(`"end"`);
  expect(stderr4).toBe("");
});
