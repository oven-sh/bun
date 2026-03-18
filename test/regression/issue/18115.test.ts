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
    const [stdout, , exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
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
    const [stdout, , exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
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
    const [stdout, , exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
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
    const [stdout, , exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
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
  const [stdout, , exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
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
  const [stdout1, , exitCode1] = await Promise.all([
    new Response(proc1.stdout).text(),
    new Response(proc1.stderr).text(),
    proc1.exited,
  ]);
  expect(stdout1).toBe("æ™弟気👋\n");
  expect(exitCode1).toBe(0);

  // Second run — restores from cache
  await using proc2 = Bun.spawn({
    cmd: [bunExe(), String(dir) + "/index.ts"],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout2, , exitCode2] = await Promise.all([
    new Response(proc2.stdout).text(),
    new Response(proc2.stderr).text(),
    proc2.exited,
  ]);
  expect(stdout2).toBe("æ™弟気👋\n");
  expect(exitCode2).toBe(0);
});

test("String.raw with non-ASCII after bun build", async () => {
  using dir = tempDir("string-raw-unicode", {
    "index.ts": "console.log(String.raw`æ™弟気👋`);",
  });

  // Build
  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "--target", "bun", "--outfile", String(dir) + "/out.js", String(dir) + "/index.ts"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, , buildExitCode] = await Promise.all([
    new Response(buildProc.stdout).text(),
    new Response(buildProc.stderr).text(),
    buildProc.exited,
  ]);
  expect(buildExitCode).toBe(0);

  // Run the built output
  await using proc = Bun.spawn({
    cmd: [bunExe(), String(dir) + "/out.js"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(stdout).toBe("æ™弟気👋\n");
  expect(exitCode).toBe(0);
});
