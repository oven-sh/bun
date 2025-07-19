import { test, expect } from "bun:test";
import { tempDirWithFiles, bunExe, bunEnv } from "harness";
import { join } from "path";

test("favicon should appear in Bun.embeddedFiles after compilation", async () => {
  const dir = tempDirWithFiles("favicon-compile-test", {
    "main.ts": `
// Test if favicon appears in Bun.embeddedFiles
console.log("All embedded files:");
for (const file of Bun.embeddedFiles) {
  console.log("- File name:", file.name, "Type:", file.type, "Size:", file.size);
}

console.log("\\nLooking for favicon in embedded files...");
const faviconFile = Bun.embeddedFiles.find(f => f.name.includes("favicon"));
if (faviconFile) {
  console.log("SUCCESS: Found favicon in embedded files:", faviconFile.name);
  process.exit(0);
} else {
  console.log("FAIL: Favicon not found in embedded files");
  process.exit(1);
}
    `,
    "index.html": `<!DOCTYPE html>
<html>
<head>
  <title>Favicon Test</title>
  <link rel="icon" href="./favicon.svg" type="image/svg+xml">
</head>
<body>
  <h1>Favicon Test Page</h1>
</body>
</html>`,
    "favicon.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="10" fill="#007acc"/>
  <text x="12" y="16" text-anchor="middle" fill="white" font-size="12">B</text>
</svg>`,
  });

  // Test with compilation to include HTML file as entry point
  const compileResult = await Bun.spawn({
    cmd: [bunExe(), "build", "main.ts", "index.html", "--compile", "--outfile", "main"],
    cwd: dir,
    env: bunEnv,
  });
  
  const [compileStdout, compileStderr] = await Promise.all([
    new Response(compileResult.stdout).text(),
    new Response(compileResult.stderr).text(),
  ]);
  
  console.log("Compile stdout:", compileStdout);
  console.log("Compile stderr:", compileStderr);
  
  expect(compileResult.exitCode).toBe(0);
  
  // Run the compiled executable and check if favicon appears in embedded files
  const runResult = await Bun.spawn({
    cmd: [join(dir, "main")],
    cwd: dir,
    env: bunEnv,
  });
  
  const [stdout, stderr] = await Promise.all([
    new Response(runResult.stdout).text(),
    new Response(runResult.stderr).text(),
  ]);
  
  console.log("Run stdout:", stdout);
  console.log("Run stderr:", stderr);
  
  // The test should pass if the favicon is found in embedded files
  expect(stdout).toContain("SUCCESS: Found favicon in embedded files");
  expect(runResult.exitCode).toBe(0);
});