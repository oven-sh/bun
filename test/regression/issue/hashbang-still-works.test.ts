import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDirWithFiles } from "harness";
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
    expect(normalizeBunSnapshot(Bun.inspect((e as AggregateError).errors[0]), dir)).toMatchInlineSnapshot(`
      "1 | #
          ^
      error: Syntax Error
          at <dir>/single-hash.js:1:1"
    `);
  }
});

test("lexer should not crash on single # character", async () => {
  const dir = tempDirWithFiles("single-hash", {
    "single-hash.js": "#",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "single-hash.js"],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
  });

  const snapshot = normalizeBunSnapshot(Bun.inspect(await proc.stderr.text()), dir);

  expect(snapshot).toMatchInlineSnapshot(
    `""1 | #/n    ^/nerror: Syntax Error/n    at <dir>/single-hash.js:1:1/n/nBun v<bun-version>-canary.1+9616cfed8 (macOS arm64)/n""`,
  );
});
