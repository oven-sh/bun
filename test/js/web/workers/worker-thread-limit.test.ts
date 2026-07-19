// Worker churn at the kernel thread/pids limit used to abort the whole
// process (RELEASE_ASSERT in WTF::Thread::create and PAS_ASSERT in
// bmalloc's pas_scavenger) instead of failing just the affected Worker.
//
// POSIX-only: simulates a cgroup pids.max budget via RLIMIT_NPROC, which
// the kernel ignores for uid 0.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { readdirSync } from "node:fs";

const isRoot = process.getuid?.() === 0;
// `ulimit -u` (RLIMIT_NPROC) is a bash builtin; POSIX sh (dash) rejects -u.
const bash = isLinux ? Bun.which("bash") : null;

// Linux-only: RLIMIT_NPROC counts threads there (the same thing cgroup
// pids.max caps). Skipped under uid 0 since the kernel ignores the limit
// for root, and when bash is unavailable for `ulimit -u`.
test.skipIf(!isLinux || !bash || isRoot)(
  "Worker churn at RLIMIT_NPROC survives instead of aborting",
  async () => {
    const fixture = `
import { mkdtempSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function threadCount() {
  try { return readdirSync("/proc/self/task").length; } catch { return 0; }
}

const w = join(mkdtempSync(join(tmpdir(), "wlim-")), "w.js");
writeFileSync(w, "self.onmessage = e => postMessage(e.data + 1)");

let spawnFailures = 0;
for (let r = 0; r < 8; r++) {
  const ws = [];
  for (let i = 0; i < 4; i++) {
    try { ws.push(new Worker(w)); } catch { spawnFailures++; }
  }
  await Promise.all(
    ws.map(
      x =>
        new Promise<void>(res => {
          const t = setTimeout(res, 1500);
          x.onmessage = () => { clearTimeout(t); res(); };
          x.onerror = () => { clearTimeout(t); res(); };
          x.postMessage(r);
        }),
    ),
  );
  for (const x of ws) x.terminate();
  Bun.gc(true);
}
console.log(JSON.stringify({ ok: true, spawnFailures, threads: threadCount() }));
`;

    using dir = tempDir("worker-thread-limit", { "churn.ts": fixture });

    // RLIMIT_NPROC caps the user's total thread count, so the limit has to
    // accommodate every thread this test process already holds plus enough
    // headroom for the child's own startup. Pick a value that lets the child
    // boot but starves its later Worker/JSC helper spawns; the exact headroom
    // isn't load-bearing because the fixture tolerates every Worker failing.
    let preexisting = 16;
    try {
      preexisting = readdirSync("/proc/self/task").length;
    } catch {}
    const baselineProc = Bun.spawnSync({
      cmd: [
        bunExe(),
        "-e",
        `const {readdirSync}=require("fs");console.log(readdirSync("/proc/self/task").length)`,
      ],
      env: bunEnv,
    });
    const childBaseline = parseInt(baselineProc.stdout.toString().trim(), 10) || 12;
    const limit = preexisting + childBaseline + 4;

    await using proc = Bun.spawn({
      cmd: [bash!, "-c", `ulimit -u ${limit} && exec "$@"`, "bash", bunExe(), "churn.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    // Primary assertion: the process must not have been killed by SIGABRT/SIGTRAP.
    // Before the fix, pthread_create EAGAIN inside JSC/WTF/bmalloc was a
    // RELEASE_ASSERT/PAS_ASSERT and the child died with 134 or 133.
    expect({ stdout, stderr: stderr.slice(-500), exitCode, signalCode: proc.signalCode }).toMatchObject({
      exitCode: 0,
      signalCode: null,
    });
    const result = JSON.parse(stdout.trim().split("\n").pop()!);
    expect(result.ok).toBe(true);
    // Confirm the limit actually bit (some Worker spawns were rejected), so a
    // pass is meaningful and not just "limit too high".
    expect(result.spawnFailures).toBeGreaterThan(0);
  },
);
