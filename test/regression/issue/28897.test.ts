import { expect, test } from "bun:test";
import { chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/28897
//
// `bun add git+ssh://user@host:PORT/path/to/repo.git` used to hang, because:
//   1. Bun would first try `git clone https://user@host:PORT/...` — speaking
//      HTTPS to the SSH port hangs waiting for a response that never comes.
//   2. When it fell through to SSH, hosted_git_info.correctUrl() would
//      replace the `:` in `:PORT/` with `/`, turning the port into a path
//      segment (`ssh://user@host/PORT/...`), so the SSH attempt went to the
//      default port 22 with a bogus path.
//
// The fix: when a `ssh://` URL has an explicit numeric port, leave it alone
// in trySSH() and skip the HTTPS fallback entirely in tryHTTPS().
test.skipIf(isWindows)(
  "bun add git+ssh://user@host:PORT/... preserves the port in the git clone URL",
  async () => {
    using dir = tempDir("bun-28897", {
      "package.json": JSON.stringify({ name: "test-28897", version: "0.0.0" }),
      "bin/git": `#!/bin/sh
echo "$@" >> "$BUN_TEST_GIT_TRACE"
# Exit non-zero so bun gives up instead of waiting on a real network call.
exit 1
`,
    });
    const gitWrapper = join(String(dir), "bin/git");
    chmodSync(gitWrapper, 0o755);

    const tracePath = join(String(dir), "git-trace.log");

    // Use an unlikely hostname so that even if the wrapper script somehow
    // fell through to the real git, DNS would fail rather than hang.
    const url = "git+ssh://git@example.invalid:9999/myuser/myrepo.git";

    await using proc = Bun.spawn({
      cmd: [bunExe(), "add", "--no-save", url],
      env: {
        ...bunEnv,
        BUN_TEST_GIT_TRACE: tracePath,
        PATH: `${join(String(dir), "bin")}:${bunEnv.PATH}`,
      },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [_stdout, _stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    // The install should fail (our fake git returns 1), not hang.
    expect(exitCode).not.toBe(0);

    const trace = readFileSync(tracePath, "utf8");

    // Each git clone attempt is one line like:
    //   clone -c core.longpaths=true --quiet --bare <url> <target>
    // Find the URL argument in each clone command.
    const cloneUrls: string[] = [];
    for (const line of trace.split("\n")) {
      if (!line.startsWith("clone ")) continue;
      const parts = line.split(/\s+/);
      // The URL is the second-to-last token (the last is the target path).
      if (parts.length >= 2) cloneUrls.push(parts[parts.length - 2]);
    }

    // We must have attempted at least one clone.
    expect(cloneUrls.length).toBeGreaterThan(0);

    for (const cloneUrl of cloneUrls) {
      // The port must be preserved as `:9999/…`, not turned into a path
      // segment `/9999/…`. And we must not speak HTTPS to the SSH port.
      expect(cloneUrl).not.toContain("/9999/");
      expect(cloneUrl).not.toContain("https://git@example.invalid:9999");
      // Sanity: the host must still be there with the explicit port.
      expect(cloneUrl).toContain("example.invalid:9999/myuser/myrepo.git");
      // And it must be an SSH URL (the user explicitly asked for SSH).
      expect(cloneUrl.startsWith("ssh://") || cloneUrl.startsWith("git+ssh://")).toBe(true);
    }
  },
);
