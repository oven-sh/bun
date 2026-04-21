import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/28042
// Dynamic import() with { with: { type: 'text' } } on .html files
// was not applying the loader from import attributes, causing
// --compile builds to fail with "require_bar is not defined".

test("dynamic import with type: 'text' attribute works with --compile for .html files", async () => {
  using dir = tempDir("issue-28042", {
    "index.ts": `const foo = await import('./bar.html', { with: { type: 'text' } });
console.log(foo.default);`,
    "bar.html": `<h1>Hello</h1>`,
  });

  // Build with --compile
  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "index.ts", "--compile", "--outfile", `${dir}/out`],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [buildStderr, buildExitCode] = await Promise.all([buildProc.stderr.text(), buildProc.exited]);

  expect(buildStderr).not.toContain("error");
  expect(buildExitCode).toBe(0);

  // Run the compiled binary
  await using runProc = Bun.spawn({
    cmd: [`${dir}/out`],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([runProc.stdout.text(), runProc.stderr.text(), runProc.exited]);

  expect(stdout.trim()).toBe("<h1>Hello</h1>");
  expect(exitCode).toBe(0);
});

test("dynamic import with type: 'text' attribute works with bundle for .html files", async () => {
  using dir = tempDir("issue-28042-bundle", {
    "index.ts": `const foo = await import('./bar.html', { with: { type: 'text' } });
console.log(foo.default);`,
    "bar.html": `<h1>Hello</h1>`,
  });

  // Build without --compile (regular bundle)
  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "index.ts", "--outfile", `${dir}/out.js`],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [buildStderr, buildExitCode] = await Promise.all([buildProc.stderr.text(), buildProc.exited]);

  expect(buildStderr).not.toContain("error");
  expect(buildExitCode).toBe(0);

  // Run the bundled output
  await using runProc = Bun.spawn({
    cmd: [bunExe(), `${dir}/out.js`],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([runProc.stdout.text(), runProc.stderr.text(), runProc.exited]);

  expect(stdout.trim()).toBe("<h1>Hello</h1>");
  expect(exitCode).toBe(0);
});
