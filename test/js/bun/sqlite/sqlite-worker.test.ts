import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// The process-global list of open SQLite databases is a WTF::Vector that is
// appended to on open() and indexed on every operation. When the main thread
// and Workers open databases concurrently, append() can realloc the backing
// storage while another thread is dereferencing an element, producing a
// heap-use-after-free under ASAN. With the lock in place this completes
// cleanly.
test("bun:sqlite databases opened concurrently from Workers do not race", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "sqlite-worker-concurrent-open-fixture.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
}, 60_000);
