/**
 * The build-directory lock (scripts/build/build-lock.ts): numbered files, the highest number is the lock, held
 * while any process it names is alive. What must hold: one holder at a time, a dead holder's lock passes on, a
 * process the holder added (ninja) keeps it held after the driver is gone, and a late contender cannot take a
 * live lock away by creating a lower number.
 */
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { tryLockBuildDir } from "../../scripts/build/build-lock.ts";
import { processStartTime } from "../../scripts/build/proc.ts";

const lockFiles = (dir: string) => readdirSync(dir).filter(f => f.startsWith("build.lock."));
const thisProcess = `${process.pid} ${processStartTime(process.pid)}`;

test("one holder at a time; a released lock passes to the next number", () => {
  using dir = tempDir("build-lock", {});
  const first = tryLockBuildDir(String(dir));
  expect(first).toBeDefined();
  expect(readFileSync(join(String(dir), "build.lock.1"), "utf8")).toBe(thisProcess);
  expect(tryLockBuildDir(String(dir))).toBeUndefined();

  first!.release();
  expect(readFileSync(join(String(dir), "build.lock.1"), "utf8")).toBe("released");
  const second = tryLockBuildDir(String(dir));
  expect(second).toBeDefined();
  expect(lockFiles(String(dir))).toEqual(["build.lock.2"]);
  second!.release();
});

test("a lock whose holder is gone is passed on, and one whose pid was reused is too", () => {
  using dir = tempDir("build-lock-stale", {});
  // A pid that cannot be running, and this process's pid with another process's start time.
  writeFileSync(join(String(dir), "build.lock.7"), `4194999 Thu Jan  1 00:00:00 1970`);
  const afterDead = tryLockBuildDir(String(dir));
  expect(afterDead).toBeDefined();
  expect(lockFiles(String(dir))).toEqual(["build.lock.8"]);
  afterDead!.release();

  writeFileSync(join(String(dir), "build.lock.9"), `${process.pid} not-this-process's-start-time`);
  const afterReused = tryLockBuildDir(String(dir));
  expect(afterReused).toBeDefined();
  expect(lockFiles(String(dir))).toEqual(["build.lock.10"]);
  afterReused!.release();
});

test("a process the holder added keeps the lock held after the holder itself is gone", async () => {
  using dir = tempDir("build-lock-child", {});
  // Stands in for ninja: alive until its stdin closes.
  await using child = Bun.spawn({
    cmd: [bunExe(), "-e", "process.stdin.on('data', () => {}); process.stdin.on('end', () => process.exit(0));"],
    env: bunEnv,
    stdin: "pipe",
    stdout: "ignore",
    stderr: "inherit",
  });
  // The lock as a driver that died without releasing leaves it: itself (dead) and the process it added.
  writeFileSync(
    join(String(dir), "build.lock.3"),
    [`4194999 Thu Jan  1 00:00:00 1970`, `${child.pid} ${processStartTime(child.pid)}`].join("\n"),
  );
  expect(tryLockBuildDir(String(dir))).toBeUndefined();

  child.stdin.end();
  expect(await child.exited).toBe(0);
  const next = tryLockBuildDir(String(dir));
  expect(next).toBeDefined();
  expect(lockFiles(String(dir))).toEqual(["build.lock.4"]);
  next!.release();
});

test("addHolder records the process next to the driver", () => {
  using dir = tempDir("build-lock-add", {});
  const lock = tryLockBuildDir(String(dir))!;
  lock.addHolder(process.ppid);
  expect(readFileSync(join(String(dir), "build.lock.1"), "utf8")).toBe(
    [thisProcess, `${process.ppid} ${processStartTime(process.ppid)}`].join("\n"),
  );
  lock.release();
});

test("a number below the current lock is not a lock", () => {
  using dir = tempDir("build-lock-late", {});
  // The current lock is number 5, held by this process; a contender that listed the directory when 3 was the
  // highest creates 4 afterwards. Only the highest number counts, so the live lock stands.
  writeFileSync(join(String(dir), "build.lock.5"), thisProcess);
  writeFileSync(join(String(dir), "build.lock.4"), `4194999 Thu Jan  1 00:00:00 1970`);
  expect(tryLockBuildDir(String(dir))).toBeUndefined();
  expect(readFileSync(join(String(dir), "build.lock.5"), "utf8")).toBe(thisProcess);
});

test("contending processes are never inside the lock together", async () => {
  using dir = tempDir("build-lock-contend", {
    "contender.ts": `
      import { mkdirSync, rmdirSync } from "node:fs";
      import { join } from "node:path";
      import { tryLockBuildDir } from ${JSON.stringify(join(import.meta.dir, "../../scripts/build/build-lock.ts"))};
      const dir = process.argv[2];
      const inside = join(dir, "inside");
      let turns = 0;
      while (turns < 15) {
        const lock = tryLockBuildDir(dir);
        if (lock === undefined) continue;
        mkdirSync(inside); // throws if another process is inside
        await Bun.sleep(1);
        rmdirSync(inside);
        lock.release();
        turns++;
      }
      console.log("done", turns);
    `,
  });
  const procs = Array.from({ length: 6 }, () =>
    Bun.spawn({
      cmd: [bunExe(), join(String(dir), "contender.ts"), String(dir)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    }),
  );
  const results = await Promise.all(
    procs.map(async p => [await p.stdout.text(), await p.stderr.text(), await p.exited] as const),
  );
  for (const [stdout, stderr, exitCode] of results) {
    expect(stderr).toBe("");
    expect(stdout).toBe("done 15\n");
    expect(exitCode).toBe(0);
  }
});
