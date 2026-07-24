import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync } from "node:fs";
import { join } from "node:path";

// A fake `git` that logs its argv to a file and exits 128 so the package
// manager falls through HTTPS -> SSH without touching the network. The SSH
// attempt is what exercises `Repository::try_ssh`'s scp-style fallback.
async function cloneUrlsFor(dep: string): Promise<{ urls: string[]; stderr: string }> {
  using dir = tempDir("install-git-scp", {
    "fakegit/git": `#!/bin/sh\nprintf '%s\\n' "$*" >> "$GIT_LOG_FILE"\nexit 128\n`,
    "cwd/package.json": JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: { pkg: dep },
    }),
  });
  chmodSync(join(String(dir), "fakegit", "git"), 0o755);

  const gitLogFile = join(String(dir), "git.log");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: join(String(dir), "cwd"),
    env: {
      ...bunEnv,
      PATH: `${join(String(dir), "fakegit")}:${bunEnv.PATH}`,
      GIT_LOG_FILE: gitLogFile,
      BUN_INSTALL_CACHE_DIR: join(String(dir), "cache"),
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const gitLog = await Bun.file(gitLogFile)
    .text()
    .catch(() => "");
  const urls = gitLog
    .split("\n")
    .filter(line => line.startsWith("clone"))
    .map(line => {
      // `git clone -c core.longpaths=true --quiet --bare <url> <target>`
      const tokens = line.split(/\s+/);
      return tokens[tokens.length - 2];
    });
  return { urls, stderr };
}

describe.skipIf(isWindows)("scp-style git dependency URL rewriting", () => {
  const cloneFailed = expect.stringContaining(`"git clone" for "pkg" failed`);

  test.concurrent("host with TLD preserves full path on SSH fallback", async () => {
    expect(await cloneUrlsFor("git+myhost.example:org/repo.git")).toEqual({
      urls: ["https://myhost.example/org/repo.git", "ssh://git@myhost.example/org/repo.git"],
      stderr: cloneFailed,
    });
  });

  test.concurrent("bare known host gets TLD appended", async () => {
    expect(await cloneUrlsFor("git+github:mishoo/UglifyJS.git")).toEqual({
      urls: ["https://github.com/mishoo/UglifyJS.git", "ssh://git@github.com/mishoo/UglifyJS.git"],
      stderr: cloneFailed,
    });
  });

  test.concurrent("explicit user@ is kept (no double user)", async () => {
    expect(await cloneUrlsFor("git+deploy@myhost.example:org/repo.git")).toEqual({
      urls: ["https://deploy@myhost.example/org/repo.git", "ssh://deploy@myhost.example/org/repo.git"],
      stderr: cloneFailed,
    });
  });

  test.concurrent("explicit user@ is kept (colon-less form)", async () => {
    expect(await cloneUrlsFor("git+deploy@myhost.example/org/repo.git")).toEqual({
      urls: ["https://deploy@myhost.example/org/repo.git", "ssh://deploy@myhost.example/org/repo.git"],
      stderr: cloneFailed,
    });
  });

  test.concurrent("@ in path does not suppress git@ user", async () => {
    expect(await cloneUrlsFor("git+myhost.example:org/name@1.git")).toEqual({
      urls: ["https://myhost.example/org/name@1.git", "ssh://git@myhost.example/org/name@1.git"],
      stderr: cloneFailed,
    });
  });
});
