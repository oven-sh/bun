// https://github.com/oven-sh/bun/issues/29072
//
// On Linux, os.freemem() used sysinfo.freeram which excludes reclaimable
// page cache. On any system with a non-trivial page cache (which is
// essentially every Linux host after doing real work) this returned a
// number much smaller than what Node.js returns — Node uses /proc/meminfo's
// MemAvailable, which includes reclaimable page cache/slab and is the
// kernel's own estimate of memory available for new allocations.
//
// Fixed: Bun__Os__getFreeMemory on Linux now reads MemAvailable first and
// only falls back to sysinfo.freeram when /proc/meminfo is unreadable,
// matching libuv (and therefore Node.js).

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { freemem, totalmem } from "node:os";
import { isLinux } from "harness";

function parseMeminfo(): Record<string, number> {
  const text = readFileSync("/proc/meminfo", "utf8");
  const out: Record<string, number> = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^(\w+):\s+(\d+)\s*kB/);
    if (match) {
      out[match[1]] = Number(match[2]) * 1024;
    }
  }
  return out;
}

test.skipIf(!isLinux)("os.freemem() uses MemAvailable, not MemFree", () => {
  // Populate the page cache so MemAvailable is meaningfully larger than
  // MemFree. Reading a handful of large, well-known files pushes their
  // pages into the cache; those pages count towards MemAvailable (they
  // are reclaimable) but NOT towards MemFree.
  try {
    readFileSync("/proc/kallsyms");
  } catch {}
  try {
    // /proc/meminfo itself is tiny; prefer something bulkier that every
    // Linux system has.
    readFileSync("/proc/self/maps");
  } catch {}

  const info = parseMeminfo();
  expect(info.MemAvailable).toBeGreaterThan(0);
  expect(info.MemFree).toBeGreaterThan(0);

  const free = freemem();
  const total = totalmem();

  // Sanity: free is positive and bounded by total.
  expect(free).toBeGreaterThan(0);
  expect(free).toBeLessThanOrEqual(total);

  // The core of the regression: freemem() must be close to MemAvailable,
  // NOT MemFree. Memory fluctuates between reads, so allow a generous
  // tolerance. Before the fix freemem() returned sysinfo.freeram (≈ MemFree),
  // which on any system with a populated page cache differs from
  // MemAvailable by far more than this tolerance.
  const tolerance = Math.max(info.MemAvailable * 0.15, 256 * 1024 * 1024);
  expect(Math.abs(free - info.MemAvailable)).toBeLessThan(tolerance);

  // When MemAvailable is significantly larger than MemFree (the common
  // case — any machine that's been running long enough to cache files),
  // freemem() must report much more than MemFree. This is the direct
  // assertion that Bun is not returning the sysinfo.freeram value.
  if (info.MemAvailable > info.MemFree + 512 * 1024 * 1024) {
    // free should be closer to MemAvailable than to MemFree
    const distToAvailable = Math.abs(free - info.MemAvailable);
    const distToFree = Math.abs(free - info.MemFree);
    expect(distToAvailable).toBeLessThan(distToFree);
  }
});
