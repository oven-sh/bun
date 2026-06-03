import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import fs from "node:fs";
import path from "node:path";

// https://github.com/oven-sh/bun/issues/31771
//
// `bun test --isolate` runs each file in a fresh global within ONE process.
// The module records / namespace objects instantiated for one file must be
// reclaimed when the global is swapped for the next file. Before the fix the
// outgoing global's module registry and require cache were never cleared, so
// each finished file's module graph was retained and peak RSS grew linearly
// with the number of files (proportional to each file's imported graph size),
// OOMing large suites. After the fix peak RSS stays roughly flat, as it does
// in default (shared-global) mode.
//
// Measured by polling VmHWM (peak RSS high-water mark, monotonic) of the child
// from /proc. Serial --isolate is a single process, so this is exact. The
// signal is the SLOPE (RSS grows with file count), not an absolute number, so
// the threshold is robust across platforms and build types.

// A 500-module import graph shared by every test file. Before the fix this
// retained several MB/file; the difference between a small and large file
// count is tens of MB — far above allocator noise. Kept modest so the run
// completes well within the timeout under ASAN (the debug/gate build).
const MODULE_COUNT = 500;
const SMALL_N = 4;
const LARGE_N = 14;

function makeFixtures() {
  const files: Record<string, string> = {};
  let graph = "";
  for (let i = 0; i < MODULE_COUNT; i++) {
    files[`mods/m${i}.ts`] = `export function f${i}() { return ${i}; }\n`;
    graph += `import "./mods/m${i}";\n`;
  }
  files["graph.ts"] = graph;
  for (let i = 0; i < LARGE_N; i++) {
    files[`t${i}.test.ts`] = `import "./graph";\nimport { test } from "bun:test";\ntest("noop", () => {});\n`;
  }
  return files;
}

async function peakRssMb(dir: string, n: number): Promise<number> {
  const files = Array.from({ length: n }, (_, i) => `./t${i}.test.ts`);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--isolate", ...files],
    env: bunEnv,
    cwd: dir,
    stdout: "ignore",
    stderr: "pipe",
  });

  let peakKb = 0;
  const statusPath = `/proc/${proc.pid}/status`;
  let running = true;
  const poll = (async () => {
    while (running) {
      try {
        const status = fs.readFileSync(statusPath, "utf8");
        const m = status.match(/VmHWM:\s*(\d+)\s*kB/);
        if (m) peakKb = Math.max(peakKb, parseInt(m[1], 10));
      } catch {
        // process gone
      }
      await Bun.sleep(2);
    }
  })();

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  running = false;
  await poll;

  // One last read in case it exited between polls (VmHWM persists until exit).
  try {
    const m = fs.readFileSync(statusPath, "utf8").match(/VmHWM:\s*(\d+)\s*kB/);
    if (m) peakKb = Math.max(peakKb, parseInt(m[1], 10));
  } catch {}

  expect(stderr).toContain(`${n} pass`);
  expect(stderr).toContain("0 fail");
  expect(peakKb).toBeGreaterThan(0);
  expect(exitCode).toBe(0);
  return peakKb / 1024;
}

test.skipIf(!isLinux)(
  "bun test --isolate does not retain finished files' module graph (peak RSS stays flat)",
  async () => {
    using dir = tempDir("isolate-rss-31771", makeFixtures());
    const root = String(dir);

    // Sanity: fixtures materialized.
    expect(fs.existsSync(path.join(root, "graph.ts"))).toBe(true);

    const small = await peakRssMb(root, SMALL_N);
    const large = await peakRssMb(root, LARGE_N);

    const perFile = (large - small) / (LARGE_N - SMALL_N);

    // Before the fix the 500-module graph is retained per file, so the slope is
    // several MB/file (tens of MB across the file-count delta). After the fix
    // the graph is reclaimed on each swap and the slope is near zero. 0.5 MB/file
    // sits comfortably between the two (post-fix is <0.1 MB/file even under
    // ASAN's noisier heap accounting).
    expect(perFile).toBeLessThan(0.5);
  },
  90_000,
);
