import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";

// startSamplingProfiler(directory) used to assign JSC::Options::samplingProfilerPath(),
// which lives in memory that JSC mprotects read-only before any user code can
// run, so any directory argument crashed the process with SIGSEGV.
test.concurrent("startSamplingProfiler with a directory writes a report at exit", async () => {
  using dir = tempDir("jsc-sampling-profiler", {});
  const reportDir = join(String(dir), "report");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `require("bun:jsc").startSamplingProfiler(${JSON.stringify(reportDir)}); console.log("ok");`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: "ok\n", exitCode: 0 });

  const reports = readdirSync(reportDir).filter(name => name.startsWith("samplingProfile.") && name.endsWith(".txt"));
  expect(reports).toHaveLength(1);
  expect(await Bun.file(join(reportDir, reports[0])).text()).toContain("Sampling rate:");
});

test.concurrent("startSamplingProfiler without a directory does not write a report", async () => {
  using dir = tempDir("jsc-sampling-profiler-no-dir", {});
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const jsc = require("bun:jsc");
       jsc.startSamplingProfiler();
       console.log(typeof jsc.samplingProfilerStackTraces());`,
    ],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: "object\n", exitCode: 0 });
  expect(readdirSync(String(dir))).toEqual([]);
});
