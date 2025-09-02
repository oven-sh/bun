import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles, isWindows } from "harness";
import { join } from "path";

// Test for GitHub issue #22317: Directory entry points with --compile cause panic  
test("--compile should handle directory entry points without panic", async () => {
  const dir = tempDirWithFiles("directory-resolve-test", {
    "src/index.ts": `console.log("Main entry point");`,
    "public/assets/index.js": `console.log("Directory resolved to index");`, // Directory should resolve to this
    "public/index.html": `<!DOCTYPE html><html><body><h1>Test</h1></body></html>`,
    "public/assets/style.css": `body { margin: 0; }`,
    "src/server.worker.ts": `console.log("Worker");`,
  });

  // This combination with a directory entry point previously caused:
  // "panic(main thread): index out of bounds: index 4, len 4"
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", 
      "./src/index.ts",
      "./public/assets", // Directory should resolve to ./public/assets/index.js
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

  // Should not panic and should handle directory resolution properly
  if (exitCode !== 0) {
    console.log("stdout:", stdout);
    console.log("stderr:", stderr);
  }

  expect(exitCode).toBe(0); // Should succeed - directories are valid if they resolve to index files

  // Clean up the generated executable to avoid running out of disk space
  try {
    const executablePath = join(dir, "build/app");
    if (await Bun.file(executablePath).exists()) {
      await Bun.$`rm -f ${executablePath}`;
    }
  } catch {
    // Ignore cleanup errors
  }
});

