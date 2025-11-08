import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("Bun.build with outfile - basic usage", async () => {
  using dir = tempDir("bundler-outfile", {
    "entry.ts": `console.log("hello from entry");`,
  });

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `await Bun.build({
        entrypoints: ["${join(dir, "entry.ts")}"],
        target: "node",
        outfile: "${join(dir, "bundle.js")}"
      }); console.log("done");`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("error");
  expect(stderr).not.toContain("panic");
  expect(exitCode).toBe(0);

  const bundlePath = join(dir, "bundle.js");
  expect(existsSync(bundlePath)).toBe(true);

  const content = readFileSync(bundlePath, "utf8");
  expect(content).toContain("hello from entry");
});

test("Bun.build with outfile - subdirectory", async () => {
  using dir = tempDir("bundler-outfile-subdir", {
    "src/entry.ts": `console.log("hello from src");`,
  });

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `await Bun.build({
        entrypoints: ["${join(dir, "src/entry.ts")}"],
        target: "node",
        outfile: "${join(dir, "dist/output.js")}"
      });`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("error");
  expect(exitCode).toBe(0);

  const bundlePath = join(dir, "dist/output.js");
  expect(existsSync(bundlePath)).toBe(true);

  const content = readFileSync(bundlePath, "utf8");
  expect(content).toContain("hello from src");
});

test("Bun.build with outfile - validation: multiple entry points", async () => {
  using dir = tempDir("bundler-outfile-multi-entry", {
    "entry1.ts": `console.log("entry1");`,
    "entry2.ts": `console.log("entry2");`,
  });

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `try {
        await Bun.build({
          entrypoints: ["${join(dir, "entry1.ts")}", "${join(dir, "entry2.ts")}"],
          target: "node",
          outfile: "${join(dir, "out.js")}"
        });
        console.log("UNEXPECTED SUCCESS");
      } catch(e) {
        console.log(e.message);
      }`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("Cannot use 'outfile' with multiple entry points");
  expect(exitCode).toBe(0);
});

test("Bun.build with outfile - validation: outfile + outdir", async () => {
  using dir = tempDir("bundler-outfile-both", {
    "entry.ts": `console.log("entry");`,
  });

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `try {
        await Bun.build({
          entrypoints: ["${join(dir, "entry.ts")}"],
          target: "node",
          outfile: "${join(dir, "out.js")}",
          outdir: "${join(dir, "dist")}"
        });
        console.log("UNEXPECTED SUCCESS");
      } catch(e) {
        console.log(e.message);
      }`,
    ],
    env: bunEnv,
    stdout: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toContain("Cannot use both 'outfile' and 'outdir'");
  expect(exitCode).toBe(0);
});

test("Bun.build with outfile - validation: code splitting", async () => {
  using dir = tempDir("bundler-outfile-splitting", {
    "entry.ts": `console.log("entry");`,
  });

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `try {
        await Bun.build({
          entrypoints: ["${join(dir, "entry.ts")}"],
          target: "node",
          outfile: "${join(dir, "out.js")}",
          splitting: true
        });
        console.log("UNEXPECTED SUCCESS");
      } catch(e) {
        console.log(e.message);
      }`,
    ],
    env: bunEnv,
    stdout: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toContain("Cannot use 'outfile' when code splitting is enabled");
  expect(exitCode).toBe(0);
});

test("Bun.build with outfile matches CLI --outfile behavior", async () => {
  using dir = tempDir("bundler-outfile-cli-match", {
    "test.ts": `export const value = 42; console.log("test");`,
  });

  // Test with API
  await using proc1 = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `await Bun.build({
        entrypoints: ["${join(dir, "test.ts")}"],
        target: "node",
        outfile: "${join(dir, "api-output.js")}"
      });`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const apiExitCode = await proc1.exited;

  // Test with CLI
  await using proc2 = Bun.spawn({
    cmd: [bunExe(), "build", join(dir, "test.ts"), "--target=node", `--outfile=${join(dir, "cli-output.js")}`],
    env: bunEnv,
    stderr: "pipe",
  });

  const cliExitCode = await proc2.exited;

  expect(apiExitCode).toBe(0);
  expect(cliExitCode).toBe(0);

  const apiOutput = readFileSync(join(dir, "api-output.js"), "utf8");
  const cliOutput = readFileSync(join(dir, "cli-output.js"), "utf8");

  // Both should produce similar output
  expect(apiOutput).toContain("value = 42");
  expect(cliOutput).toContain("value = 42");
  expect(existsSync(join(dir, "api-output.js"))).toBe(true);
  expect(existsSync(join(dir, "cli-output.js"))).toBe(true);
});
