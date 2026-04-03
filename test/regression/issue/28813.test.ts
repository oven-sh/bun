// https://github.com/oven-sh/bun/issues/28813
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

test.skipIf(isWindows)("bunx --package=<scp-url> does not mangle the git URL", async () => {
  // A fake `git` that logs its arguments to a file, then exits non-zero so
  // the package manager bails out of the resolve step with the error we
  // need to inspect.
  using dir = tempDir("bunx-28813-", {
    "fakegit/git": `#!/bin/sh\nprintf '%s\\n' "$*" >> "$GIT_LOG_FILE"\nexit 128\n`,
    "cwd/package.json": "{}\n",
  });

  const gitLogFile = join(String(dir), "git-cmds.log");
  writeFileSync(gitLogFile, "");
  chmodSync(join(String(dir), "fakegit", "git"), 0o755);

  const env = {
    ...bunEnv,
    GIT_LOG_FILE: gitLogFile,
    PATH: `${join(String(dir), "fakegit")}:${bunEnv.PATH}`,
  };

  await using proc = Bun.spawn({
    cmd: [bunExe(), "x", "--package=git@private-repo.example:organization/repo.git", "somebin"],
    env,
    cwd: join(String(dir), "cwd"),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  const gitLog = await Bun.file(gitLogFile).text();
  expect(gitLog.length).toBeGreaterThan(0);

  // Every `git clone` attempt must target the real host, not the binary name.
  const cloneLines = gitLog.split("\n").filter(line => line.startsWith("clone"));
  expect(cloneLines.length).toBeGreaterThan(0);
  for (const line of cloneLines) {
    // The URL is the second-to-last token in the `git clone … <url> <target>` line.
    const tokens = line.split(/\s+/);
    const url = tokens[tokens.length - 2];
    expect(url).not.toContain("somebin@git@");
    expect(url).toContain("private-repo.example");
    // Sanity: the user portion (if any) is just `git`, not `somebin@git`.
    expect(url).not.toMatch(/somebin@/);
  }

  // And the install failure itself must reference the real URL, not a
  // binary-prefixed mangled form pointing at a different host.
  expect(stderr).not.toContain("https://somebin@git@");
  expect(stderr).not.toContain("ssh://git@somebin@git@");

  // Expected to fail because our fake git exits 128.
  expect(exitCode).not.toBe(0);
});
