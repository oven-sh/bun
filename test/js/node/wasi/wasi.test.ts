import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

test("fd_pread reports nread equal to bytes read", async () => {
  using dir = tempDir("wasi-fd-pread", {
    "f.txt": "abcdefgh",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--no-warnings", path.join(import.meta.dir, "fd_pread-fixture.mjs"), String(dir)],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const lines = stdout.trim().split("\n").map(l => JSON.parse(l));
  expect(lines).toEqual([
    { case: "single-iovec", errno: 0, nread: 6, data: "abcdef" },
    { case: "two-iovecs", errno: 0, nread: 6, data: "abcdef" },
    { case: "short-read", errno: 0, nread: 8, data: "abcdefgh" },
  ]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
