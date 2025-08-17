import { test, expect } from "bun:test";
import { tempDirWithFiles, bunEnv } from "harness";
import path from "path";

test("asset cache race condition should not panic", async () => {
  // This test ensures that when there's an inconsistency between bundled_files and assets.path_map,
  // the bundler gracefully handles the missing asset hash instead of panicking
  
  const dir = tempDirWithFiles("asset-cache-race", {
    "index.html": `
<!DOCTYPE html>
<html>
<head>
    <title>Test</title>
</head>
<body>
    <img src="./test.png" alt="test">
    <div style="background: url('./test.png')"></div>
</body>
</html>
    `,
    "test.png": Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
      "base64"
    ),
    "app.ts": `
import './test.png';
console.log("Hello from app.ts");
    `,
  });

  // Test HTML bundling with assets
  const proc1 = Bun.spawn({
    cmd: [
      process.execPath,
      "build", 
      "index.html",
      "--outdir=dist",
    ],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout1, stderr1, exitCode1] = await Promise.all([
    proc1.stdout.text(),
    proc1.stderr.text(),
    proc1.exited,
  ]);

  // Should not panic or crash
  expect(exitCode1).toBe(0);
  expect(stderr1).not.toContain("panic");
  expect(stderr1).not.toContain("cached asset not found");

  // Test TS bundling with assets
  const proc2 = Bun.spawn({
    cmd: [
      process.execPath,
      "build", 
      "app.ts",
      "--outdir=dist2",
    ],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout2, stderr2, exitCode2] = await Promise.all([
    proc2.stdout.text(),
    proc2.stderr.text(),
    proc2.exited,
  ]);

  // Should not panic or crash
  expect(exitCode2).toBe(0);
  expect(stderr2).not.toContain("panic");
  expect(stderr2).not.toContain("cached asset not found");
});