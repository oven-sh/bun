import { spawnSync } from "bun";
import { describe, expect, it } from "bun:test";
import { bunExe } from "harness";

function cleanEnv(overrides: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  delete env.FORCE_COLOR;
  delete env.NO_COLOR;
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

describe("console.log with piped stdout", () => {
  it("should not emit ANSI escape codes when stdout is piped", () => {
    const { stdout, stderr } = spawnSync({
      cmd: [bunExe(), import.meta.dir + "/console-no-color-pipe.ts"],
      stdout: "pipe",
      stderr: "pipe",
      env: cleanEnv(),
    });

    const out = stdout.toString();
    const err = stderr.toString();

    // Neither piped stream should contain escape codes
    expect(out).not.toContain("\x1b[");
    expect(err).not.toContain("\x1b[");
    // Verify actual data is present
    expect(out).toContain("Map");
    expect(err).toContain("Map");
  });

  it("should emit ANSI escape codes on both streams when FORCE_COLOR is set", () => {
    const { stdout, stderr } = spawnSync({
      cmd: [bunExe(), import.meta.dir + "/console-no-color-pipe.ts"],
      stdout: "pipe",
      stderr: "pipe",
      env: cleanEnv({ FORCE_COLOR: "1" }),
    });

    const out = stdout.toString();
    const err = stderr.toString();
    expect(out).toContain("\x1b[");
    expect(err).toContain("\x1b[");
  });

  it("should not emit ANSI escape codes when NO_COLOR is set", () => {
    const { stdout, stderr } = spawnSync({
      cmd: [bunExe(), import.meta.dir + "/console-no-color-pipe.ts"],
      stdout: "pipe",
      stderr: "pipe",
      env: cleanEnv({ NO_COLOR: "1" }),
    });

    const out = stdout.toString();
    const err = stderr.toString();
    expect(out).not.toContain("\x1b[");
    expect(err).not.toContain("\x1b[");
  });
});
