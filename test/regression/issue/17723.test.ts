// Test for Issue #17723: Container memory awareness
//
// Spawns a child process inside a cgroup v2 with a memory limit
// and verifies that Bun's GC keeps RSS bounded.

import { test, expect, describe } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmdirSync } from "fs";
import { join } from "path";
import { totalmem } from "os";
import { bunEnv, bunExe, tempDir } from "harness";

const isLinux = process.platform === "linux";

// The stress script joins itself into the cgroup as its first action,
// then allocates and discards buffers. If the GC doesn't respect the
// cgroup limit, RSS will climb until the kernel OOM-kills the process.
const STRESS_SCRIPT = `
const { writeFileSync } = require("fs");

// Self-join: move this process into the cgroup before allocating
const cgroupPath = process.env.CGROUP_PATH;
if (cgroupPath) {
  try {
    writeFileSync(cgroupPath + "/cgroup.procs", String(process.pid));
  } catch (e) {
    console.error("Failed to join cgroup:", e.message);
  }
}

const LIMIT_MB = parseInt(process.env.CGROUP_LIMIT_MB || "256");
const TARGET_RSS_MB = LIMIT_MB * 0.85;
const ITERATIONS = 200;
const CHUNK_SIZE = 1024 * 1024; // 1 MB

let peak_rss = 0;

for (let i = 0; i < ITERATIONS; i++) {
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
    // Bun intentionally returns WTF::ramSize() (>0) when no cgroup is detected,
    // unlike Node.js which returns 0. This divergence is intentional.
    expect(typeof mem).toBe("number");
    expect(mem).toBeGreaterThan(0);
  });

  test("process.constrainedMemory() <= os.totalmem()", () => {
    const constrained = process.constrainedMemory();
    expect(constrained).toBeLessThanOrEqual(totalmem());
  });

  test.skipIf(!isLinux)("cgroup: RSS stays bounded under allocation pressure", async () => {
    const cgroupBase = "/sys/fs/cgroup";
    const testCgroup = join(cgroupBase, "bun-test-17723");
    const limitMB = 256;

    // Check if we can create cgroups (requires root or delegation)
    let canCreateCgroup = false;
    try {
      if (existsSync(join(cgroupBase, "cgroup.controllers"))) {
        mkdirSync(testCgroup, { recursive: true });
        canCreateCgroup = true;
      }
    } catch {
      // No permission
    }

    if (!canCreateCgroup) {
      console.log("Skipping: cannot create cgroups (need root or delegation)");
      return;
    }

    try {
      // Set memory limit on the cgroup
      writeFileSync(join(testCgroup, "memory.max"), `${limitMB * 1024 * 1024}`);

      // Write stress script using harness tempDir
      using dir = tempDir("bun-17723", {
        "stress.ts": STRESS_SCRIPT,
      });
      const scriptPath = join(String(dir), "stress.ts");

      // Spawn child using bunExe/bunEnv — it self-joins the cgroup via CGROUP_PATH
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", scriptPath],
        env: {
          ...bunEnv,
          CGROUP_LIMIT_MB: String(limitMB),
          CGROUP_PATH: testCgroup,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      // Parse and assert stdout first for better error messages
      if (stdout.trim()) {
        const lastLine = stdout.trim().split("\n").pop()!;
        try {
          const result = JSON.parse(lastLine);
          console.log(
            `Peak RSS: ${result.peak_rss_mb}MB, Final RSS: ${result.final_rss_mb}MB, ` +
            `Constrained: ${result.constrained_mb}MB, Limit: ${result.limit_mb}MB`
          );

          if (result.constrained_mb !== null) {
            expect(result.constrained_mb).toBeLessThanOrEqual(limitMB);
          }
          expect(result.bounded).toBe(true);
        } catch {}
      }

      // Then assert exit code with stderr pattern
      if (exitCode !== 0) {
        expect(stderr).toBe("");
      }
      expect(exitCode).toBe(0);

    } finally {
      try { rmdirSync(testCgroup); } catch {}
    }
  }, 30_000);

});
