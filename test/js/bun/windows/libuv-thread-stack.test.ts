import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "node:path";

const MiB = 1024 * 1024;

/** What a fresh bun process gets when it starts libuv threads, each with a stack size of 8 MiB. */
async function startThreads(how: "pool" | "uv_thread_create_ex", env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "libuv-thread-stack-fixture.ts"), how],
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const { threads, commit, reserve } = JSON.parse(stdout) as { threads: number; commit: number; reserve: number };
  console.log(
    `${how}: ${threads} threads, each with ${Math.round(commit / threads)} bytes committed and ${Math.round(reserve / threads)} reserved`,
  );
  return { threads, commitForEach: commit / threads, reserveForEach: reserve / threads };
}

// Windows takes the stack size of a new thread as the size to commit, unless the thread is created with
// STACK_SIZE_PARAM_IS_A_RESERVATION. Without that flag, a thread that asks for 8 MiB has 8 MiB committed when it
// starts, of the 18 MiB that the header of bun.exe reserves. With it, the thread has 8 MiB reserved, and the commit is
// the one in the header of bun.exe, which is 2 MiB or less.
describe.skipIf(!isWindows)("libuv takes a thread's stack size as the size to reserve, not to commit", () => {
  // libuv starts every thread of its pool at the first request, and aborts when one of them does not start.
  test.concurrent("for the threads of its pool", async () => {
    const poolSize = 16;
    const started = await startThreads("pool", { UV_THREADPOOL_SIZE: String(poolSize) });
    expect(started.threads).toBeGreaterThanOrEqual(poolSize);
    expect(started.commitForEach).toBeLessThan(4 * MiB);
    expect(started.reserveForEach).toBeLessThan(16 * MiB);
  });

  test.concurrent("for a thread from uv_thread_create_ex, which bun.exe exports to native addons", async () => {
    const started = await startThreads("uv_thread_create_ex");
    expect(started.threads).toBeGreaterThanOrEqual(8);
    expect(started.commitForEach).toBeLessThan(4 * MiB);
    expect(started.reserveForEach).toBeLessThan(16 * MiB);
  });
});
