import { expect, test } from "bun:test";
import { writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("watch mode should poll for missing module and reload when it appears", async () => {
  using dir = tempDir("watch-missing-external", {
    "entry.js": `
console.log("Starting...");
require("./missing.js");
console.log("This should not print on first run");
`,
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), "--watch", "entry.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait a bit for the process to start and hit the error
  await new Promise(resolve => setTimeout(resolve, 500));

  // Now write the missing file from outside the process
  writeFileSync(join(String(dir), "missing.js"), "console.log('Module loaded!'); process.exit(0);");

  const timeout = setTimeout(() => {
    proc.kill();
  }, 5000);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    clearTimeout(timeout);

    console.log("STDOUT:", stdout);
    console.log("STDERR:", stderr);
    console.log("Exit code:", exitCode);

    // The test passes if the process exits with code 0
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Module loaded!");
  } catch (err) {
    clearTimeout(timeout);
    proc.kill();
    throw err;
  }
}, 10000);
