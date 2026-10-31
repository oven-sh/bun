// Regression test for https://github.com/oven-sh/bun/issues/29129 —
// os.availableParallelism() / navigator.hardwareConcurrency must honor
// sched_getaffinity and cgroup cpu.max on Linux, matching libuv's
// uv_available_parallelism() (and therefore Node.js).
//
// Runs under both:
//   bun bd test test/regression/issue/29129.test.ts
//   node --experimental-strip-types --test test/regression/issue/29129.test.ts

import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import test from "node:test";

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

// Read the cgroup CPU quota for the current process, mirroring libuv's
// uv__get_constrained_cpu(). Returns `Infinity` when no limit is set
// (typical bare-metal / unrestricted containers) or when the cgroup
// files can't be read; otherwise returns floor(limit/period).
//
// The test passes when `availableParallelism() === min(affinity, quota)`,
// the same invariant libuv enforces via uv_available_parallelism().
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

  let result = Infinity;

  // cgroup v2: look for a `0::/...` entry anywhere in the file, not
  // just at line 0 — hybrid v1+v2 hosts (Ubuntu 22.04 with legacy
  // Docker, Kubernetes nodes mid-migration) intersperse v1 controller
  // lines before the v2 entry. Walk up the hierarchy and take the min
  // of every populated cpu.max, matching libuv's
  // uv__get_cgroupv2_constrained_cpu().
  const v2Match = cgroup.match(/^0::(\/[^\n]*)/m);
  if (v2Match) {
    const rel = v2Match[1]!.replace(/^\/+/, "");
    let min = Infinity;
    // Strip any trailing slash so the `path === mount` break fires on
    // the first iteration when the process sits at the cgroup root
    // (`rel === ""`). Without this, the loop would read
    // /sys/fs/cgroup//cpu.max twice before stopping.
    let path = `/sys/fs/cgroup/${rel}`.replace(/\/+$/, "");
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
    if (min < result) result = min;
  }

  // cgroup v1: each line is "<id>:<controllers>:<path>" where
  // controllers is a comma-separated list. We need the line whose
  // controller list contains "cpu" (order-independent: both
  // "cpu,cpuacct" and "cpuacct,cpu" are valid). On hybrid hosts this
  // runs in addition to the v2 block above; we take the min so
  // whichever hierarchy has a tighter quota wins.
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
        break;
      }
      const v1 = Math.max(1, Math.floor(quota / period));
      if (v1 < result) result = v1;
      break;
    }
    break;
  }

  return result;
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

// The fix under test is Linux-only (sched_getaffinity / cgroup cpu.max
// don't exist elsewhere). Register zero tests on non-Linux — an empty
// test file is treated as "0 tests ran, exit 0" by both bun and node
// test runners, which is the correct outcome for a platform-gated
// regression.
if (process.platform === "linux") {
  test("os.availableParallelism() matches sched_getaffinity + cgroup quota (#29129)", () => {
    const expected = expectedAvailableParallelism();
    assert.ok(expected > 0, `expected > 0, got ${expected}`);

    // Pre-fix bun returned sysconf(_SC_NPROCESSORS_ONLN) (host online
    // count). The fix clamps by min(affinity, cgroup cpu.max), which is
    // what Node reports via libuv. Compute the expected value here from
    // the same inputs libuv reads so the test is valid inside any
    // cpuset/cgroup CI environment, not just the author's machine.
    assert.strictEqual(availableParallelism(), expected);
  });

  // A second test that ran the binary under taskset(1) used to live here
  // as belt-and-braces coverage. It proved flaky on ASAN CI (spawnSync
  // of a full debug+ASAN bun pinned to one CPU hit intermittent
  // ENOMEM/timeout/signal issues across builds 45028–45104). The
  // in-process assertion above already exercises the full
  // min(affinity, cgroup quota) path that was the actual bug, so the
  // cross-process test was removed rather than left as a source of CI
  // noise.
}
