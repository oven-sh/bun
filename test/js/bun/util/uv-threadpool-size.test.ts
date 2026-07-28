import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";

// UV_THREADPOOL_SIZE / GOMAXPROCS controls the worker pool size (clamped to
// [2, 1024]). Values below the floor, zero, or unparseable must clamp to the
// floor (matching libuv's `atoi → if 0 then 1`), not fall through to
// `numberOfProcessorCores()`.
//
// Counting live pool threads requires /proc/self/task, so this is Linux-only.
describe.skipIf(!isLinux)("UV_THREADPOOL_SIZE", () => {
  // Flood the pool with slow CPU jobs, then poll /proc/self/task until the
  // "Bun Pool" thread count is stable across several reads. Exits without
  // waiting for the jobs to finish.
  const script = /* js */ `
    const fs = require("node:fs");
    const crypto = require("node:crypto");
    for (let i = 0; i < 32; i++)
      crypto.pbkdf2("p" + i, "s", 1 << 20, 32, "sha256", () => {});
    const count = () => {
      let n = 0;
      for (const tid of fs.readdirSync("/proc/self/task"))
        try {
          if (fs.readFileSync("/proc/self/task/" + tid + "/comm", "utf8").startsWith("Bun Pool"))
            n++;
        } catch {}
      return n;
    };
    let last = -1, stable = 0;
    const iv = setInterval(() => {
      const n = count();
      if (n === last && n > 0) stable++;
      else { stable = 0; last = n; }
      if (stable >= 5) {
        clearInterval(iv);
        console.log(n);
        process.exit(0);
      }
    }, 20);
  `;

  async function poolThreads(env: Record<string, string | undefined>) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, UV_THREADPOOL_SIZE: undefined, GOMAXPROCS: undefined, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return Number(stdout.trim());
  }

  test.concurrent("=1 clamps to floor (2), does not fall through to core count", async () => {
    expect(await poolThreads({ UV_THREADPOOL_SIZE: "1" })).toBe(2);
  });

  test.concurrent("=0 clamps to floor (2)", async () => {
    expect(await poolThreads({ UV_THREADPOOL_SIZE: "0" })).toBe(2);
  });

  test.concurrent("unparseable clamps to floor (2)", async () => {
    expect(await poolThreads({ UV_THREADPOOL_SIZE: "abc" })).toBe(2);
  });

  test.concurrent("=4 is honoured exactly", async () => {
    expect(await poolThreads({ UV_THREADPOOL_SIZE: "4" })).toBe(4);
  });

  test.concurrent("=999999 caps at ceiling, does not collapse to floor", async () => {
    expect(await poolThreads({ UV_THREADPOOL_SIZE: "999999" })).toBeGreaterThan(4);
  });

  test.concurrent("GOMAXPROCS=1 clamps to floor (2)", async () => {
    expect(await poolThreads({ GOMAXPROCS: "1" })).toBe(2);
  });
});
