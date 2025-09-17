import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

describe("minimumReleaseAge - simple tests", () => {
  test("loads configuration from bunfig.toml", async () => {
    const dir = tempDirWithFiles("min-age-simple", {
      "bunfig.toml": `
[install]
minimumReleaseAge = 525600
`,
      "package.json": JSON.stringify({
        name: "test-simple",
        dependencies: {
          // is-odd hasn't been updated since 2022, should always pass
          "is-odd": "3.0.1",
        },
      }),
    });

    const { exitCode, stderr } = await Bun.spawnSync({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    // Should succeed as is-odd is very old
    expect(exitCode).toBe(0);
    expect(stderr.toString()).not.toContain("error");
  }, 20000); // 20 second timeout

  test("exclusion list works", async () => {
    const dir = tempDirWithFiles("min-age-exclude", {
      "bunfig.toml": `
[install]
minimumReleaseAge = 525600
minimumReleaseAgeExclude = ["is-odd"]
`,
      "package.json": JSON.stringify({
        name: "test-exclude",
        dependencies: {
          "is-odd": "3.0.1",
        },
      }),
    });

    const { exitCode, stderr } = await Bun.spawnSync({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    // Should succeed because is-odd is excluded
    expect(exitCode).toBe(0);
    expect(stderr.toString()).not.toContain("error");
  }, 20000);

  test("allows old packages", async () => {
    const dir = tempDirWithFiles("min-age-old", {
      "bunfig.toml": `
[install]
minimumReleaseAge = 1440
`,
      "package.json": JSON.stringify({
        name: "test-old",
        dependencies: {
          // is-odd hasn't been updated since 2022
          "is-odd": "3.0.1",
        },
      }),
    });

    const { exitCode, stderr } = await Bun.spawnSync({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    expect(exitCode).toBe(0);
    expect(stderr.toString()).not.toContain("error");
  }, 20000);
});
