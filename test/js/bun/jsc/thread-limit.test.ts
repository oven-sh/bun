import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";
import { readdirSync, readFileSync } from "node:fs";

// On Linux, threads count toward RLIMIT_NPROC (the same counter a cgroup
// pids.max enforces). The kernel does not enforce the limit for root, so a
// root test runner drops to `nobody` through runuser.
const isRoot = process.getuid?.() === 0;
const hasPrlimit = isLinux && !!Bun.which("prlimit");
const nobodyUid = (() => {
  if (!isLinux || !isRoot || !Bun.which("runuser")) return undefined;
  const uid = readFileSync("/etc/passwd", "utf8")
    .split("\n")
    .find(line => line.startsWith("nobody:"))
    ?.split(":")[2];
  return uid === undefined ? undefined : Number(uid);
})();
const canLimitThreads = hasPrlimit && (!isRoot || nobodyUid !== undefined);

/** Threads that already belong to `uid`. RLIMIT_NPROC is per uid, not per process. */
function threadsOwnedBy(uid: number): number {
  let total = 0;
  for (const pid of readdirSync("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    let status: string;
    try {
      status = readFileSync(`/proc/${pid}/status`, "utf8");
    } catch {
      continue;
    }
    const owner = status.match(/^Uid:\s+(\d+)/m);
    if (!owner || Number(owner[1]) !== uid) continue;
    const threads = status.match(/^Threads:\s+(\d+)/m);
    total += threads ? Number(threads[1]) : 1;
  }
  return total;
}

/** Runs `script` in a bun whose uid may own `extraThreads` threads more than it does now. */
function spawnWithThreadLimit(extraThreads: number, script: string) {
  const uid = isRoot ? nobodyUid! : process.getuid!();
  const limit = threadsOwnedBy(uid) + extraThreads;
  const cmd = [Bun.which("prlimit")!, `--nproc=${limit}`, bunExe(), "-e", script];
  if (isRoot) cmd.unshift(Bun.which("runuser")!, "-u", "nobody", "--");
  return Bun.spawn({
    cmd,
    env: {
      ...bunEnv,
      // `nobody` has no writable home.
      HOME: "/tmp",
      // LeakSanitizer needs a tracer thread at exit, which this limit refuses.
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

test.skipIf(!canLimitThreads)("a loop that tiers up under a thread limit does not abort the process", async () => {
  // Room for the main thread only. The first hot loop asks the JIT worklist
  // for a compiler thread, which the OS refuses. The code keeps running in
  // the interpreter.
  await using proc = spawnWithThreadLimit(
    1,
    `
    let sum = 0;
    for (let i = 0; i < 200000; i++) sum += i % 7;
    console.log(sum);
  `,
  );
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("599994\n");
  expect(exitCode, stderr).toBe(0);
});

test.skipIf(!canLimitThreads)("a GC under a thread limit does not abort the process", async () => {
  // Room for the main thread only. The GC's parallel markers and the
  // collector thread get no thread, so a synchronous GC has to finish on the
  // main thread. The heap has to be big enough for the collector to ask for
  // markers.
  await using proc = spawnWithThreadLimit(
    1,
    `
    let keep = [];
    for (let i = 0; i < 200; i++) {
      keep.push(new Array(10000).fill({ i }));
      if (i % 50 === 0) keep = [];
    }
    Bun.gc(true);
    console.log("ok");
  `,
  );
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("ok\n");
  expect(exitCode, stderr).toBe(0);
});

test.skipIf(!canLimitThreads)("child_process.spawnSync under a thread limit reports EAGAIN", async () => {
  // The scenario from the report: a process that is already hot asks for a
  // child while it cannot create one. The spawn reports EAGAIN, the process
  // does not abort.
  await using proc = spawnWithThreadLimit(
    1,
    `
    const { spawnSync } = require("node:child_process");
    let sum = 0;
    for (let i = 0; i < 200000; i++) sum += i % 7;
    const result = spawnSync("true");
    console.log(JSON.stringify({ sum, error: result.error?.code ?? null }));
  `,
  );
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(JSON.parse(stdout)).toEqual({ sum: 599994, error: "EAGAIN" });
  expect(exitCode, stderr).toBe(0);
});
