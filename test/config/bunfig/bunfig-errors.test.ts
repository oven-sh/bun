import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe.concurrent("bunfig.toml type-mismatch error messages", () => {
  const cases: [config: string, expected: string][] = [
    [`smol = "yes"`, "expected boolean but received string"],
    [`logLevel = 3`, "expected string but received number"],
    [`telemetry = "no"`, "expected boolean but received string"],
    [`define = 3`, "expected object but received number"],
    [`[serve]\nport = "abc"`, "expected number but received string"],
    // [install] booleans must hard-error on wrong type, not silently drop the
    // guard (frozenLockfile = "true" previously left the lockfile unfrozen).
    [`[install]\nfrozenLockfile = "true"`, "expected boolean but received string"],
    [`[install]\nignoreScripts = "true"`, "expected boolean but received string"],
    [`[install]\nproduction = "true"`, "expected boolean but received string"],
    [`[install]\ndryRun = "true"`, "expected boolean but received string"],
    [`[install]\nsaveTextLockfile = "true"`, "expected boolean but received string"],
    [`[install]\nexact = "true"`, "expected boolean but received string"],
    [`[install]\noptional = "false"`, "expected boolean but received string"],
    [`[install]\npeer = "false"`, "expected boolean but received string"],
    [`[install]\ndev = "false"`, "expected boolean but received string"],
    [`[install]\nglobalStore = "true"`, "expected boolean but received string"],
    [`[install]\nlinkWorkspacePackages = "true"`, "expected boolean but received string"],
    [`[install]\nconcurrentScripts = "4"`, "expected number but received string"],
    [`[install]\nconcurrentScripts = -1`, "Expected a non-negative finite number for concurrentScripts"],
    [`[install]\nglobalDir = true`, "expected string but received boolean"],
    [`[install]\nglobalBinDir = true`, "expected string but received boolean"],
    [`[install]\nlockfile = 5`, "expected object but received number"],
    [`[install]\ncache = 5`, "Expected cache to be a boolean, string, or object"],
    [`[install.lockfile]\nsave = "true"`, "expected boolean but received string"],
    [`[install.lockfile]\npath = true`, "expected string but received boolean"],
    [`[install.lockfile]\nsavePath = true`, "expected string but received boolean"],
    [`[install.cache]\ndisable = "true"`, "expected boolean but received string"],
    [`[install.cache]\ndisableManifest = "true"`, "expected boolean but received string"],
    [`[install.cache]\ndir = true`, "expected string but received boolean"],
  ];

  test.each(cases)("%s -> %s", async (config, expected) => {
    using dir = tempDir("bunfig-type-mismatch", {
      "bunfig.toml": config + "\n",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "1"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const errorLine = stderr.split("\n").find(l => l.startsWith("error:")) ?? stderr;
    expect(errorLine).toBe(`error: ${expected}`);
    expect(stderr).not.toMatch(/\be_(string|boolean|number|object|array|null)\b/);
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  });
});

describe.concurrent("bunfig.toml [install] correctly-typed values still accepted", () => {
  const cases: string[] = [
    `[install]\nfrozenLockfile = true`,
    `[install]\nignoreScripts = true`,
    `[install]\nproduction = true`,
    `[install]\nexact = true\ndev = false\noptional = false\npeer = false`,
    `[install]\nsaveTextLockfile = true\ndryRun = true\nglobalStore = true\nlinkWorkspacePackages = true`,
    `[install]\nconcurrentScripts = 4\nglobalDir = "/tmp"\nglobalBinDir = "/tmp"`,
    `[install.lockfile]\nsave = true\npath = "bun.lock"\nsavePath = "bun.lock"`,
    `[install.cache]\ndisable = true\ndisableManifest = true\ndir = "/tmp"`,
    `[install]\ncache = false`,
    `[install]\ncache = "/tmp"`,
  ];

  test.each(cases)("%s", async config => {
    using dir = tempDir("bunfig-install-valid", {
      "bunfig.toml": config + "\n",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log('ok')"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("ok\n");
    expect(exitCode).toBe(0);
  });
});
