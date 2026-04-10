// https://github.com/oven-sh/bun/issues/29129
//
// os.availableParallelism() (and navigator.hardwareConcurrency) ignored
// sched_getaffinity / cgroup cpu.max on Linux. On a host with more
// logical CPUs than the process was allowed to use (taskset, cpuset,
// docker --cpus, kubernetes limits, …) bun returned the host count,
// not the effective count — unlike Node.js and libuv's
// uv_available_parallelism().
//
// Anything sizing a worker pool off availableParallelism()
// over-subscribed inside containers: bun's own `bun bd` spawned
// llvm_codegen_threads equal to the host core count regardless of the
// cpuset, producing sustained loadavg >> core-count on shared hosts.
//
// Fix: WTF::numberOfProcessorCores() now popcounts sched_getaffinity()
// and clamps by cgroup cpu.max quota, matching libuv. That value feeds
// navigator.hardwareConcurrency → os.availableParallelism() and also
// JSC's own thread pools.
//
// NOTE: os.cpus().length still returns the host count — that matches
// Node.js (libuv's uv_cpu_info() populates per-CPU stats for every
// logical CPU, it doesn't filter by the affinity mask).

import { spawn, spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";

// Pick a subset of the current affinity mask that's strictly smaller
// than the full mask, so the test is meaningful: there must be at
// least 2 CPUs available to the runner for us to taskset down to 1.
//
// We use /proc/self/status `Cpus_allowed_list` (range list like
// "0-3,8-11") rather than sched_getaffinity(3) — no syscall needed.
function parseCpusAllowedList(): number[] {
  const text = readFileSync("/proc/self/status", "utf8");
  const match = text.match(/^Cpus_allowed_list:\s*(.+)$/m);
  if (!match) return [];
  const out: number[] = [];
  for (const range of match[1]!.split(",")) {
    const [lo, hi] = range.split("-").map(Number);
    for (let i = lo!; i <= (hi ?? lo!); i++) out.push(i);
  }
  return out;
}

test.skipIf(!isLinux)("os.availableParallelism() matches sched_getaffinity (#29129)", () => {
  const allowed = parseCpusAllowedList();
  expect(allowed.length).toBeGreaterThan(0);

  // With the fix, availableParallelism() should match the affinity
  // count, not sysconf(_SC_NPROCESSORS_ONLN). Both may be the same on
  // an unrestricted host — the assertion below is still a valid
  // sanity check in that case.
  expect(availableParallelism()).toBe(allowed.length);
});

test.skipIf(!isLinux)(
  "os.availableParallelism() under taskset reports the restricted count (#29129)",
  async () => {
    const allowed = parseCpusAllowedList();
    if (allowed.length < 2) {
      // Need at least 2 CPUs in the current mask so we can taskset
      // down to a strict subset. Don't fail; the other assertion
      // already covers the unrestricted case.
      return;
    }

    // Use taskset if present. Not every CI image ships it (e.g. some
    // minimal alpine variants), so skip gracefully in that case —
    // the cross-process boundary is extra belt-and-braces on top of
    // the in-process assertion above.
    const which = spawnSync({ cmd: ["sh", "-c", "command -v taskset || true"], env: bunEnv });
    const tasksetPath = which.stdout.toString().trim();
    if (!tasksetPath) return;

    // Pin to the first CPU in the current allowed set. Using an
    // index from the mask (rather than "0") avoids "Invalid
    // argument" inside a cpuset that doesn't include CPU 0.
    const pinCpu = allowed[0]!;

    await using proc = spawn({
      cmd: [
        tasksetPath,
        "-c",
        String(pinCpu),
        bunExe(),
        "-e",
        "console.log(require('os').availableParallelism() + '|' + navigator.hardwareConcurrency)",
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    // Surface stderr in the failure message instead of a bare exit
    // code — much easier to debug.
    if (exitCode !== 0) {
      throw new Error(`bun exited with ${exitCode}\nstderr:\n${stderr}`);
    }

    const [availableStr, hardwareStr] = stdout.trim().split("|");
    const available = Number(availableStr);
    const hardware = Number(hardwareStr);

    // Pinned to exactly one CPU → both must report 1. Pre-fix bun
    // returned the host count (32 on a 32-core host with an 8-core
    // cpuset), which was the whole bug.
    expect(available).toBe(1);
    expect(hardware).toBe(1);
  },
  // Debug+ASAN bun startup on a single CPU can be slow; 60s is
  // generous but prevents flake without masking real hangs.
  60_000,
);
