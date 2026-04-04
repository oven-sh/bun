// https://github.com/oven-sh/bun/issues/28813
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

async function runBunxWithFakeGit(pkg: string) {
  using dir = tempDir(`bunx-28813-${Math.random().toString(36).slice(2, 8)}-`, {
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
    cmd: [bunExe(), "x", `--package=${pkg}`, "somebin"],
    env,
    cwd: join(String(dir), "cwd"),
    stderr: "pipe",
    stdout: "ignore",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  const gitLog = await Bun.file(gitLogFile).text();
  const cloneUrls = gitLog
    .split("\n")
    .filter(line => line.startsWith("clone"))
    .map(line => {
      // `clone … <url> <target>` — URL is the second-to-last token.
      const tokens = line.split(/\s+/);
      return tokens[tokens.length - 2];
    });

  return { stderr, exitCode, cloneUrls };
}

test.skipIf(isWindows)("bunx --package=<scp-url> does not mangle the git URL", async () => {
  // A fake `git` logs its arguments to a file, then exits non-zero so the
  // package manager bails out of the resolve step with the error to inspect.
  const { stderr, exitCode, cloneUrls } = await runBunxWithFakeGit("git@private-repo.example:organization/repo.git");

  expect(cloneUrls.length).toBeGreaterThan(0);
  for (const url of cloneUrls) {
    // No `somebin@git@…` double-userinfo splice, and the real host must survive.
    expect(url).not.toContain("somebin@git@");
    expect(url).toContain("private-repo.example");
    expect(url).not.toMatch(/somebin@/);
  }

  expect(stderr).not.toContain("https://somebin@git@");
  expect(stderr).not.toContain("ssh://git@somebin@git@");

  // Expected to fail because our fake git exits 128.
  expect(exitCode).not.toBe(0);
});

test.skipIf(isWindows)("trySSH does not truncate the last 4 bytes of unrecognised SCP hosts", async () => {
  // Bare SCP-style URL with a host not in the known-hosts table routes
  // through trySSH's fallback branch, which previously returned a slice
  // that was 4 bytes short of the actual `ssh://git@host/path.git`
  // buffer, silently dropping `.git`.
  const { exitCode, cloneUrls } = await runBunxWithFakeGit("myhost.example:org/repo.git");

  expect(cloneUrls.length).toBeGreaterThan(0);
  // Every logged URL should still end with `.git` — nothing chopped off.
  for (const url of cloneUrls) {
    expect(url).toMatch(/\.git$/);
  }

  expect(exitCode).not.toBe(0);
});
