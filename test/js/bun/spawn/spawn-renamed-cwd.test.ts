import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/33819
// Spawning without an explicit `cwd` must inherit the parent's working
// directory instead of chdir'ing to a stored path string, which is stale
// after the cwd directory is renamed.
test.skipIf(isWindows)("spawn without explicit cwd works after the parent's cwd is renamed", async () => {
  using dir = tempDir("spawn-renamed-cwd", {
    "fixture.ts": `
      import { mkdirSync, renameSync, realpathSync } from "fs";
      import { execFileSync } from "child_process";
      import { join } from "path";

      const root = process.cwd();
      const installDir = join(root, "install");
      const renamedDir = join(root, "renamed");
      mkdirSync(installDir);
      process.chdir(installDir);

      // Rename the process's own cwd out from under it.
      renameSync(installDir, renamedDir);

      const sync = Bun.spawnSync(["/bin/echo", "sync-ok"]);
      console.log(sync.stdout.toString().trim());

      const proc = Bun.spawn(["/bin/echo", "async-ok"], { stdout: "pipe" });
      console.log((await proc.stdout.text()).trim());
      await proc.exited;

      console.log(execFileSync("/bin/echo", ["execFileSync-ok"]).toString().trim());

      // The child must inherit the parent's (renamed) working directory.
      const pwd = Bun.spawnSync([process.execPath, "-e", "console.log(process.cwd())"]);
      const childCwd = pwd.stdout.toString().trim();
      console.log(childCwd === realpathSync(renamedDir) ? "cwd-inherited" : "cwd-mismatch: " + childCwd);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim(), stderr).toBe("sync-ok\nasync-ok\nexecFileSync-ok\ncwd-inherited");
  expect(exitCode).toBe(0);
});

// An explicit `cwd` option must still chdir the child.
test.skipIf(isWindows)("spawn with explicit cwd still changes the child's directory", async () => {
  using dir = tempDir("spawn-explicit-cwd", { "sub/.keep": "" });
  const sub = join(String(dir), "sub");

  const sync = Bun.spawnSync({
    cmd: [bunExe(), "-e", "console.log(process.cwd())"],
    env: bunEnv,
    cwd: sub,
  });
  expect(sync.stdout.toString().trim()).toBe(realpathSync(sub));
  expect(sync.success).toBe(true);
});
