import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

describe("console depth", () => {
  const deepObject = {
    level1: {
      level2: {
        level3: {
          level4: {
            level5: {
              level6: {
                level7: {
                  level8: {
                    level9: {
                      level10: "deep value",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };

  const testScript = `console.log(${JSON.stringify(deepObject)});`;

  function normalizeOutput(output: string): string {
    // Normalize line endings and remove timestamps/file paths that might be flaky
    return output.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  }

  test("default console depth should be 8", async () => {
    const dir = tempDirWithFiles("console-depth-default", {
      "test.js": testScript,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    const output = normalizeOutput(stdout);
    // Should go to level 8 and show [Object ...] for level 9
    expect(output).toContain("level8");
    expect(output).toContain("level9: [Object ...]");
    expect(output).not.toContain("level10");
  });

  test("--console-depth flag sets custom depth", async () => {
    const dir = tempDirWithFiles("console-depth-cli", {
      "test.js": testScript,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--console-depth", "3", "test.js"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    const output = normalizeOutput(stdout);
    // Should go to level 3 and show [Object ...] for level 4
    expect(output).toContain("level3");
    expect(output).toContain("level4: [Object ...]");
    expect(output).not.toContain("level5");
    expect(output).not.toContain("level8");
  });

  test("--console-depth with higher value shows deeper nesting", async () => {
    const dir = tempDirWithFiles("console-depth-high", {
      "test.js": testScript,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--console-depth", "10", "test.js"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    const output = normalizeOutput(stdout);
    // Should show the full object including level 10
    expect(output).toContain("level10");
    expect(output).toContain("deep value");
    expect(output).not.toContain("[Object ...]");
  });

  test("bunfig.toml console.depth configuration", async () => {
    const dir = tempDirWithFiles("console-depth-bunfig", {
      "test.js": testScript,
      "bunfig.toml": `[console]\ndepth = 4`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    const output = normalizeOutput(stdout);
    // Should go to level 4 and show [Object ...] for level 5
    expect(output).toContain("level4");
    expect(output).toContain("level5: [Object ...]");
    expect(output).not.toContain("level6");
  });

  test("CLI flag overrides bunfig.toml", async () => {
    const dir = tempDirWithFiles("console-depth-override", {
      "test.js": testScript,
      "bunfig.toml": `[console]\ndepth = 6`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--console-depth", "2", "test.js"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    const output = normalizeOutput(stdout);
    // CLI should override bunfig: depth 2 instead of 6
    expect(output).toContain("level2");
    expect(output).toContain("level3: [Object ...]");
    expect(output).not.toContain("level4");
    expect(output).not.toContain("level6");
  });

  test("invalid --console-depth value shows error", async () => {
    const dir = tempDirWithFiles("console-depth-invalid", {
      "test.js": testScript,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--console-depth", "invalid", "test.js"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(1);
    // The error message should be somewhere in the output
    const allOutput = stdout + stderr;
    expect(allOutput).toContain("Invalid value for --console-depth");
    expect(allOutput).toContain("Must be a positive integer");
  });

  test("edge case: depth 0 should show only top level structure", async () => {
    const dir = tempDirWithFiles("console-depth-zero", {
      "test.js": testScript,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--console-depth", "0", "test.js"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    const output = normalizeOutput(stdout);
    // With depth 0, should show property names but not expand them
    expect(output).toContain("level1: [Object ...]");
    expect(output).not.toContain("level2");
  });

  test("console depth affects console.log, console.error, and console.warn", async () => {
    const testScriptMultiple = `
      const obj = ${JSON.stringify(deepObject)};
      console.log("LOG:", obj);
      console.error("ERROR:", obj);
      console.warn("WARN:", obj);
    `;

    const dir = tempDirWithFiles("console-depth-multiple", {
      "test.js": testScriptMultiple,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--console-depth", "2", "test.js"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);

    const allOutput = normalizeOutput(stdout + stderr);
    // All console methods should respect the depth setting
    expect(allOutput).toContain("LOG:");
    expect(allOutput).toContain("ERROR:");
    expect(allOutput).toContain("WARN:");
    expect(allOutput).toContain("level2");
    expect(allOutput).toContain("level3: [Object ...]");
    expect(allOutput).not.toContain("level4");
  });
});
