import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";

// @datadog/pprof@5.17.0 ships node-gyp-build prebuilds for linux-{x64,arm64}
// (glibc + musl), darwin-{x64,arm64} and win32-x64 at ABI 147, matching Bun's
// process.versions.modules. win32-arm64 has no prebuild — skip there rather
// than fall through to a node-gyp source build.
const hasPrebuild = !(isWindows && process.arch === "arm64");

describe.skipIf(!hasPrebuild)("@datadog/pprof", () => {
  test("TimeProfiler start/stop returns a populated profile", async () => {
    using dir = tempDir("datadog-pprof", {
      "package.json": JSON.stringify({
        name: "datadog-pprof-fixture",
        version: "0.0.0",
        dependencies: {
          "@datadog/pprof": "5.17.0",
        },
        trustedDependencies: ["@datadog/pprof"],
      }),
      "index.js": /* js */ `
        const { time } = require("@datadog/pprof");

        function hotLoop() {
          // Busy-spin long enough for the 1ms wall sampler to capture real
          // samples on slow debug/ASAN builds; this is CPU work, not a sleep.
          const start = Date.now();
          let acc = 0;
          while (Date.now() - start < 300) {
            for (let i = 0; i < 1000; i++) acc += Math.sqrt(i);
          }
          return acc;
        }

        time.start({ intervalMicros: 1000, durationMillis: 60000 });
        hotLoop();
        const profile = time.stop();

        const strings = profile.stringTable.strings;
        const summary = {
          sampleCount: profile.sample.length,
          locationCount: profile.location.length,
          functionCount: profile.function.length,
          stringCount: strings.length,
          hasHotLoop: strings.includes("hotLoop"),
          period: Number(profile.period),
        };
        process.stdout.write(JSON.stringify(summary) + "\\n");
      `,
    });

    {
      await using install = Bun.spawn({
        cmd: [bunExe(), "install"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        install.stdout.text(),
        install.stderr.text(),
        install.exited,
      ]);
      if (exitCode !== 0) {
        throw new Error(`bun install failed (exit ${exitCode})\nstdout:\n${stdout}\nstderr:\n${stderr}`);
      }
    }

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "index.js")],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");

    const summary = JSON.parse(stdout.trim());
    expect(summary).toEqual({
      sampleCount: expect.any(Number),
      locationCount: expect.any(Number),
      functionCount: expect.any(Number),
      stringCount: expect.any(Number),
      hasHotLoop: true,
      period: expect.any(Number),
    });
    expect(summary.sampleCount).toBeGreaterThan(0);
    expect(summary.locationCount).toBeGreaterThan(0);
    expect(summary.functionCount).toBeGreaterThan(0);
    expect(summary.stringCount).toBeGreaterThan(0);
    // serializeTimeProfile recomputes intervalMicros from wall-clock/hit-count,
    // clamps it to [intervalMicros, 2*intervalMicros], then ×1000 → nanoseconds.
    expect(summary.period).toBeGreaterThanOrEqual(1_000_000);
    expect(summary.period).toBeLessThanOrEqual(2_000_000);

    expect(exitCode).toBe(0);
  }, 120_000);
});
