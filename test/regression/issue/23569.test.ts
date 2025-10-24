import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("bun build --no-bundle with HTML entrypoint should error with helpful message - issue #23569", async () => {
  using dir = tempDir("23569-html-no-bundle", {
    "index.html": `<!DOCTYPE html>
<html>
  <head>
    <script src="./script.js"></script>
  </head>
  <body>
    <h1>Test</h1>
  </body>
</html>`,
    "script.js": `console.log('Hello');`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./index.html", "--no-bundle"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain("HTML imports are only supported when bundling");
});

test("bun build --no-bundle with HTML entrypoint and --outdir should also error - issue #23569", async () => {
  using dir = tempDir("23569-html-no-bundle-outdir", {
    "index.html": `<!DOCTYPE html>
<html>
  <head>
    <script src="./script.js"></script>
  </head>
  <body>
    <h1>Test</h1>
  </body>
</html>`,
    "script.js": `console.log('Hello');`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./index.html", "--outdir", "./build", "--no-bundle"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain("HTML imports are only supported when bundling");
});

test("bun build with HTML entrypoint without --no-bundle should succeed", async () => {
  using dir = tempDir("23569-html-bundle", {
    "index.html": `<!DOCTYPE html>
<html>
  <head>
    <script src="./script.js"></script>
  </head>
  <body>
    <h1>Test</h1>
  </body>
</html>`,
    "script.js": `console.log('Hello');`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./index.html", "--outdir", "./build"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).not.toContain("HTML imports are only supported when bundling");
});
