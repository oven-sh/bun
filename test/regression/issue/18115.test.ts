import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("String.raw preserves non-ASCII characters", () => {
  test("Chinese characters", async () => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", "const text = String.raw`a中`; for (const char of text) { console.log(char); }"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(stdout).toBe("a\n中\n");
    expect(exitCode).toBe(0);
  });

  test("accented characters", async () => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log(String.raw`Redémarrage`)"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(stdout).toBe("Redémarrage\n");
    expect(exitCode).toBe(0);
  });

  test("emoji and CJK characters", async () => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log(String.raw`æ™弟気👋`)"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(stdout).toBe("æ™弟気👋\n");
    expect(exitCode).toBe(0);
  });

  test("template expressions with non-ASCII", async () => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", 'console.log(String.raw`before中${"middle"}after弟`)'],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(stdout).toBe("before中middleafter弟\n");
    expect(exitCode).toBe(0);
  });
});

test("RegExp source preserves non-ASCII characters", async () => {
  const proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log(/æ™/.source)"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(stdout).toBe("æ™\n");
  expect(exitCode).toBe(0);
});

test("String.raw with non-ASCII after bun build", async () => {
  using dir = tempDir("string-raw-unicode", {
    "index.ts": "console.log(String.raw`æ™弟気👋`);",
  });

  // Build
  const buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "--target", "bun", "--outfile", String(dir) + "/out.js", String(dir) + "/index.ts"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await buildProc.exited).toBe(0);

  // Run the built output
  const proc = Bun.spawn({
    cmd: [bunExe(), String(dir) + "/out.js"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(stdout).toBe("æ™弟気👋\n");
  expect(exitCode).toBe(0);
});
