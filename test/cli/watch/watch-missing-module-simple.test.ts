import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("watch mode should detect missing module error", async () => {
  using dir = tempDir("watch-missing-simple", {
    "entry.js": `
console.log("Starting...");
try {
  require("./missing.js");
} catch (err) {
  console.log("ERROR:", err.code);
  console.log("Caught error for missing module");
  const fs = require("fs");
  const path = require("path");

  // Write the missing file after a short delay
  setTimeout(() => {
    console.log("Writing missing.js");
    fs.writeFileSync(path.join(__dirname, "missing.js"), "console.log('Module loaded!'); process.exit(0);");
  }, 100);

  // Re-throw so watch mode sees it
  throw err;
}
`,
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), "--watch", "entry.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

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
  } catch (err) {
    clearTimeout(timeout);
    proc.kill();
    throw err;
  }
}, 10000);
