// https://github.com/oven-sh/bun/issues/29072
//
// On Linux, os.freemem() used sysinfo.freeram which excludes reclaimable
// page cache. On any system that's done real work it returned a number
// much smaller than Node.js — Node uses /proc/meminfo's MemAvailable,
// the kernel's own estimate of memory available for new allocations,
// which counts reclaimable cache/slab.
//
// Fix: Bun__Os__getFreeMemory on Linux now reads MemAvailable first and
// only falls back to sysinfo.freeram when /proc/meminfo is unreadable,
// matching libuv (and therefore Node.js).

import { expect, test } from "bun:test";
import { isLinux } from "harness";
import { existsSync, readFileSync, statSync } from "node:fs";
import { freemem, totalmem } from "node:os";

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

// Read a large real on-disk file so its pages land in the Linux page
// cache. Unlike /proc/* pseudo-files, disk-backed pages are reclaimable
// and contribute to the MemAvailable–MemFree gap. This makes the bug
// observable even on otherwise-cold CI hosts.
function warmPageCache(): void {
  const candidates = [
    "/usr/lib/locale/locale-archive",
    "/usr/lib/x86_64-linux-gnu/libc.so.6",
    "/usr/lib/aarch64-linux-gnu/libc.so.6",
    "/usr/bin/bash",
    "/bin/bash",
  ];
  for (const path of candidates) {
    try {
      if (existsSync(path) && statSync(path).size > 64 * 1024) {
        readFileSync(path);
      }
    } catch {}
  }
}

test.skipIf(!isLinux)("os.freemem() uses MemAvailable, not MemFree (#29072)", () => {
  warmPageCache();

  const info = parseMeminfo();
  expect(info.MemAvailable).toBeGreaterThan(0);
  expect(info.MemFree).toBeGreaterThan(0);

  const free = freemem();
  const total = totalmem();

  // Sanity: free is positive and bounded by total.
  expect(free).toBeGreaterThan(0);
  expect(free).toBeLessThanOrEqual(total);

  // The core assertion: os.freemem() must return MemAvailable (what Node
  // returns via libuv), not MemFree / sysinfo.freeram.
  //
  // Memory values fluctuate slightly between the two kernel reads, so
  // allow a small absolute tolerance. 64 MiB is comfortably larger than
  // typical inter-read drift on a busy system and comfortably smaller
  // than the MemAvailable–MemFree gap on any host with a populated
  // page cache (which every CI runner has by the time a test runs).
  const tolerance = 64 * 1024 * 1024;
  expect(Math.abs(free - info.MemAvailable)).toBeLessThanOrEqual(tolerance);

  // Additionally, when the gap between MemAvailable and MemFree is
  // clearly larger than the fluctuation tolerance (the overwhelming
  // common case on Linux), assert that `free` is closer to MemAvailable
  // than to MemFree. This is the direct proof the fix is in effect:
  // the pre-fix implementation returned ~MemFree, which would fail here.
  const gap = info.MemAvailable - info.MemFree;
  if (gap > tolerance * 2) {
    const distToAvailable = Math.abs(free - info.MemAvailable);
    const distToFree = Math.abs(free - info.MemFree);
    expect(distToAvailable).toBeLessThan(distToFree);
  }
});
