// https://github.com/oven-sh/bun/issues/30429
//
// `PathName::init` leaves `.dir` empty when the only separator is the leading
// one (e.g. `/a.js`). `dir_info_cached_maybe_log` used to assert that its
// input was absolute, so any module directly under `/` would panic the
// resolver with `cannot resolve DirInfo for non-absolute path:` before it
// could run.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// POSIX filesystem root only; Windows drive roots are a separate shape.
describe.skipIf(isWindows)("module directly under filesystem root", () => {
  const rootFile = `/bun-regression-30429-${process.pid}.js`;
  let canWriteRoot = false;

  beforeAll(() => {
    try {
      writeFileSync(rootFile, `module.exports = "root-ok";\nconsole.log("root-ok");\n`);
      canWriteRoot = true;
    } catch {
      // macOS CI and other non-root environments: fall through to skip below.
    }
  });

  afterAll(() => {
    if (canWriteRoot) rmSync(rootFile, { force: true });
  });

  test("run", async () => {
    if (!canWriteRoot) return;
    await using proc = Bun.spawn({
      cmd: [bunExe(), rootFile],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: "root-ok", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("require from a subdirectory", async () => {
    if (!canWriteRoot) return;
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
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: "root-ok\nroot-ok", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("dynamic import from a subdirectory", async () => {
    if (!canWriteRoot) return;
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
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: "root-ok\nroot-ok", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("bun build", async () => {
    if (!canWriteRoot) return;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--target=bun", rootFile],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(stdout).toContain("root-ok");
    expect(exitCode).toBe(0);
  });
});
