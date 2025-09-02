import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

// Test for GitHub issue #22317: Directory entry points with --compile cause crash
test("--compile should reject directories with proper error message", async () => {
  const dir = tempDirWithFiles("windows-compile-test", {
    "src/index.ts": `console.log("Hello from compiled app");`,
    "public/index.html": `<!DOCTYPE html><html><body><h1>Test</h1></body></html>`,
    "public/assets/style.css": `body { margin: 0; }`,
    "src/server.worker.ts": `console.log("Worker");`,
  });

  // This combination with a directory entry point previously caused:
  // "panic(main thread): index out of bounds: index 4, len 4"
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", 
      "./src/index.ts",
      "./public/assets", // This is a directory - should be rejected
      "./public/index.html",
      "./public/assets/style.css",
      "./src/server.worker.ts",
      "--outfile", "build/app"
    ],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // The fix should reject directories with a proper error message, not crash
  if (exitCode !== 0) {
    console.log("stdout:", stdout);
    console.log("stderr:", stderr);
  }

  expect(stderr).not.toContain("panic");
  expect(stderr).not.toContain("index out of bounds");
  expect(stderr).toContain("is a directory. --compile requires explicit file paths, not directories.");
  expect(exitCode).toBe(1); // Should exit with error due to invalid directory entry point
});

