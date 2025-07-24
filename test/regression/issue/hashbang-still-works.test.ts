import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDirWithFiles } from "harness";
import path from "path";

test("hashbang still works after bounds check fix", async () => {
  const dir = tempDirWithFiles("hashbang", {
    "script.js": "#!/usr/bin/env node\nconsole.log('hello');",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "script.js"],
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
  } catch (e) {
    expect(normalizeBunSnapshot(Bun.inspect(e!.errors[0]), dir)).toMatchInlineSnapshot(`
      "1 | #
          ^
      error: Syntax Error
          at <dir>/single-hash.js:1:1"
    `);
  }
});
