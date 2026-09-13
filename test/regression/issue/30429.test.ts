// https://github.com/oven-sh/bun/issues/30429
import { afterAll, describe, expect, test } from "bun:test";
import { randomBytes } from "crypto";
import { rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

const rootFile = `/bun-regression-30429-${process.pid}-${randomBytes(6).toString("hex")}.js`;
let canWriteRoot = false;
if (!isWindows) {
  try {
    writeFileSync(rootFile, `module.exports = "root-ok";\nconsole.log("root-ok");\n`, { flag: "wx" });
    canWriteRoot = true;
  } catch {
    // non-root environments (e.g. macOS CI): describe below is skipped
  }
}

// POSIX filesystem root only; Windows drive roots are a separate shape.
describe.concurrent.skipIf(isWindows || !canWriteRoot)("module directly under filesystem root", () => {
  afterAll(() => {
    if (canWriteRoot) rmSync(rootFile, { force: true });
  });

  test("run", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), rootFile],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: "root-ok", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("require from a subdirectory", async () => {
    using dir = tempDir("issue-30429-require", {
      "c.js": `console.log(require(${JSON.stringify(rootFile)}));\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "c.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: "root-ok\nroot-ok", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("dynamic import from a subdirectory", async () => {
    using dir = tempDir("issue-30429-import", {
      "c.mjs": `const m = await import(${JSON.stringify(rootFile)});\nconsole.log(m.default);\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "c.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: "root-ok\nroot-ok", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("bun build", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--target=bun", rootFile],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toContain("root-ok");
    expect(exitCode).toBe(0);
  });
});
