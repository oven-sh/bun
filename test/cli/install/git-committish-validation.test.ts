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

describe("git committish validation", () => {
  it("should reject committish starting with a dash", async () => {
    using dir = tempDir("committish-dash", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "is-number": `${gitUrlBase}#--output=/tmp/pwn`,
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

    expect(stderr).toContain("invalid committish");
    expect(exitCode).toBe(1);
  });

  it("should reject committish that is a single dash flag", async () => {
    using dir = tempDir("committish-flag", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "is-number": `${gitUrlBase}#-v`,
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

    expect(stderr).toContain("invalid committish");
    expect(exitCode).toBe(1);
  });

  it("should reject committish starting with a dot", async () => {
    using dir = tempDir("committish-dot", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "is-number": `${gitUrlBase}#.hidden`,
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

    expect(stderr).toContain("invalid committish");
    expect(exitCode).toBe(1);
  });

  it("should reject committish containing '..'", async () => {
    using dir = tempDir("committish-dotdot", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "is-number": `${gitUrlBase}#main..HEAD`,
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

    expect(stderr).toContain("invalid committish");
    expect(exitCode).toBe(1);
  });

  it("should accept valid committish with tag", async () => {
    using dir = tempDir("committish-valid-tag", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "is-number": `${gitUrlBase}#7.0.0`,
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

    expect(stderr).not.toContain("invalid committish");
    expect(stderr).toContain("Saved lockfile");
    expect(exitCode).toBe(0);
  });

  it("should accept valid committish with short commit hash", async () => {
    using dir = tempDir("committish-valid-hash", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "is-number": `${gitUrlBase}#98e8ff1`,
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

    expect(stderr).not.toContain("invalid committish");
    expect(stderr).toContain("Saved lockfile");
    expect(exitCode).toBe(0);
  });
});
