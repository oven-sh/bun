import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/24339
// tls.getCACertificates('system') should return system certificates
// regardless of --use-system-ca flag or NODE_USE_SYSTEM_CA env var

test("getCACertificates('system') returns system certs without --use-system-ca", async () => {
  // Run without any flags - should still return system certificates
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log(JSON.stringify(require('tls').getCACertificates('system').length))"],
    env: {
      ...bunEnv,
      // Explicitly unset to ensure we're testing the default behavior
      NODE_USE_SYSTEM_CA: undefined,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");

  const count = JSON.parse(stdout.trim());
  // System should have at least some CA certificates installed
  expect(count).toBeGreaterThan(0);
  expect(exitCode).toBe(0);
});

test("getCACertificates('system') returns same certs with and without --use-system-ca", async () => {
  // Get system certs without the flag
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log(JSON.stringify(require('tls').getCACertificates('system').length))"],
    env: {
      ...bunEnv,
      NODE_USE_SYSTEM_CA: undefined,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  // Get system certs with the flag
  await using proc2 = Bun.spawn({
    cmd: [
      bunExe(),
      "--use-system-ca",
      "-e",
      "console.log(JSON.stringify(require('tls').getCACertificates('system').length))",
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout1, stderr1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);
  const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

  expect(stderr1).toBe("");
  expect(stderr2).toBe("");

  const countWithoutFlag = JSON.parse(stdout1.trim());
  const countWithFlag = JSON.parse(stdout2.trim());

  // Both should return the same number of system certificates
  expect(countWithoutFlag).toBe(countWithFlag);
  expect(countWithoutFlag).toBeGreaterThan(0);
  expect(exitCode1).toBe(0);
  expect(exitCode2).toBe(0);
});

test("getCACertificates('default') only includes system certs with --use-system-ca", async () => {
  // Get default certs without the flag
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log(JSON.stringify(require('tls').getCACertificates('default').length))"],
    env: {
      ...bunEnv,
      NODE_USE_SYSTEM_CA: undefined,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  // Get default certs with the flag
  await using proc2 = Bun.spawn({
    cmd: [
      bunExe(),
      "--use-system-ca",
      "-e",
      "console.log(JSON.stringify(require('tls').getCACertificates('default').length))",
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Get default certs with NODE_USE_SYSTEM_CA=1 env var
  await using proc3 = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log(JSON.stringify(require('tls').getCACertificates('default').length))"],
    env: {
      ...bunEnv,
      NODE_USE_SYSTEM_CA: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout1, stderr1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);
  const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);
  const [stdout3, stderr3, exitCode3] = await Promise.all([proc3.stdout.text(), proc3.stderr.text(), proc3.exited]);

  expect(stderr1).toBe("");
  expect(stderr2).toBe("");
  expect(stderr3).toBe("");

  const countWithoutFlag = JSON.parse(stdout1.trim());
  const countWithFlag = JSON.parse(stdout2.trim());
  const countWithEnv = JSON.parse(stdout3.trim());

  // With --use-system-ca, default should include system certs (more certificates)
  expect(countWithFlag).toBeGreaterThan(countWithoutFlag);
  // NODE_USE_SYSTEM_CA=1 should behave the same as --use-system-ca
  expect(countWithEnv).toBe(countWithFlag);
  expect(exitCode1).toBe(0);
  expect(exitCode2).toBe(0);
  expect(exitCode3).toBe(0);
});
