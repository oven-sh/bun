import { spawnSync } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

describe("bun run --silent", () => {
  it("-s works as shorthand for --silent", async () => {
    const dir = tempDirWithFiles("silent-test", {
      "package.json": JSON.stringify({
        name: "test-silent",
        scripts: {
          test: "echo 'Hello from script'",
        },
      }),
    });

    // Test with --silent
    const silentResult = spawnSync({
      cmd: [bunExe(), "run", "--silent", "test"],
      cwd: String(dir),
      env: bunEnv,
    });

    // Test with -s
    const shortResult = spawnSync({
      cmd: [bunExe(), "run", "-s", "test"],
      cwd: String(dir),
      env: bunEnv,
    });

    // Both should have the same behavior - no script command printed
    expect(silentResult.stdout.toString()).toBe("Hello from script\n");
    expect(silentResult.stderr.toString()).toBe("");
    expect(silentResult.exitCode).toBe(0);

    expect(shortResult.stdout.toString()).toBe("Hello from script\n");
    expect(shortResult.stderr.toString()).toBe("");
    expect(shortResult.exitCode).toBe(0);

    // Verify script output is the same for both
    expect(shortResult.stdout.toString()).toBe(silentResult.stdout.toString());
  });

  it("-s silences script command output just like --silent", async () => {
    const dir = tempDirWithFiles("silent-test-2", {
      "package.json": JSON.stringify({
        name: "test-silent-2",
        scripts: {
          greet: "echo 'Greetings'",
        },
      }),
    });

    // Test without any silent flag
    const normalResult = spawnSync({
      cmd: [bunExe(), "run", "greet"],
      cwd: String(dir),
      env: bunEnv,
    });

    // Test with -s
    const shortResult = spawnSync({
      cmd: [bunExe(), "run", "-s", "greet"],
      cwd: String(dir),
      env: bunEnv,
    });

    // Normal run should include the script command being printed
    expect(normalResult.stderr.toString()).toContain("$ echo 'Greetings'");
    expect(normalResult.stdout.toString()).toBe("Greetings\n");

    // -s should suppress the command output
    expect(shortResult.stderr.toString()).toBe("");
    expect(shortResult.stdout.toString()).toBe("Greetings\n");
  });

  it("-s works with bun (AutoCommand)", async () => {
    const dir = tempDirWithFiles("silent-auto", {
      "package.json": JSON.stringify({
        name: "test-auto",
        scripts: {
          start: "echo 'Starting app'",
        },
      }),
    });

    // Test with -s using AutoCommand (no explicit 'run')
    const result = spawnSync({
      cmd: [bunExe(), "-s", "start"],
      cwd: String(dir),
      env: bunEnv,
    });

    expect(result.stdout.toString()).toBe("Starting app\n");
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  });
});