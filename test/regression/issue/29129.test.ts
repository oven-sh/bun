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
import { existsSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";

// Parse the process's CPU affinity mask from /proc/self/status's
// `Cpus_allowed_list` field (range list like "0-3,8-11"). Faster than
// spawning `taskset -p` and avoids a syscall for sched_getaffinity(3).
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

// Read the cgroup CPU quota for the current process, walking the
// hierarchy the same way libuv's uv__get_constrained_cpu() does. Returns
// `Infinity` when no limit is set (typical bare-metal / unrestricted
// containers) or when /proc/self/cgroup can't be read. Otherwise returns
// the floor of cpu.max's `limit / period` (so the caller can take a min
// against the affinity count).
//
// This is meant to mirror Bun's own clamping logic: the test passes when
// `availableParallelism() === min(affinity, cgroupQuota)`, the same
// invariant libuv enforces via uv_available_parallelism().
function readCgroupCpuQuota(): number {
  let cgroup: string;
  try {
    cgroup = readFileSync("/proc/self/cgroup", "utf8");
  } catch {
    return Infinity;
  }

  const slurp = (path: string): string | null => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  };

  // cgroup v2: "0::/my/path\n". Walk upwards, each level can further
  // constrain cpu.max — the binding takes the min of every populated
  // quota in the ancestry chain.
  if (cgroup.startsWith("0::/")) {
    let rel = cgroup.slice("0::/".length);
    const nl = rel.indexOf("\n");
    if (nl >= 0) rel = rel.slice(0, nl);

    let min = Infinity;
    let path = `/sys/fs/cgroup/${rel}`;
    const mount = "/sys/fs/cgroup";
    while (path.startsWith(mount)) {
      const buf = slurp(`${path}/cpu.max`);
      if (buf !== null && !buf.startsWith("max")) {
        const parts = buf.trim().split(/\s+/);
        const limit = Number(parts[0]);
        const period = Number(parts[1]);
        if (Number.isFinite(limit) && Number.isFinite(period) && period > 0) {
          const q = Math.max(1, Math.floor(limit / period));
          if (q < min) min = q;
        }
      }
      if (path === mount) break;
      const lastSlash = path.lastIndexOf("/");
      if (lastSlash < 0) break;
      path = path.slice(0, lastSlash);
    }
    return min;
  }

  // cgroup v1: each line is "<id>:<controllers>:<path>" where
  // controllers is a comma-separated list. We need the line whose
  // controller list contains "cpu" (order-independent: both
  // "cpu,cpuacct" and "cpuacct,cpu" are valid).
  for (const line of cgroup.split("\n")) {
    const firstColon = line.indexOf(":");
    if (firstColon < 0) continue;
    const secondColon = line.indexOf(":", firstColon + 1);
    if (secondColon < 0) continue;
    const controllers = line.slice(firstColon + 1, secondColon).split(",");
    if (!controllers.includes("cpu")) continue;
    // Path starts with a leading "/"; strip it so the template below
    // doesn't produce a double slash.
    const cpuPath = line.slice(secondColon + 1).replace(/^\/+/, "");
    const candidates = [`/sys/fs/cgroup/cpu,cpuacct/${cpuPath}`, `/sys/fs/cgroup/cpu/${cpuPath}`];
    for (const base of candidates) {
      if (!existsSync(`${base}/cpu.cfs_quota_us`)) continue;
      const quota = Number(slurp(`${base}/cpu.cfs_quota_us`)?.trim());
      const period = Number(slurp(`${base}/cpu.cfs_period_us`)?.trim());
      // cgroup v1 encodes "no limit" as quota=-1.
      if (quota < 0 || !Number.isFinite(quota) || !Number.isFinite(period) || period <= 0) {
        return Infinity;
      }
      return Math.max(1, Math.floor(quota / period));
    }
  }

  return Infinity;
}

// The fix clamps by both affinity AND cgroup quota (matching libuv's
// uv_available_parallelism()). Test environments may have either or both
// in play — the expected value is the min.
function expectedAvailableParallelism(): number {
  const allowed = parseCpusAllowedList();
  if (allowed.length === 0) return 1;
  const quota = readCgroupCpuQuota();
  return Math.min(allowed.length, Number.isFinite(quota) ? quota : allowed.length);
}

test.skipIf(!isLinux)("os.availableParallelism() matches sched_getaffinity + cgroup quota (#29129)", () => {
  const expected = expectedAvailableParallelism();
  expect(expected).toBeGreaterThan(0);

  // Pre-fix bun returned sysconf(_SC_NPROCESSORS_ONLN) (host online
  // count). The fix clamps by min(affinity, cgroup cpu.max), which is
  // what Node reports via libuv. Compute the expected value here from
  // the same inputs libuv reads so the test is valid inside any
  // cpuset/cgroup CI environment, not just the author's machine.
  expect(availableParallelism()).toBe(expected);
});

test.skipIf(!isLinux)("os.availableParallelism() under taskset reports the restricted count (#29129)", async () => {
  const allowed = parseCpusAllowedList();
  if (allowed.length < 2) {
    // Need at least 2 CPUs in the current mask so we can taskset
    // down to a strict subset. Don't fail — the in-process check
    // above already covers the unrestricted case.
    return;
  }

  // Use taskset if present. Not every CI image ships it (e.g. some
  // minimal alpine variants), so skip gracefully in that case — the
  // cross-process path is extra coverage on top of the in-process
  // assertion above.
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

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) {
    // taskset itself can fail before the subprocess starts when
    // sched_setaffinity is blocked by a seccomp profile (GKE
    // Autopilot, Fargate, restrictive pod security) — the stderr
    // looks like "taskset: failed to set pid ...'s affinity:
    // Operation not permitted". Treat that as a graceful skip in the
    // same spirit as the missing-binary guard above: this sub-test is
    // extra coverage, not the primary assertion.
    if (
      stderr.includes("Operation not permitted") ||
      stderr.includes("Permission denied") ||
      stderr.includes("failed to set") // covers taskset's canonical error prefix
    ) {
      return;
    }
    throw new Error(`taskset subprocess exited with ${exitCode}\nstderr:\n${stderr}`);
  }

  const [availableStr, hardwareStr] = stdout.trim().split("|");
  const available = Number(availableStr);
  const hardware = Number(hardwareStr);

  // Pinned to exactly one CPU → both must report 1 regardless of
  // the surrounding cgroup quota (taskset trumps: the mask is a
  // strict subset of what the cgroup allows). Pre-fix bun returned
  // the host count (32 on a 32-core host with an 8-core cpuset),
  // which was the whole bug.
  expect(available).toBe(1);
  expect(hardware).toBe(1);
});
