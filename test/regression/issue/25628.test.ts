import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/25628
// Bug: Lazy code-splitting chunks are not accessible via frontend.files in fullstack builds
// when using --splitting with --compile. The chunks are physically written to disk and embedded
// in the executable, but they're filtered out when accessing the embedded files array.

test("lazy chunks from code splitting should appear in frontend.files", { timeout: 60000 }, async () => {
  using dir = tempDir("issue-25628", {
    // Server entry that prints frontend.files and exits
    "server.ts": `
      import frontend from "./client.html";

      // Get all file paths from frontend.files
      const filePaths = frontend.files?.map((f: any) => f.path) ?? [];

      // Count the number of chunk files (lazy chunks are named chunk-xxx.js)
      const chunkCount = filePaths.filter((p: string) =>
        p.includes("chunk-")
      ).length;

      // There should be at least 2 chunks:
      // 1. The main app entry chunk
      // 2. The lazy-loaded chunk from the dynamic import
      console.log("CHUNK_COUNT:" + chunkCount);
      console.log("FILES:" + filePaths.join(","));

      // Exit immediately after printing
      process.exit(0);
    `,
    "client.html": `<!DOCTYPE html>
<html>
<head>
  <script type="module" src="./main.js"></script>
</head>
<body></body>
</html>`,
    "main.js": `
      // Dynamic import creates a lazy chunk
      const lazyMod = () => import("./lazy.js");
      lazyMod().then(m => m.hello());
    `,
    "lazy.js": `
      export function hello() {
        console.log("Hello from lazy module!");
      }
    `,
  });

  // Build with splitting and compile
  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "server.ts", "--splitting", "--outfile", "server"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
    buildProc.stdout.text(),
    buildProc.stderr.text(),
    buildProc.exited,
  ]);

  expect(buildStderr).not.toContain("error:");
  expect(buildExitCode).toBe(0);

  // Run the compiled executable
  const serverPath = isWindows ? "server.exe" : "./server";
  await using runProc = Bun.spawn({
    cmd: [serverPath],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [runStdout, runStderr, runExitCode] = await Promise.all([
    runProc.stdout.text(),
    runProc.stderr.text(),
    runProc.exited,
  ]);

  // There should be at least 2 chunk files in frontend.files:
  // one for the main entry and one for the lazy-loaded module
  expect(runStdout).toMatch(/CHUNK_COUNT:[2-9]/);
  expect(runExitCode).toBe(0);
});
