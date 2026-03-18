import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/22317
// bun build --compile crashes with "index out of bounds" when CSS files
// are passed as entry points alongside multiple JS/TS entry points.
// This happens when glob expansion (e.g. ./public/**/*) includes CSS files.
test("issue 22317: compile with CSS file entry points should not crash", async () => {
  const dir = tempDirWithFiles("22317", {
    "src/index.ts": `console.log("main");`,
    "src/server.worker.ts": `console.log("worker");`,
    "public/assets/index.css": `body { color: red; }`,
    "public/index.html": `<html></html>`,
  });

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      "--compile",
      "./src/index.ts",
      "./public/assets/index.css",
      "./src/server.worker.ts",
      "--outfile",
      "build/app",
    ],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("panic");
  expect(stderr).not.toContain("index out of bounds");
  expect(exitCode).toBe(0);
});
