import { expect, test } from "bun:test";
import { isLinux } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { totalmem } from "node:os";

// On Linux, process.availableMemory() must honour the cgroup memory limit the
// process is running under, returning (limit - current usage) like libuv's
// uv_get_available_memory() and therefore Node.js. Previously bun returned the
// host's /proc/meminfo MemAvailable, which inside a container reports the host
// machine's free memory and can exceed the process's own constrainedMemory()
// by orders of magnitude.

// Detect whether this process is running under a real cgroup memory limit
// (i.e. constrainedMemory() reports something smaller than host totalmem).
function hasCgroupMemoryLimit(): boolean {
  if (!isLinux) return false;
  const constrained = process.constrainedMemory();
  const total = totalmem();
  return constrained > 0 && total > 0 && constrained < total;
}

// Read the cgroup's current memory usage directly so the test can compute the
// expected available value independently of the implementation under test.
function readCgroupCurrentMemory(): number | null {
  try {
    const entry = readFileSync("/proc/self/cgroup", "utf8");
    // cgroup v2: single "0::/<path>" line.
    if (entry.startsWith("0::/")) {
      const path = entry.slice("0::/".length).split("\n", 1)[0];
      const leaf = "/sys/fs/cgroup/" + path + (path.length && !path.endsWith("/") ? "/" : "") + "memory.current";
      for (const candidate of [leaf, "/sys/fs/cgroup/memory.current"]) {
        if (existsSync(candidate)) {
          const n = Number(readFileSync(candidate, "utf8"));
          if (Number.isFinite(n)) return n;
        }
      }
      return null;
    }
    // cgroup v1: find the :memory: controller.
    for (const line of entry.split("\n")) {
      const match = line.match(/^\d+:memory:\/(.*)$/);
      if (match) {
        const p = "/sys/fs/cgroup/memory/" + match[1] + (match[1].length ? "/" : "") + "memory.usage_in_bytes";
        for (const candidate of [p, "/sys/fs/cgroup/memory/memory.usage_in_bytes"]) {
          if (existsSync(candidate)) {
            const n = Number(readFileSync(candidate, "utf8"));
            if (Number.isFinite(n)) return n;
          }
        }
      }
    }
  } catch {}
  return null;
}

test("process.availableMemory() returns a positive number", () => {
  const available = process.availableMemory();
  expect(typeof available).toBe("number");
  expect(Number.isFinite(available)).toBe(true);
  expect(available).toBeGreaterThanOrEqual(0);
});

test.skipIf(!hasCgroupMemoryLimit())("process.availableMemory() respects cgroup memory limits on Linux", () => {
  const constrained = process.constrainedMemory();
  const available = process.availableMemory();
  const total = totalmem();

  // The invariant the bug violates: a process can never have more memory
  // available to it than its own cgroup limit. Before the fix, available
  // was the host's MemAvailable (often hundreds of GB) while constrained
  // was the container limit (often hundreds of MB).
  expect(available).toBeLessThanOrEqual(constrained);

  // Sanity: it should also never exceed host total memory.
  expect(available).toBeLessThanOrEqual(total);

  // Compare against an independent computation of the expected value:
  // libuv's uv_get_available_memory() on Linux is (limit - current usage).
  // Memory usage moves between the two reads, so allow generous slack.
  const current = readCgroupCurrentMemory();
  if (current !== null) {
    const expected = Math.max(0, constrained - current);
    const tolerance = 256 * 1024 * 1024;
    expect(Math.abs(available - expected)).toBeLessThanOrEqual(tolerance);
  }
});
