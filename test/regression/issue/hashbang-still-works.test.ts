import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import path from "path";

test("hashbang still works after bounds check fix", async () => {
  const dir = tempDirWithFiles("hashbang", {
    "script.js": "#!/usr/bin/env bun\nconsole.log('hello');",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--bun", "script.js"],
    env: bunEnv,
    cwd: dir,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout.trim()).toBe("hello");
});

test("lexer handles single # character without bounds error", async () => {
  const dir = tempDirWithFiles("single-hash", {
    "single-hash.js": "#",
  });

  // Using Bun.build to exercise the lexer directly
  try {
    await Bun.build({
      entrypoints: [path.join(dir, "single-hash.js")],
      target: "node",
    });
    expect.unreachable();
  } catch (e: any) {
    const errorMessage = Bun.inspect((e as AggregateError).errors[0]);
    expect(errorMessage).toContain("error: Syntax Error");
  }
});

test("lexer should not crash on single # character", () => {
  const dir = tempDirWithFiles("single-hash", {
    "single-hash.js": "#",
  });

  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "single-hash.js"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(exitCode).toBe(1);
  const output = stdout.toString() + stderr.toString();
  expect(output).toContain("error: Syntax Error");
});
