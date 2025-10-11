// Regression test for issue #14096: --port should not affect file imports
// https://github.com/oven-sh/bun/issues/14096
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("--port should not convert file imports to HTTP URLs", async () => {
  using dir = tempDir("issue-14096", {
    "index.js": `
      import txt from "./test.txt" with { type: "file" };
      console.log(txt);
    `,
    "test.txt": "hello world",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--port", "3000", "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  // Should print the file path, NOT http://localhost:3000/test.txt
  const output = stdout.trim();
  expect(output).not.toContain("http://");
  expect(output).not.toContain("localhost");
  expect(output).not.toContain("3000");
  expect(output).toEndWith("test.txt");
});

test("--port should not affect asset imports (image files)", async () => {
  using dir = tempDir("issue-14096-assets", {
    "index.js": `
      import bmp from "./abc.bmp" with { type: "file" };
      console.log(bmp);
    `,
    "abc.bmp": "fake bmp data",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--port", "4000", "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  // Should print the file path, NOT http://localhost:4000/abc.bmp
  const output = stdout.trim();
  expect(output).not.toContain("http://");
  expect(output).not.toContain("localhost");
  expect(output).not.toContain("4000");
  expect(output).toEndWith("abc.bmp");
});

test("file imports work without --port flag (baseline)", async () => {
  using dir = tempDir("issue-14096-baseline", {
    "index.js": `
      import txt from "./test.txt" with { type: "file" };
      console.log(txt);
    `,
    "test.txt": "hello world",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  // Should print the file path
  const output = stdout.trim();
  expect(output).toEndWith("test.txt");
});
