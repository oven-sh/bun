import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

setDefaultTimeout(1000 * 60 * 5);

function envWithCache(dir: string) {
  return { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache") };
}

// Use git+https://git@ format to force the git clone + findCommit path
// rather than the GitHub tarball download path.
const gitUrlBase = "git+https://git@github.com/jonschlinkert/is-number.git";

async function runInstallWithCommittish(dirName: string, committish: string, expected: { shouldReject: boolean }) {
  using dir = tempDir(dirName, {
    "package.json": JSON.stringify({
      name: "test-project",
      version: "1.0.0",
      dependencies: {
        "is-number": `${gitUrlBase}#${committish}`,
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: envWithCache(String(dir)),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (expected.shouldReject) {
    expect(stderr).toContain(`invalid committish "${committish}" for "is-number"`);
    expect(exitCode).toBe(1);
  } else {
    expect(stderr).not.toContain("invalid committish");
    expect(stderr).toContain("Saved lockfile");
    expect(exitCode).toBe(0);
  }
}

describe("git committish validation", () => {
  it("should reject committish starting with a dash (flag injection)", async () => {
    await runInstallWithCommittish("committish-dash", "--output=/tmp/pwn", { shouldReject: true });
  });

  it("should reject committish that is a single dash flag", async () => {
    await runInstallWithCommittish("committish-flag", "-v", { shouldReject: true });
  });

  it("should accept valid committish with tag", async () => {
    await runInstallWithCommittish("committish-valid-tag", "7.0.0", { shouldReject: false });
  });

  it("should accept valid committish with short commit hash", async () => {
    await runInstallWithCommittish("committish-valid-hash", "98e8ff1", { shouldReject: false });
  });
});
