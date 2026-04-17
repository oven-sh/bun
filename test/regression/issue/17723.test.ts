// Test for Issue #17723: Container memory awareness
//
// Spawns a child process inside a cgroup (on Linux) with a memory limit
// and verifies that Bun's GC keeps RSS bounded.
//
// On non-Linux, only the basic process.constrainedMemory() checks run.

import { test, expect, describe } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const isLinux = process.platform === "linux";

// The stress script that the child process runs inside the cgroup.
// It allocates and discards buffers in a loop, checking that RSS stays
// below the cgroup ceiling. If the GC is unaware of the cgroup limit,
// RSS will climb until the kernel OOM-kills the process.
const STRESS_SCRIPT = `
const LIMIT_MB = parseInt(process.env.CGROUP_LIMIT_MB || "256");
const TARGET_RSS_MB = LIMIT_MB * 0.85; // fail if RSS exceeds 85% of limit
const ITERATIONS = 200;
const CHUNK_SIZE = 1024 * 1024; // 1 MB per allocation

let peak_rss = 0;

for (let i = 0; i < ITERATIONS; i++) {
  // Allocate ~1 MB that becomes garbage immediately
  const buf = Buffer.alloc(CHUNK_SIZE, 0x42);
  void buf;

  if (i % 20 === 0) {
    const rss_mb = process.memoryUsage.rss() / 1024 / 1024;
    if (rss_mb > peak_rss) peak_rss = rss_mb;
  }
}

// Force a final GC and measure
if (typeof Bun !== "undefined" && Bun.gc) Bun.gc(true);
await new Promise(r => setTimeout(r, 500));

const final_rss = process.memoryUsage.rss() / 1024 / 1024;
if (final_rss > peak_rss) peak_rss = final_rss;

const constrained = process.constrainedMemory();
const constrained_mb = constrained ? constrained / 1024 / 1024 : null;

// Output JSON for the parent to parse
console.log(JSON.stringify({
  peak_rss_mb: Math.round(peak_rss),
  final_rss_mb: Math.round(final_rss),
  constrained_mb: constrained_mb ? Math.round(constrained_mb) : null,
  limit_mb: LIMIT_MB,
  bounded: final_rss < TARGET_RSS_MB,
}));
`;

describe("Issue #17723: Container Memory Awareness", () => {

  test("process.constrainedMemory() returns a positive number", () => {
    const mem = process.constrainedMemory();
    expect(typeof mem).toBe("number");
    expect(mem).toBeGreaterThan(0);
  });

  test("process.constrainedMemory() <= os.totalmem()", () => {
    const constrained = process.constrainedMemory();
    const { totalmem } = require("os");
    // In a container, constrained <= total. Outside, they may be equal.
    expect(constrained).toBeLessThanOrEqual(totalmem());
  });

  test.skipIf(!isLinux)("cgroup: RSS stays bounded under allocation pressure", async () => {
    // This test requires root or cgroup v2 delegation.
    // On CI (GitHub Actions), the runner is root inside a container.
    const cgroupBase = "/sys/fs/cgroup";
    const testCgroup = join(cgroupBase, "bun-test-17723");
    const limitMB = 256;

    // Check if we can create cgroups
    let canCreateCgroup = false;
    try {
      if (existsSync(join(cgroupBase, "cgroup.controllers"))) {
        // cgroup v2
        mkdirSync(testCgroup, { recursive: true });
        canCreateCgroup = true;
      }
    } catch {
      // No permission to create cgroups — skip
    }

    if (!canCreateCgroup) {
      console.log("Skipping: cannot create cgroups (need root or delegation)");
      return;
    }

    try {
      // Set memory limit
      writeFileSync(join(testCgroup, "memory.max"), `${limitMB * 1024 * 1024}`);

      // Write the stress script to a temp file
      const scriptPath = join(tmpdir(), "bun-17723-stress.ts");
      writeFileSync(scriptPath, STRESS_SCRIPT);

      // Spawn bun inside the cgroup using cgexec or by writing to cgroup.procs
      const proc = Bun.spawn(["bun", "run", scriptPath], {
        env: { ...process.env, CGROUP_LIMIT_MB: String(limitMB) },
        stdout: "pipe",
        stderr: "pipe",
        // Move the process into the cgroup
        onSpawn: (subprocess) => {
          try {
            writeFileSync(join(testCgroup, "cgroup.procs"), String(subprocess.pid));
          } catch (e) {
            console.error("Failed to move process to cgroup:", e);
          }
        },
      });

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      if (exitCode !== 0) {
        // If the process was OOM-killed, exitCode is typically 137 (SIGKILL)
        if (exitCode === 137 || exitCode === 9) {
          throw new Error(
            `Child was OOM-killed (exit ${exitCode}). ` +
            `This confirms the bug: GC did not respect the ${limitMB}MB cgroup limit.\n` +
            `stderr: ${stderr}`
          );
        }
        throw new Error(`Child exited with ${exitCode}: ${stderr}`);
      }

      // Parse the JSON output
      const lastLine = stdout.trim().split("\n").pop()!;
      const result = JSON.parse(lastLine);

      console.log(`Peak RSS: ${result.peak_rss_mb}MB, Final RSS: ${result.final_rss_mb}MB, ` +
                  `Constrained: ${result.constrained_mb}MB, Limit: ${result.limit_mb}MB`);

      // The constrained memory should match the cgroup limit
      if (result.constrained_mb !== null) {
        expect(result.constrained_mb).toBeLessThanOrEqual(limitMB);
      }

      // RSS should stay bounded below 85% of the limit
      expect(result.bounded).toBe(true);

    } finally {
      // Cleanup cgroup
      try { rmdirSync(testCgroup); } catch {}
    }
  }, 30_000); // 30s timeout

});
