import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

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
