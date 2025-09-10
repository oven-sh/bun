import { test, expect } from "bun:test";
import { tempDir, bunEnv, bunExe } from "harness";
import { join } from "path";

test("Bun.build with env: 'disable' should not inline process.env.NODE_ENV (issue #19508)", async () => {
  using dir = tempDir("build-env-disable", {
    "input.js": `console.log(process.env.NODE_ENV);`,
    "build.js": `
      import { build } from "bun";
      
      const result = await build({
        entrypoints: ["./input.js"],
        outdir: "./dist",
        env: "disable",
      });
      
      if (!result.success) {
        throw new Error("Build failed");
      }
    `,
  });

  // Run the build
  const buildProc = Bun.spawn({
    cmd: [bunExe(), "build.js"],
    env: { ...bunEnv, NODE_ENV: "production" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
    buildProc.stdout.text(),
    buildProc.stderr.text(),
    buildProc.exited,
  ]);

  expect(buildExitCode).toBe(0);

  // Read the output file
  const outputFile = Bun.file(join(String(dir), "dist", "input.js"));
  const outputContent = await outputFile.text();

  // The output should contain process.env.NODE_ENV, not the inlined value
  expect(outputContent).toContain("process.env.NODE_ENV");
  expect(outputContent).not.toContain('"production"');
  expect(outputContent).not.toContain('"development"');

  // Also test that it works correctly at runtime
  const runProc = Bun.spawn({
    cmd: [bunExe(), join("dist", "input.js")],
    env: { ...bunEnv, NODE_ENV: "test-runtime" },
    cwd: String(dir),
    stdout: "pipe",
  });

  const [runStdout, runExitCode] = await Promise.all([
    runProc.stdout.text(),
    runProc.exited,
  ]);

  expect(runExitCode).toBe(0);
  expect(runStdout.trim()).toBe("test-runtime");
});

test("Bun.build CLI with --env=disable should not inline process.env.NODE_ENV", async () => {
  using dir = tempDir("build-cli-env-disable", {
    "input.js": `console.log(process.env.NODE_ENV);`,
  });

  // Run the build via CLI
  const buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "./input.js", "--outdir", "./dist", "--env=disable"],
    env: { ...bunEnv, NODE_ENV: "production" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
    buildProc.stdout.text(),
    buildProc.stderr.text(),
    buildProc.exited,
  ]);

  expect(buildExitCode).toBe(0);

  // Read the output file
  const outputFile = Bun.file(join(String(dir), "dist", "input.js"));
  const outputContent = await outputFile.text();

  // The output should contain process.env.NODE_ENV, not the inlined value
  expect(outputContent).toContain("process.env.NODE_ENV");
  expect(outputContent).not.toContain('"production"');
  expect(outputContent).not.toContain('"development"');
});

test("Bun.build with env: 'inline' should inline process.env.NODE_ENV", async () => {
  using dir = tempDir("build-env-inline", {
    "input.js": `console.log(process.env.NODE_ENV);`,
    "build.js": `
      import { build } from "bun";
      
      const result = await build({
        entrypoints: ["./input.js"],
        outdir: "./dist",
        env: "inline",
      });
      
      if (!result.success) {
        throw new Error("Build failed");
      }
    `,
  });

  // Run the build with NODE_ENV=production
  const buildProc = Bun.spawn({
    cmd: [bunExe(), "build.js"],
    env: { ...bunEnv, NODE_ENV: "production" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
    buildProc.stdout.text(),
    buildProc.stderr.text(),
    buildProc.exited,
  ]);

  expect(buildExitCode).toBe(0);

  // Read the output file
  const outputFile = Bun.file(join(String(dir), "dist", "input.js"));
  const outputContent = await outputFile.text();

  // The output should contain the inlined value, not process.env.NODE_ENV
  expect(outputContent).not.toContain("process.env.NODE_ENV");
  expect(outputContent).toContain('"production"');
});