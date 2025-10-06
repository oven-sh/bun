import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "path";

test("--compile should not load .env by default", async () => {
  using dir = tempDir("compile-dotenv-default", {
    "index.js": /* js */ `
      console.log(process.env.MY_SECRET_VAR || "not set");
    `,
    ".env": `MY_SECRET_VAR=secret_value`,
  });

  // Compile the executable
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).not.toContain("error");
  expect(stderr).not.toContain("panic");

  // Run the compiled executable
  await using execProc = Bun.spawn({
    cmd: [join(String(dir), "index")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [execStdout, execStderr, execExitCode] = await Promise.all([
    execProc.stdout.text(),
    execProc.stderr.text(),
    execProc.exited,
  ]);

  expect(execExitCode).toBe(0);
  expect(normalizeBunSnapshot(execStdout, dir)).toMatchInlineSnapshot(`"not set"`);
});

test("--compile with --env should load .env", async () => {
  using dir = tempDir("compile-dotenv-with-flag", {
    "index.js": /* js */ `
      console.log(process.env.MY_SECRET_VAR || "not set");
    `,
    ".env": `MY_SECRET_VAR=secret_value`,
  });

  // Compile the executable with --env
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--env=*", "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).not.toContain("error");

  // Run the compiled executable
  await using execProc = Bun.spawn({
    cmd: [join(String(dir), "index")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [execStdout, execStderr, execExitCode] = await Promise.all([
    execProc.stdout.text(),
    execProc.stderr.text(),
    execProc.exited,
  ]);

  expect(execExitCode).toBe(0);
  expect(normalizeBunSnapshot(execStdout, dir)).toMatchInlineSnapshot(`"secret_value"`);
});

test("--compile with --env prefix should only load matching vars", async () => {
  using dir = tempDir("compile-dotenv-prefix", {
    "index.js": /* js */ `
      console.log("PUBLIC:", process.env.PUBLIC_VAR || "not set");
      console.log("PRIVATE:", process.env.PRIVATE_VAR || "not set");
    `,
    ".env": `PUBLIC_VAR=public_value
PRIVATE_VAR=private_value`,
  });

  // Compile the executable with --env prefix
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--env=PUBLIC_*", "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).not.toContain("error");

  // Run the compiled executable
  await using execProc = Bun.spawn({
    cmd: [join(String(dir), "index")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [execStdout, execStderr, execExitCode] = await Promise.all([
    execProc.stdout.text(),
    execProc.stderr.text(),
    execProc.exited,
  ]);

  expect(execExitCode).toBe(0);
  expect(normalizeBunSnapshot(execStdout, dir)).toMatchInlineSnapshot(`
"PUBLIC: public_value
PRIVATE: not set"
`);
});
