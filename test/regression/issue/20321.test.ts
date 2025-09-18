import { expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("spawnSync should not crash when stdout is set to process.stderr (issue #20321)", () => {
  // Test with process.stderr as stdout
  const proc1 = spawnSync(bunExe(), ["-e", 'console.log("hello")'], {
    encoding: "utf-8",
    stdio: ["ignore", process.stderr, "inherit"],
    env: bunEnv,
  });

  expect(proc1.error).toBeUndefined();
  expect(proc1.status).toBe(0);
  // When redirecting to a file descriptor, we don't capture the output
  expect(proc1.stdout).toBeNull();
});

test("spawnSync should not crash when stderr is set to process.stdout", () => {
  // Test with process.stdout as stderr
  const proc2 = spawnSync(bunExe(), ["-e", 'console.log("hello")'], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", process.stdout],
    env: bunEnv,
  });

  expect(proc2.error).toBeUndefined();
  expect(proc2.status).toBe(0);
  expect(proc2.stdout).toBe("hello\n");
  // When redirecting to a file descriptor, we don't capture the output
  expect(proc2.stderr).toBeNull();
});

test("spawnSync should handle process.stdin/stdout/stderr in stdio array", () => {
  // Test with all process streams
  const proc3 = spawnSync(bunExe(), ["-e", 'console.log("test")'], {
    encoding: "utf-8",
    stdio: [process.stdin, process.stdout, process.stderr],
    env: bunEnv,
  });

  expect(proc3.error).toBeUndefined();
  expect(proc3.status).toBe(0);
  // When redirecting to file descriptors, we don't capture the output
  expect(proc3.stdout).toBeNull();
  expect(proc3.stderr).toBeNull();
});

test("spawnSync with mixed stdio options including process streams", () => {
  // Mix of different stdio options
  const proc4 = spawnSync(bunExe(), ["-e", 'console.log("mixed")'], {
    encoding: "utf-8",
    stdio: ["pipe", process.stderr, "pipe"],
    env: bunEnv,
  });

  expect(proc4.error).toBeUndefined();
  expect(proc4.status).toBe(0);
  // stdout redirected to stderr fd, so no capture
  expect(proc4.stdout).toBeNull();
  // stderr is piped, should be empty for echo
  expect(proc4.stderr).toBe("");
});

test("spawnSync should work with file descriptors directly", () => {
  // Test with raw file descriptors (same as what process.stderr resolves to)
  const proc5 = spawnSync(bunExe(), ["-e", 'console.log("fd-test")'], {
    encoding: "utf-8",
    stdio: ["ignore", 2, "inherit"], // 2 is stderr fd
    env: bunEnv,
  });

  expect(proc5.error).toBeUndefined();
  expect(proc5.status).toBe(0);
  expect(proc5.stdout).toBeNull();
});

test("spawnSync should handle the AWS CDK use case", () => {
  // This is the exact use case from AWS CDK that was failing
  const dir = tempDirWithFiles("spawnsync-cdk", {
    "test.js": `console.log("CDK output");`,
  });

  const proc = spawnSync(bunExe(), ["test.js"], {
    encoding: "utf-8",
    stdio: ["ignore", process.stderr, "inherit"],
    cwd: dir,
    env: bunEnv,
  });

  expect(proc.error).toBeUndefined();
  expect(proc.status).toBe(0);
  // Output goes to stderr, not captured
  expect(proc.stdout).toBeNull();
});
