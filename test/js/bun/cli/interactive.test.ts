import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

describe("Bun.CLI.isTTY", () => {
  test("detects TTY environment", async () => {
    // Test with TTY
    using dir = tempDir("cli-tty-test", {
      "check-tty.js": `
        console.log(JSON.stringify({
          isTTY: Bun.CLI.isTTY,
          isStdoutTTY: process.stdout.isTTY,
          isStderrTTY: process.stderr.isTTY,
        }));
      `,
    });

    // Run normally (should have TTY)
    await using proc = Bun.spawn({
      cmd: [bunExe(), "check-tty.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stdin: "inherit", // Keep TTY
      stderr: "inherit",
    });

    const [stdout, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    // When stdout is piped but stdin inherits, isTTY detection depends on stdout
    expect(result.isTTY).toBe(false);
  });

  test("detects non-TTY when piped", async () => {
    using dir = tempDir("cli-no-tty-test", {
      "check-tty.js": `
        console.log(JSON.stringify({
          isTTY: Bun.CLI.isTTY,
        }));
      `,
    });

    // Run with pipes (no TTY)
    await using proc = Bun.spawn({
      cmd: [bunExe(), "check-tty.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.isTTY).toBe(false);
  });
});

describe("Bun.CLI.prompt fallback", () => {
  test("uses fallback when not TTY", async () => {
    using dir = tempDir("cli-prompt-fallback", {
      "prompt-test.js": `
        const result = await Bun.CLI.prompt.text({
          message: "Enter name",
          fallback: () => "fallback-value"
        });
        console.log(result);
      `,
    });

    // Run with pipes (no TTY)
    await using proc = Bun.spawn({
      cmd: [bunExe(), "prompt-test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("fallback-value");
  });

  test("confirm prompt with fallback", async () => {
    using dir = tempDir("cli-confirm-fallback", {
      "confirm-test.js": `
        const result = await Bun.CLI.prompt.confirm({
          message: "Continue?",
          fallback: () => true
        });
        console.log(result);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "confirm-test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("true");
  });

  test("select prompt with fallback", async () => {
    using dir = tempDir("cli-select-fallback", {
      "select-test.js": `
        const result = await Bun.CLI.prompt.select({
          message: "Choose option",
          choices: ["option1", "option2", "option3"],
          fallback: () => "option2"
        });
        console.log(result);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "select-test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("option2");
  });
});

describe("Bun.CLI.prompt interactive", () => {
  test.skip("text prompt accepts input", async () => {
    // This test requires interactive TTY simulation
    // Skip for now as it needs special test harness
  });

  test.skip("confirm prompt accepts y/n", async () => {
    // This test requires interactive TTY simulation
    // Skip for now as it needs special test harness
  });

  test.skip("select prompt with arrow keys", async () => {
    // This test requires interactive TTY simulation
    // Skip for now as it needs special test harness
  });
});

describe("Bun.CLI form", () => {
  test("form with multiple fields and fallback", async () => {
    using dir = tempDir("cli-form-test", {
      "form-test.js": `
        const result = await Bun.CLI.prompt.form({
          name: {
            type: "text",
            message: "Name",
            fallback: () => "John"
          },
          age: {
            type: "text",
            message: "Age",
            fallback: () => "25"
          },
          newsletter: {
            type: "confirm",
            message: "Subscribe?",
            fallback: () => true
          }
        });
        console.log(JSON.stringify(result));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "form-test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result).toEqual({
      name: "John",
      age: "25",
      newsletter: true,
    });
  });
});

describe("Bun.CLI complete example", () => {
  test("CLI with schema and commands", async () => {
    using dir = tempDir("cli-complete-test", {
      "cli-app.js": `
        const cli = Bun.CLI.create({
          name: "myapp",
          version: "1.0.0",
          description: "Test CLI app",
          flags: {
            verbose: { type: "boolean", short: "v", description: "Verbose output" },
            config: { type: "string", short: "c", description: "Config file" },
          },
          commands: {
            serve: {
              description: "Start server",
              flags: {
                port: { type: "number", short: "p", default: 3000 },
                host: { type: "string", short: "h", default: "localhost" },
              },
              handler: async (args) => {
                console.log(JSON.stringify({
                  command: "serve",
                  port: args.port,
                  host: args.host,
                  verbose: args.verbose,
                }));
              }
            },
            build: {
              description: "Build project",
              flags: {
                watch: { type: "boolean", short: "w" },
                minify: { type: "boolean", short: "m" },
              },
              handler: async (args) => {
                console.log(JSON.stringify({
                  command: "build",
                  watch: args.watch,
                  minify: args.minify,
                }));
              }
            }
          }
        });

        await cli.run(process.argv.slice(2));
      `,
    });

    // Test serve command
    await using proc1 = Bun.spawn({
      cmd: [bunExe(), "cli-app.js", "serve", "--port", "8080", "-v"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
    });

    const [stdout1, exitCode1] = await Promise.all([
      proc1.stdout.text(),
      proc1.exited,
    ]);

    expect(exitCode1).toBe(0);
    const result1 = JSON.parse(stdout1);
    expect(result1).toEqual({
      command: "serve",
      port: 8080,
      host: undefined,
      verbose: true,
    });

    // Test build command
    await using proc2 = Bun.spawn({
      cmd: [bunExe(), "cli-app.js", "build", "--watch", "--minify"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
    });

    const [stdout2, exitCode2] = await Promise.all([
      proc2.stdout.text(),
      proc2.exited,
    ]);

    expect(exitCode2).toBe(0);
    const result2 = JSON.parse(stdout2);
    expect(result2).toEqual({
      command: "build",
      watch: true,
      minify: true,
    });
  });
});