import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "../../harness";

describe("BUN_OPTIONS environment variable", () => {
  test("basic usage - passes options to bun command", () => {
    const result = spawnSync({
      cmd: [bunExe()],
      env: {
        ...bunEnv,
        BUN_OPTIONS: "--print='BUN_OPTIONS WAS A SUCCESS'",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("BUN_OPTIONS WAS A SUCCESS");
  });

  test("multiple options - passes all options to bun command", () => {
    const result = spawnSync({
      cmd: [bunExe()],
      env: {
        ...bunEnv,
        BUN_OPTIONS: "--print='MULTIPLE OPTIONS' --quiet",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("MULTIPLE OPTIONS");
  });

  test("options with quotes - properly handles quoted options", () => {
    const result = spawnSync({
      cmd: [bunExe()],
      env: {
        ...bunEnv,
        BUN_OPTIONS: '--print="QUOTED OPTIONS"',
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("QUOTED OPTIONS");
  });

  test("priority - environment options go before command line options", () => {
    // First BUN_OPTIONS arg should be inserted before command line args
    const result = spawnSync({
      cmd: [bunExe(), "--print='COMMAND LINE'"],
      env: {
        ...bunEnv,
        BUN_OPTIONS: "--quiet",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("COMMAND LINE");
  });

  test("empty BUN_OPTIONS - should work normally", () => {
    const result = spawnSync({
      cmd: [bunExe(), "--print='NORMAL'"],
      env: {
        ...bunEnv,
        BUN_OPTIONS: "",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("NORMAL");
  });
});

describe("NODE_OPTIONS environment variable", () => {
  test("basic usage - passes options to bun command", () => {
    const result = spawnSync({
      cmd: [bunExe()],
      env: {
        ...bunEnv,
        NODE_OPTIONS: "--print='NODE_OPTIONS WAS A SUCCESS'",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("NODE_OPTIONS WAS A SUCCESS");
  });

  test("multiple options - passes all options to bun command", () => {
    const result = spawnSync({
      cmd: [bunExe()],
      env: {
        ...bunEnv,
        NODE_OPTIONS: "--print='MULTIPLE OPTIONS' --quiet",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("MULTIPLE OPTIONS");
  });

  test("BUN_OPTIONS takes precedence over NODE_OPTIONS", () => {
    const result = spawnSync({
      cmd: [bunExe()],
      env: {
        ...bunEnv,
        NODE_OPTIONS: "--print='NODE'",
        BUN_OPTIONS: "--print='BUN'",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("BUN");
    expect(result.stdout.toString()).not.toContain("NODE");
  });

  test("NODE_OPTIONS works when BUN_OPTIONS is not set", () => {
    const result = spawnSync({
      cmd: [bunExe()],
      env: {
        ...bunEnv,
        NODE_OPTIONS: "--print='FALLBACK TO NODE_OPTIONS'",
        BUN_OPTIONS: undefined,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("FALLBACK TO NODE_OPTIONS");
  });
});
