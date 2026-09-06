import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, canBuildNodeAddons, isBroken, isMusl, isWindows, tempDir } from "harness";
import { join } from "node:path";

// pprof (google/pprof-nodejs) ships no prebuilds: its nan addon is compiled
// from source with node-gyp, the same way test/v8 builds its module. Unlike
// @datadog/pprof, it drives v8::CpuProfiler through the title-keyed
// StartProfiling()/StopProfiling() overloads and CpuProfile::GetTitle()
// (#19678). The source build is skipped on Windows; test/v8 covers those
// overloads on every platform.
describe.skipIf(!canBuildNodeAddons() || isWindows).todoIf(isBroken && isMusl)("pprof", () => {
  test("time.profile() returns a profile with samples", async () => {
    using dir = tempDir("pprof", {
      "package.json": JSON.stringify({
        name: "pprof-fixture",
        version: "0.0.0",
        dependencies: { pprof: "5.0.0" },
        devDependencies: { "node-gyp": "~11.2.0" },
      }),
      "index.mjs": /* js */ `
        import pprof from "pprof";

        function hotLoop() {
          // CPU work, not a sleep: the 1ms sampler needs frames to record
          // while time.profile() waits for durationMillis.
          const start = Date.now();
          let acc = 0;
          while (Date.now() - start < 5) {
            for (let i = 0; i < 1000; i++) acc += Math.sqrt(i);
          }
          return acc;
        }

        function summarize(profile) {
          const names = profile.function.map(fn => profile.stringTable[fn.name]);
          return {
            sampleCount: profile.sample.length,
            locationCount: profile.location.length,
            functionCount: profile.function.length,
            hasHotLoop: names.includes("hotLoop"),
          };
        }

        const interval = setInterval(hotLoop, 0);
        try {
          const plain = await pprof.time.profile({ durationMillis: 200 });
          const withLineNumbers = await pprof.time.profile({ durationMillis: 200, lineNumbers: true });
          const encoded = await pprof.encode(plain);
          process.stdout.write(
            JSON.stringify({
              plain: summarize(plain),
              withLineNumbers: summarize(withLineNumbers),
              encodedBytes: encoded.length,
            }) + "\\n",
          );
        } finally {
          clearInterval(interval);
        }
      `,
    });

    {
      await using install = Bun.spawn({
        cmd: [bunExe(), "install", "--ignore-scripts"],
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

    {
      await using build = Bun.spawn({
        cmd: [
          bunExe(),
          "--bun",
          join(String(dir), "node_modules", "node-gyp", "bin", "node-gyp.js"),
          "rebuild",
          "--release",
          "-j",
          "max",
        ],
        env: bunEnv,
        cwd: join(String(dir), "node_modules", "pprof"),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
      if (exitCode !== 0) {
        throw new Error(`node-gyp rebuild failed (exit ${exitCode})\nstdout:\n${stdout}\nstderr:\n${stderr}`);
      }
    }

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "index.mjs")],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const summary = JSON.parse(stdout.trim());
    const populated = {
      sampleCount: expect.any(Number),
      locationCount: expect.any(Number),
      functionCount: expect.any(Number),
      hasHotLoop: true,
    };
    expect(summary).toEqual({
      plain: populated,
      withLineNumbers: populated,
      encodedBytes: expect.any(Number),
    });
    for (const profile of [summary.plain, summary.withLineNumbers]) {
      expect(profile.sampleCount).toBeGreaterThan(0);
      expect(profile.locationCount).toBeGreaterThan(0);
      expect(profile.functionCount).toBeGreaterThan(0);
    }
    expect(summary.encodedBytes).toBeGreaterThan(0);
    expect(exitCode).toBe(0);
  }, 120_000);
});
