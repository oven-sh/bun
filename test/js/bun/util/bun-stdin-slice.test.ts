import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Reading a sliced non-regular file blob (like stdin from a pipe) with a size
// close to Blob.max_size used to overflow when computing the initial read
// buffer capacity.
test("Bun.stdin.slice(1).text() does not crash when stdin is a pipe", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `process.stdout.write(await Bun.stdin.slice(1).text());`],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write("hello world");
  await proc.stdin.end();

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toBe("hello world");
  expect(exitCode).toBe(0);
});

test("Bun.stdin.slice(0, N).text() caps reads at N bytes", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `process.stdout.write(await Bun.stdin.slice(0, 3).text());`],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write("0123456789");
  await proc.stdin.end();

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toBe("012");
  expect(exitCode).toBe(0);
});
