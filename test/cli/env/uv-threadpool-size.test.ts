import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { join } from "node:path";

// The thread count every pool is sized from: the work pool, the bundler, the package manager.
describe("UV_THREADPOOL_SIZE and GOMAXPROCS", () => {
  // With neither variable the count is the CPU count. It is pinned here, so a
  // value that does not count reads as 7 on every machine.
  const env = {
    ...bunEnv,
    JOBS: undefined,
    UV_THREADPOOL_SIZE: undefined,
    GOMAXPROCS: undefined,
    WTF_numberOfProcessorCores: "7",
  };

  // `bun install` gives the count to lifecycle scripts as JOBS when it is above 2.
  async function threadCount(vars: Record<string, string>): Promise<number> {
    using dir = tempDir("thread-count", {
      "package.json": JSON.stringify({
        name: "thread-count",
        version: "1.0.0",
        scripts: { postinstall: "echo JOBS=$JOBS > jobs.txt" },
      }),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: { ...env, ...vars },
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) throw new Error(`bun install exited with ${exitCode}: ${stderr}`);
    const jobs = (await Bun.file(join(String(dir), "jobs.txt")).text()).trim().slice("JOBS=".length);
    return jobs === "" ? 2 : Number(jobs);
  }

  const givesThreads = async (vars: Record<string, string>, threads: number) => {
    expect(await threadCount(vars)).toBe(threads);
  };

  test.concurrent.each([
    // Below 2, or no digits in front: the floor, as libuv gives its floor.
    [{ UV_THREADPOOL_SIZE: "1" }, 2],
    [{ UV_THREADPOOL_SIZE: "0" }, 2],
    [{ UV_THREADPOOL_SIZE: "abc" }, 2],
    // The low end of the range, and one past it.
    [{ UV_THREADPOOL_SIZE: "2" }, 2],
    [{ UV_THREADPOOL_SIZE: "3" }, 3],
    // libuv reads the digits in front.
    [{ UV_THREADPOOL_SIZE: "8abc" }, 8],
    [{ UV_THREADPOOL_SIZE: "4.5" }, 4],
    [{ UV_THREADPOOL_SIZE: " 6 " }, 6],
    // An empty value is not set.
    [{ UV_THREADPOOL_SIZE: "" }, 7],
    [{ UV_THREADPOOL_SIZE: " " }, 7],
    [{ UV_THREADPOOL_SIZE: "", GOMAXPROCS: "5" }, 5],
    // Go ignores a GOMAXPROCS that is not a positive integer.
    [{ GOMAXPROCS: "1" }, 2],
    [{ GOMAXPROCS: "4" }, 4],
    [{ GOMAXPROCS: "0" }, 7],
    [{ GOMAXPROCS: "-3" }, 7],
    [{ GOMAXPROCS: "abc" }, 7],
    [{ GOMAXPROCS: "8abc" }, 7],
    // Above the range: the high end.
    [{ GOMAXPROCS: "1025" }, 1024],
    [{ GOMAXPROCS: "65536" }, 1024],
    // libuv ignores a value of 16 bytes or more, so this one starts no extra threads on Windows.
    [{ UV_THREADPOOL_SIZE: "99999999999999999999" }, 1024],
    // UV_THREADPOOL_SIZE comes first.
    [{ UV_THREADPOOL_SIZE: "8", GOMAXPROCS: "3" }, 8],
    [{ UV_THREADPOOL_SIZE: "1", GOMAXPROCS: "4" }, 2],
    [{ UV_THREADPOOL_SIZE: "abc", GOMAXPROCS: "4" }, 2],
    // A CPU count that does not fit in 16 bits.
    [{ WTF_numberOfProcessorCores: "65540" }, 1024],
  ])("%j gives %d threads", givesThreads);

  // Not on Windows. libuv is in the process there and reads each of these as
  // 1024: it starts that many threads at once and commits 8 MB of stack for each.
  test.skipIf(isWindows).concurrent.each([
    [{ UV_THREADPOOL_SIZE: "-3" }, 2],
    [{ UV_THREADPOOL_SIZE: "1024" }, 1024],
    [{ UV_THREADPOOL_SIZE: "1025" }, 1024],
    [{ UV_THREADPOOL_SIZE: "65535" }, 1024],
    [{ UV_THREADPOOL_SIZE: "65536" }, 1024],
  ])("%j gives %d threads", givesThreads);

  // The work pool itself: its threads after 16 jobs. A job runs long enough
  // for the pool to start every thread it may have before the jobs run out.
  // Not concurrent: each child starts a JS VM and keeps 2 threads busy. Beside
  // the rows above, one took 4.4 s of the 5 s default timeout on a debug build.
  const countPoolThreads = /* js */ `
    const { pbkdf2 } = require("node:crypto");
    const { readdirSync, readFileSync } = require("node:fs");
    let left = 16;
    for (let i = 0; i < 16; i++) {
      pbkdf2("password" + i, "salt", 50_000, 32, "sha256", err => {
        if (err) throw err;
        if (--left) return;
        let threads = 0;
        for (const tid of readdirSync("/proc/self/task")) {
          try {
            if (readFileSync("/proc/self/task/" + tid + "/comm", "utf8").startsWith("Bun Pool")) threads++;
          } catch {}
        }
        console.log(threads);
      });
    }
  `;
  test
    .skipIf(!isLinux)
    .each([
      { UV_THREADPOOL_SIZE: "1" },
      { UV_THREADPOOL_SIZE: "0" },
      { UV_THREADPOOL_SIZE: "abc" },
      { GOMAXPROCS: "1" },
      { WTF_numberOfProcessorCores: "1" },
    ])("the work pool starts 2 threads with %j", async vars => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", countPoolThreads],
      env: { ...env, ...vars },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ threads: stdout.trim(), stderr, exitCode }).toEqual({ threads: "2", stderr: "", exitCode: 0 });
  });
});
