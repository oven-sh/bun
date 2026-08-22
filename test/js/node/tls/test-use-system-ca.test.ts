import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

describe("--use-system-ca", () => {
  test("flag loads system certificates", async () => {
    // Test that --use-system-ca loads system certificates
    await using proc = spawn({
      cmd: [bunExe(), "--use-system-ca", "-e", "console.log('OK')"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("OK");
    expect(stderr).toBe("");
  });

  test("NODE_USE_SYSTEM_CA=1 loads system certificates", async () => {
    // Test that NODE_USE_SYSTEM_CA environment variable works
    await using proc = spawn({
      cmd: [bunExe(), "-e", "console.log('OK')"],
      env: { ...bunEnv, NODE_USE_SYSTEM_CA: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("OK");
    expect(stderr).toBe("");
  });

  test("NODE_USE_SYSTEM_CA=0 doesn't load system certificates", async () => {
    // Test that NODE_USE_SYSTEM_CA=0 doesn't load system certificates
    await using proc = spawn({
      cmd: [bunExe(), "-e", "console.log('OK')"],
      env: { ...bunEnv, NODE_USE_SYSTEM_CA: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("OK");
    expect(stderr).toBe("");
  });

  test("--use-system-ca overrides NODE_USE_SYSTEM_CA=0", async () => {
    // Test that CLI flag takes precedence over environment variable
    await using proc = spawn({
      cmd: [bunExe(), "--use-system-ca", "-e", "console.log('OK')"],
      env: { ...bunEnv, NODE_USE_SYSTEM_CA: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("OK");
    expect(stderr).toBe("");
  });
});

// Print the length of `tls.getCACertificates('default')`. When the selected
// store is "system", this is bundled + system; otherwise it's bundled-only.
// We compare lengths across runs to verify that each configuration mechanism
// selects the expected store.
const probe = `const tls = require("tls"); console.log(tls.getCACertificates("default").length);`;

async function defaultCertCount(args: string[], extraEnv: Record<string, string | undefined> = {}, cwd?: string) {
  // Default to a fresh empty tempdir so callers without an explicit `cwd` don't
  // pick up an ambient bunfig.toml from the test runner's working directory.
  const probeCwd = cwd ?? tempDirWithFiles("bunfig-ca-empty", {});
  const env = { ...bunEnv, NODE_USE_SYSTEM_CA: undefined, ...extraEnv };
  await using proc = spawn({
    cmd: [bunExe(), ...args, "-e", probe],
    env: env as Record<string, string>,
    cwd: probeCwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const count = parseInt(stdout.trim(), 10);
  expect(exitCode).toBe(0);
  return count;
}

describe.concurrent("bunfig.toml CA", () => {
  test(`CA = "system" in bunfig.toml matches --use-system-ca`, async () => {
    const dir = tempDirWithFiles("bunfig-ca-system", {
      "bunfig.toml": `CA = "system"\n`,
    });

    const bunfigCount = await defaultCertCount([], {}, dir);
    const flagCount = await defaultCertCount(["--use-system-ca"]);
    const baselineCount = await defaultCertCount([]);

    // Whichever store is active, bunfig and the CLI flag pick the same one.
    expect(bunfigCount).toBe(flagCount);
    // Baseline (no flag, no env, no bunfig) uses bundled — bunfig "system"
    // is at least as large (equal when the machine has zero system certs).
    expect(bunfigCount).toBeGreaterThanOrEqual(baselineCount);
  });

  // `bun run <file>` defers its bunfig load to RunCommand.exec (it has to
  // resolve the script's directory first), so the CA precedence block in
  // Arguments.parse runs before ctx.runtime_options.ca_store is set. Make
  // sure the deferred load re-applies the bunfig value.
  test(`bun run <file> honors bunfig.toml CA`, async () => {
    const dir = tempDirWithFiles("bunfig-ca-run", {
      "bunfig.toml": `CA = "system"\n`,
      "probe.ts": `console.log(require("tls").getCACertificates("default").length);`,
    });

    await using proc = spawn({
      cmd: [bunExe(), "run", "probe.ts"],
      env: { ...bunEnv, NODE_USE_SYSTEM_CA: undefined } as Record<string, string>,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const runCount = parseInt(stdout.trim(), 10);
    const flagCount = await defaultCertCount(["--use-system-ca"]);
    expect(runCount).toBe(flagCount);
    expect(exitCode).toBe(0);
  });

  test(`CA = "bundled" in bunfig.toml matches bundled-only default`, async () => {
    const dir = tempDirWithFiles("bunfig-ca-bundled", {
      "bunfig.toml": `CA = "bundled"\n`,
    });

    const bunfigCount = await defaultCertCount([], {}, dir);
    const baselineCount = await defaultCertCount([]);
    expect(bunfigCount).toBe(baselineCount);
  });

  test(`CA = "openssl" in bunfig.toml matches --use-openssl-ca`, async () => {
    const dir = tempDirWithFiles("bunfig-ca-openssl", {
      "bunfig.toml": `CA = "openssl"\n`,
    });

    const bunfigCount = await defaultCertCount([], {}, dir);
    const flagCount = await defaultCertCount(["--use-openssl-ca"]);
    // bunfig "openssl" and the CLI flag should both land on the same store.
    expect(bunfigCount).toBe(flagCount);
  });

  test(`CLI --use-bundled-ca overrides bunfig CA = "system"`, async () => {
    const dir = tempDirWithFiles("bunfig-ca-cli-override", {
      "bunfig.toml": `CA = "system"\n`,
    });

    const bundledCount = await defaultCertCount(["--use-bundled-ca"], {}, dir);
    const baselineCount = await defaultCertCount([]);
    // CLI forcing bundled must match the plain bundled-only count, even
    // though bunfig asked for "system".
    expect(bundledCount).toBe(baselineCount);
  });

  test(`NODE_USE_SYSTEM_CA=1 overrides bunfig CA = "bundled"`, async () => {
    const dir = tempDirWithFiles("bunfig-ca-env-override", {
      "bunfig.toml": `CA = "bundled"\n`,
    });

    const envCount = await defaultCertCount([], { NODE_USE_SYSTEM_CA: "1" }, dir);
    const flagCount = await defaultCertCount(["--use-system-ca"]);
    // Env var wins over bunfig "bundled", so we end up on system just
    // like --use-system-ca.
    expect(envCount).toBe(flagCount);
  });

  test("invalid CA value fails with a diagnostic", async () => {
    const dir = tempDirWithFiles("bunfig-ca-invalid", {
      "bunfig.toml": `CA = "not-a-real-store"\n`,
      "index.ts": `console.log("should not run");`,
    });

    await using proc = spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).not.toContain("should not run");
    expect(stderr).toContain("Invalid CA value");
    expect(exitCode).not.toBe(0);
  });

  test(`bun test honors CA = "system" in bunfig.toml`, async () => {
    const dir = tempDirWithFiles("bunfig-ca-test", {
      "bunfig.toml": `CA = "system"\n`,
      "probe.test.ts": `
        import { test } from "bun:test";
        import { getCACertificates } from "tls";
        test("print cert count", () => {
          console.log("CERT_COUNT:" + getCACertificates("default").length);
        });
      `,
    });

    await using proc = spawn({
      cmd: [bunExe(), "test", "probe.test.ts"],
      env: { ...bunEnv, NODE_USE_SYSTEM_CA: undefined } as Record<string, string>,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // `bun test` reports via stderr; the log from the test body lands on stdout.
    const output = stdout + stderr;
    const match = output.match(/CERT_COUNT:(\d+)/);
    expect(match).not.toBeNull();
    const bunTestCount = parseInt(match![1], 10);

    // Must match what `--use-system-ca` produces (and exceed the bundled-only
    // baseline whenever the machine has system certs at all).
    const flagCount = await defaultCertCount(["--use-system-ca"]);
    expect(bunTestCount).toBe(flagCount);
    expect(exitCode).toBe(0);
  });
});
