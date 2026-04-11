// Regression test for https://github.com/oven-sh/bun/issues/29129 —
// os.availableParallelism() / navigator.hardwareConcurrency must honor
// sched_getaffinity and cgroup cpu.max on Linux, matching libuv's
// uv_available_parallelism() (and therefore Node.js).
//
// Runs under both:
//   bun bd test test/regression/issue/29129.test.ts
//   node --experimental-strip-types --test test/regression/issue/29129.test.ts

import assert from "node:assert";
import { spawnSync } from "node:child_process";
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
// don't exist elsewhere). On non-Linux, register a single explicitly
// skipped placeholder via `test.skip` so the file still reports a
// result to the runner without ever entering the helper functions.
if (process.platform !== "linux") {
  test.skip("os.availableParallelism() cpuset + cgroup quota (#29129)", () => {});
} else {
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

  test("os.availableParallelism() under taskset reports the restricted count (#29129)", () => {
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
    const which = spawnSync("sh", ["-c", "command -v taskset || true"], { encoding: "utf8" });
    const tasksetPath = (which.stdout || "").trim();
    if (!tasksetPath) return;

    // Pin to the first CPU in the current allowed set. Using an
    // index from the mask (rather than "0") avoids "Invalid
    // argument" inside a cpuset that doesn't include CPU 0.
    const pinCpu = allowed[0]!;

    // Run the same runtime that's executing this file (bun under
    // `bun test`, node under `node --test`) so the subprocess
    // actually exercises the binary under test.
    const result = spawnSync(
      tasksetPath,
      [
        "-c",
        String(pinCpu),
        process.execPath,
        "-e",
        "console.log(require('os').availableParallelism() + '|' + (globalThis.navigator?.hardwareConcurrency ?? ''))",
      ],
      { encoding: "utf8" },
    );

    // spawnSync returns result.status === null both when the process
    // failed to launch (result.error is set, e.g. ENOENT / ENOMEM) and
    // when it was killed by a signal (result.signal is set, e.g.
    // SIGSEGV). Include that in the error message so a CI failure
    // points at the real cause instead of a confusing "exited with null".
    if (result.error || result.status !== 0) {
      const stderr = result.stderr || "";
      // taskset itself can fail before the subprocess starts when
      // sched_setaffinity is blocked by a seccomp profile (GKE
      // Autopilot, Fargate, restrictive pod security) — the stderr
      // looks like "taskset: failed to set pid ...'s affinity:
      // Operation not permitted". Treat permission denials as a
      // graceful skip in the same spirit as the missing-binary guard
      // above: this sub-test is extra coverage, not the primary
      // assertion. Any OTHER failure is a real regression worth
      // surfacing.
      if (stderr.includes("Operation not permitted") || stderr.includes("Permission denied")) {
        return;
      }
      const reason = result.error
        ? `failed to launch: ${result.error.message}`
        : result.signal
          ? `killed by signal ${result.signal}`
          : `exited with ${result.status}`;
      throw new Error(`taskset subprocess ${reason}\nstderr:\n${stderr}`);
    }

    const [availableStr, hardwareStr] = (result.stdout || "").trim().split("|");
    const available = Number(availableStr);

    // Pinned to exactly one CPU → availableParallelism must report 1
    // regardless of the surrounding cgroup quota (taskset trumps: the
    // mask is a strict subset of what the cgroup allows). Pre-fix bun
    // returned the host count (32 on a 32-core host with an 8-core
    // cpuset), which was the whole bug.
    assert.strictEqual(available, 1);

    // navigator.hardwareConcurrency is a web-platform global that bun
    // exposes on the main thread but node does not (it's only on
    // Worker scopes). The subprocess script uses `?? ""`, so an absent
    // navigator produces an empty string — assert the value only when
    // the runtime actually exposed it.
    if (hardwareStr !== "") {
      assert.strictEqual(Number(hardwareStr), 1);
    }
  });
}
