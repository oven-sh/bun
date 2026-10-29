import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// libuv starts every thread of its pool at the first request and asks for an 8 MB stack for each. Windows takes a
// stack size as the amount to commit, unless the thread is created with STACK_SIZE_PARAM_IS_A_RESERVATION. So the
// pool charged 8 MB for each of its threads against the commit limit before any of them ran, and libuv aborts when
// one of them does not start.
test.skipIf(!isWindows)("a libuv pool thread reserves its stack and commits it as it touches it", async () => {
  const poolSize = 16;
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        import { dlopen } from "bun:ffi";
        import { statfs } from "node:fs";

        const { symbols: kernel32 } = dlopen("kernel32.dll", {
          CreateToolhelp32Snapshot: { args: ["u32", "u32"], returns: "u64" },
          Thread32First: { args: ["u64", "ptr"], returns: "i32" },
          Thread32Next: { args: ["u64", "ptr"], returns: "i32" },
          CloseHandle: { args: ["u64"], returns: "i32" },
        });
        function threadCount() {
          const TH32CS_SNAPTHREAD = 4;
          const snapshot = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
          // THREADENTRY32: dwSize, cntUsage, th32ThreadID, th32OwnerProcessID, and 12 bytes that are not read here.
          const entry = Buffer.alloc(28);
          entry.writeUInt32LE(entry.length, 0);
          let count = 0;
          for (let more = kernel32.Thread32First(snapshot, entry); more; more = kernel32.Thread32Next(snapshot, entry))
            if (entry.readUInt32LE(12) === process.pid) count++;
          kernel32.CloseHandle(snapshot);
          return count;
        }

        // Once before the baseline, so that a thread the first count itself starts is not taken for one of the pool.
        threadCount();
        const threadsBefore = threadCount();
        // Bun.unsafe.memoryFootprint() is the process's commit charge on Windows (PrivateUsage).
        const commitBefore = Bun.unsafe.memoryFootprint();
        // An fs request with a callback goes to libuv's pool, which starts all of its threads before this returns.
        statfs(".", () => {});
        const commit = Bun.unsafe.memoryFootprint() - commitBefore;
        console.log(JSON.stringify({ threads: threadCount() - threadsBefore, commit }));
      `,
    ],
    env: { ...bunEnv, UV_THREADPOOL_SIZE: String(poolSize) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { threads, commit } = JSON.parse(stdout);
  console.log(`libuv pool start: ${threads} threads, ${Math.round(commit / threads)} bytes of commit for each`);
  expect(threads).toBeGreaterThanOrEqual(poolSize);
  // A start with a reserved stack commits what the header of bun.exe says, which is 2 MB or less.
  expect(commit / threads).toBeLessThan(4 * 1024 * 1024);
  expect(exitCode).toBe(0);
});
