import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("watch mode should poll for missing modules", async () => {
  using dir = tempDir("watch-missing-module", {
    "entry.js": `
try {
  require("./missing.js");
} catch (err) {
  // Write the missing file
  const fs = require("fs");
  const path = require("path");
  fs.writeFileSync(path.join(__dirname, "missing.js"), "process.exit(0);");

  // Re-throw so watch mode sees the error and starts polling
  throw err;
}

// If we get here without the file existing, something went wrong
setTimeout(() => {
  process.exit(1);
}, 5000);
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
  }, 10000);

  try {
    const exitCode = await proc.exited;
    clearTimeout(timeout);

    // The test passes if the process exits with code 0
    // This means the missing file was created and executed successfully
    expect(exitCode).toBe(0);
  } catch (err) {
    clearTimeout(timeout);
    proc.kill();
    throw err;
  }
}, 15000);

test("watch mode should poll for missing modules with import", async () => {
  using dir = tempDir("watch-missing-module-import", {
    "entry.mjs": `
try {
  await import("./missing.mjs");
} catch (err) {
  // Write the missing file
  const fs = await import("fs");
  const path = await import("path");
  const url = await import("url");
  const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
  fs.writeFileSync(path.join(__dirname, "missing.mjs"), "process.exit(0);");

  // Re-throw so watch mode sees the error and starts polling
  throw err;
}

// If we get here without the file existing, something went wrong
setTimeout(() => {
  process.exit(1);
}, 5000);
`,
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), "--watch", "entry.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeout = setTimeout(() => {
    proc.kill();
  }, 10000);

  try {
    const exitCode = await proc.exited;
    clearTimeout(timeout);

    // The test passes if the process exits with code 0
    expect(exitCode).toBe(0);
  } catch (err) {
    clearTimeout(timeout);
    proc.kill();
    throw err;
  }
}, 15000);
