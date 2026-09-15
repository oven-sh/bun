import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// The only consumer of this value is the crash reporter, which debug builds
// never reach. Read it through the test binding instead.
const script = `console.log(require("bun:internal-for-testing").crash_handler.isAnalyticsEnabled());`;

// bunEnv inherits the agent's environment, which may carry either variable.
const cleanEnv = { ...bunEnv };
delete cleanEnv.DO_NOT_TRACK;
delete cleanEnv.HYPERFINE_RANDOMIZED_ENVIRONMENT_OFFSET;

async function isAnalyticsEnabled(bunfig: string | null, env: Record<string, string>): Promise<boolean> {
  using dir = tempDir("bunfig-telemetry", bunfig === null ? {} : { "bunfig.toml": bunfig });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...cleanEnv, ...env },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(["true\n", "false\n"]).toContain(stdout);
  return stdout === "true\n";
}

describe("bunfig telemetry", () => {
  test.concurrent("telemetry = true overrides DO_NOT_TRACK=1", async () => {
    expect(await isAnalyticsEnabled("telemetry = true\n", { DO_NOT_TRACK: "1" })).toBe(true);
  });

  test.concurrent("telemetry = false disables analytics", async () => {
    expect(await isAnalyticsEnabled("telemetry = false\n", {})).toBe(false);
  });

  test.concurrent("without a telemetry setting, DO_NOT_TRACK=1 disables analytics", async () => {
    expect(await isAnalyticsEnabled(null, { DO_NOT_TRACK: "1" })).toBe(false);
  });

  test.concurrent("without a telemetry setting, analytics is enabled by default", async () => {
    expect(await isAnalyticsEnabled(null, {})).toBe(true);
  });
});
