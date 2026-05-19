import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("String.raw preserves non-ASCII characters", () => {
  test("Chinese characters", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "const text = String.raw`a中`; for (const char of text) { console.log(char); }"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("a\n中\n");
    expect(exitCode).toBe(0);
  });

  test("accented characters", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log(String.raw`Redémarrage`)"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("Redémarrage\n");
    expect(exitCode).toBe(0);
  });

  test("emoji and CJK characters", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log(String.raw`æ™弟気👋`)"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("æ™弟気👋\n");
    expect(exitCode).toBe(0);
  });

  test("template expressions with non-ASCII", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", 'console.log(String.raw`before中${"middle"}after弟`)'],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("before中middleafter弟\n");
    expect(exitCode).toBe(0);
  });
});

test("RegExp source preserves non-ASCII characters", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log(/æ™/.source)"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("æ™\n");
  expect(exitCode).toBe(0);
});

test("String.raw with non-ASCII via runtime transpiler cache", async () => {
  using dir = tempDir("string-raw-rtc", {
    // Pad to >50KB to exceed MINIMUM_CACHE_SIZE in RuntimeTranspilerCache.zig
    "index.ts": "console.log(String.raw`æ™弟気👋`);" + Buffer.alloc(64 * 1024, " ").toString(),
  });
  using cacheDir = tempDir("string-raw-rtc-cache", {});
  const env = { ...bunEnv, BUN_RUNTIME_TRANSPILER_CACHE_PATH: String(cacheDir) };

  // First run — populates the cache
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), String(dir) + "/index.ts"],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout1, stderr1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);
  expect(stderr1).toBe("");
  expect(stdout1).toBe("æ™弟気👋\n");
  expect(exitCode1).toBe(0);

  // Second run — restores from cache
  await using proc2 = Bun.spawn({
    cmd: [bunExe(), String(dir) + "/index.ts"],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);
  expect(stderr2).toBe("");
  expect(stdout2).toBe("æ™弟気👋\n");
  expect(exitCode2).toBe(0);
});

test("String.raw with non-ASCII after bun build", async () => {
  using dir = tempDir("string-raw-unicode", {
    "index.ts": "console.log(String.raw`æ™弟気👋`);",
  });

  // Build — `bun build` writes a summary to stderr by design, so only assert
  // absence of an error keyword rather than empty stderr.
  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "--target", "bun", "--outfile", String(dir) + "/out.js", String(dir) + "/index.ts"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, buildStderr, buildExitCode] = await Promise.all([
    buildProc.stdout.text(),
    buildProc.stderr.text(),
    buildProc.exited,
  ]);
  expect(buildStderr).not.toContain("error");
  expect(buildExitCode).toBe(0);

  // Run the built output
  await using proc = Bun.spawn({
    cmd: [bunExe(), String(dir) + "/out.js"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("æ™弟気👋\n");
  expect(exitCode).toBe(0);
});
