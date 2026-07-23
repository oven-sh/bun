// Regression coverage for https://github.com/oven-sh/bun/issues/31028
//
// When the security scanner is configured as a `devDependencies` entry and
// `bun install --production` is run, the lockfile filter treats the scanner
// as a filtered-out dev-only package. That left the partial install of the
// scanner with an empty tree and `bun install` failed with
// "no packages were installed during security scanner installation".
//
// These tests use the existing `test-security-scanner-1.0.0-clean.tgz`
// served via the SimpleRegistry fixture: the scanner is a real `devDependencies`
// entry and must install + run under `--production`.

import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { startRegistry, stopRegistry } from "./simple-dummy-registry";

setDefaultTimeout(1000 * 60 * 5);

let registryUrl: string;

beforeAll(async () => {
  registryUrl = await startRegistry(false);
});

afterAll(() => {
  stopRegistry();
});

async function writeFixture(options: { production: boolean; frozenLockfile: boolean }) {
  const dir = tempDirWithFiles("install-security-production-31028", {
    "package.json": JSON.stringify({
      name: "test-app",
      version: "1.0.0",
      dependencies: {
        "left-pad": "1.3.0",
      },
      devDependencies: {
        "test-security-scanner": "1.0.0",
      },
    }),
  });

  // First pass: no scanner so we can produce the lockfile cleanly. We do this
  // without --production so devDependencies appear in the lockfile just like
  // they would in a developer's local checkout.
  await Bun.write(
    join(dir, "bunfig.toml"),
    `[install]
cache.disable = true
registry = "${registryUrl}/"`,
  );

  await using initProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [initOut, initErr, initCode] = await Promise.all([
    initProc.stdout.text(),
    initProc.stderr.text(),
    initProc.exited,
  ]);
  if (initCode !== 0) {
    throw new Error(`initial install failed (${initCode}):\n${initOut}\n${initErr}`);
  }

  // Rewrite bunfig with the scanner configured — mirrors the user's bunfig.
  await Bun.write(
    join(dir, "bunfig.toml"),
    `[install]
cache.disable = true
registry = "${registryUrl}/"

[install.security]
scanner = "test-security-scanner"`,
  );

  // Drop node_modules so the install actually has to resolve + install.
  rmSync(join(dir, "node_modules"), { recursive: true, force: true });

  const args = ["install"];
  if (options.frozenLockfile) args.push("--frozen-lockfile");
  if (options.production) args.push("--production");

  await using runProc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([runProc.stdout.text(), runProc.stderr.text(), runProc.exited]);

  return { dir, stdout, stderr, exitCode, combined: stdout + stderr };
}

test.concurrent(
  "install --production with npm security scanner in devDependencies installs the scanner and completes",
  async () => {
    const { combined, exitCode } = await writeFixture({ production: true, frozenLockfile: false });

    expect(combined).not.toContain("no packages were installed during security scanner installation");
    expect(combined).toContain("Attempting to install security scanner from npm");
    expect(combined).toContain("Security scanner installed successfully");
    expect(combined).toContain("SCANNER_RAN");
    expect(exitCode).toBe(0);
  },
);

test.concurrent(
  "install --frozen-lockfile --production with npm security scanner in devDependencies installs the scanner and completes",
  async () => {
    const { combined, exitCode } = await writeFixture({ production: true, frozenLockfile: true });

    expect(combined).not.toContain("no packages were installed during security scanner installation");
    expect(combined).toContain("Attempting to install security scanner from npm");
    expect(combined).toContain("Security scanner installed successfully");
    expect(combined).toContain("SCANNER_RAN");
    expect(exitCode).toBe(0);
  },
);
