// Coverage for `bun install`'s env-file CLI surface.
//
// Before this landed, `bun install` hardcoded the `.env*` loader to
// `env_files = &[]`, `suffix = Production`, `skip_default_env = false`
// (src/install/PackageManager.rs:1878), so every transitive dependency's
// `postinstall` script saw `.env.production` values regardless of any flag
// or bunfig setting. See PackageManager.rs and bunfig/bunfig.rs:285.
//
// Each test runs a postinstall script that prints the relevant env var,
// then asserts whether it was loaded from the project's `.env*` files.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const POSTINSTALL_PRINT_FOO =
  `node -e "console.log('FOO=' + JSON.stringify(process.env.FOO))"`;

async function runInstall(cwd: string, ...extraArgs: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", ...extraArgs],
    env: bunEnv,
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

test("bun install loads `.env.production` by default (regression baseline)", async () => {
  using dir = tempDir("install-env-baseline", {
    "package.json": JSON.stringify({
      name: "install-env-baseline",
      version: "0.0.0",
      scripts: { postinstall: POSTINSTALL_PRINT_FOO },
    }),
    ".env.production": "FOO=from-env-production",
  });

  const { stdout, exitCode } = await runInstall(String(dir));

  expect(stdout).toContain(`FOO="from-env-production"`);
  expect(exitCode).toBe(0);
});

test("bun install --no-env-file skips default `.env*` loading", async () => {
  using dir = tempDir("install-no-env-file", {
    "package.json": JSON.stringify({
      name: "install-no-env-file",
      version: "0.0.0",
      scripts: { postinstall: POSTINSTALL_PRINT_FOO },
    }),
    ".env.production": "FOO=from-env-production",
    ".env": "FOO=from-env",
    ".env.local": "FOO=from-env-local",
  });

  const { stdout, exitCode } = await runInstall(String(dir), "--no-env-file");

  expect(stdout).toContain(`FOO=undefined`);
  expect(exitCode).toBe(0);
});

test("bun install with `env = false` in bunfig.toml skips default `.env*` loading", async () => {
  using dir = tempDir("install-bunfig-env-false", {
    "package.json": JSON.stringify({
      name: "install-bunfig-env-false",
      version: "0.0.0",
      scripts: { postinstall: POSTINSTALL_PRINT_FOO },
    }),
    "bunfig.toml": "env = false\n",
    ".env.production": "FOO=from-env-production",
  });

  const { stdout, exitCode } = await runInstall(String(dir));

  expect(stdout).toContain(`FOO=undefined`);
  expect(exitCode).toBe(0);
});

test("bun install --env-file <path> loads only the explicit file", async () => {
  using dir = tempDir("install-env-file-explicit", {
    "package.json": JSON.stringify({
      name: "install-env-file-explicit",
      version: "0.0.0",
      scripts: { postinstall: POSTINSTALL_PRINT_FOO },
    }),
    ".env.production": "FOO=from-env-production",
    ".env.custom": "FOO=from-custom",
  });

  const { stdout, exitCode } = await runInstall(
    String(dir),
    "--env-file",
    ".env.custom",
  );

  // Explicit `--env-file` replaces the default set, so `.env.production` is
  // ignored and the value comes from `.env.custom`.
  expect(stdout).toContain(`FOO="from-custom"`);
  expect(exitCode).toBe(0);
});

test("bun install --no-env-file combined with --env-file <path> still loads the explicit file", async () => {
  using dir = tempDir("install-no-env-file-with-explicit", {
    "package.json": JSON.stringify({
      name: "install-no-env-file-with-explicit",
      version: "0.0.0",
      scripts: { postinstall: POSTINSTALL_PRINT_FOO },
    }),
    ".env.production": "FOO=from-env-production",
    ".env.custom": "FOO=from-custom",
  });

  const { stdout, exitCode } = await runInstall(
    String(dir),
    "--no-env-file",
    "--env-file",
    ".env.custom",
  );

  // `--no-env-file` only skips defaults; explicit `--env-file` is still honoured.
  expect(stdout).toContain(`FOO="from-custom"`);
  expect(exitCode).toBe(0);
});
