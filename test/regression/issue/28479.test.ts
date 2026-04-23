import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("process.loadEnvFile", () => {
  test("loads .env file and sets variables in process.env", async () => {
    using dir = tempDir("loadEnvFile", {
      "test.env": "FOO_28479=hello\nBAR_28479=world\n",
      "index.js": `
        process.loadEnvFile('./test.env');
        console.log(process.env.FOO_28479);
        console.log(process.env.BAR_28479);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("hello\nworld\n");
    expect(exitCode).toBe(0);
  });

  test("defaults to .env when no path is given", async () => {
    using dir = tempDir("loadEnvFile-default", {
      ".env": "DEFAULT_28479=yes\n",
      "index.js": `
        process.loadEnvFile();
        console.log(process.env.DEFAULT_28479);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--no-env-file", "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("yes\n");
    expect(exitCode).toBe(0);
  });

  test("throws TypeError when file does not exist", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        try {
          process.loadEnvFile('./nonexistent.env');
          console.log("FAIL: no error thrown");
        } catch (err) {
          console.log(err instanceof TypeError);
          console.log(err.message.includes("Cannot read the .env file"));
        }
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("true\ntrue\n");
    expect(exitCode).toBe(0);
  });

  test("supports quoted values and comments", async () => {
    using dir = tempDir("loadEnvFile-quoted", {
      "test.env": `
QUOTED_28479="hello world"
SINGLE_28479='no expansion'
COMMENT_28479=value # inline comment
`,
      "index.js": `
        process.loadEnvFile('./test.env');
        console.log(process.env.QUOTED_28479);
        console.log(process.env.SINGLE_28479);
        console.log(process.env.COMMENT_28479);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("hello world\nno expansion\nvalue\n");
    expect(exitCode).toBe(0);
  });

  test("is importable as named export from node:process", async () => {
    using dir = tempDir("loadEnvFile-import", {
      "test.env": "NAMED_28479=imported\n",
      "index.mjs": `
        import { loadEnvFile } from 'node:process';
        loadEnvFile('./test.env');
        console.log(process.env.NAMED_28479);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("imported\n");
    expect(exitCode).toBe(0);
  });

  test("loaded vars are visible in child processes", async () => {
    using dir = tempDir("loadEnvFile-subprocess", {
      "test.env": "CHILD_28479=from_env_file\n",
      "index.js": `
        const { loadEnvFile } = require('node:process');
        loadEnvFile('./test.env');
        const child = Bun.spawn([process.execPath, '-e', 'console.log(process.env.CHILD_28479)'], {
          env: { ...process.env },
        });
        const text = await new Response(child.stdout).text();
        console.log(text.trim());
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("from_env_file\n");
    expect(exitCode).toBe(0);
  });

  test("overrides existing env vars", async () => {
    using dir = tempDir("loadEnvFile-override", {
      "test.env": "OVERRIDE_28479=new_value\n",
      "index.js": `
        process.env.OVERRIDE_28479 = "old_value";
        process.loadEnvFile('./test.env');
        console.log(process.env.OVERRIDE_28479);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("new_value\n");
    expect(exitCode).toBe(0);
  });
});
