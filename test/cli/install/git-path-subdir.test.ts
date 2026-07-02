import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// RexSkz/test-git-subfolder-fetch is pnpm's own fixture for this feature: a real
// monorepo whose packages/ subdirectories have no workspace: cross-deps, so each
// sub-package installs standalone. Pinned to a commit for reproducibility.
const MONOREPO = "github:RexSkz/test-git-subfolder-fetch";
const MONOREPO_GIT_URL = "git+https://github.com/RexSkz/test-git-subfolder-fetch.git";
const COMMIT = "2b42a57a945f19f8ffab8ecbd2021fdc2c58ee22";
const SUB_PATH = "packages/simple-shared-data";
const SUB_PATH_2 = "packages/simple-express-server";
const SUB_PKG_NAME = "@my-namespace/simple-shared-data";
const SUB_PKG_NAME_2 = "@my-namespace/simple-express-server";

describe("git dependency &path: subdirectory support", () => {
  test("installs two sub-packages of the same repo+commit via &path:", async () => {
    using installDir = tempDir("git-path-install", {
      "package.json": JSON.stringify({
        name: "test-project",
        dependencies: {
          [SUB_PKG_NAME]: `${MONOREPO_GIT_URL}#${COMMIT}&path:${SUB_PATH}`,
          [SUB_PKG_NAME_2]: `${MONOREPO_GIT_URL}#${COMMIT}&path:${SUB_PATH_2}`,
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: String(installDir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(exitCode).toBe(0);

    const installedPkgJson = join(String(installDir), "node_modules", SUB_PKG_NAME, "package.json");
    expect(existsSync(installedPkgJson)).toBeTrue();
    expect(JSON.parse(readFileSync(installedPkgJson, "utf8")).name).toBe(SUB_PKG_NAME);

    const installedPkgJson2 = join(String(installDir), "node_modules", SUB_PKG_NAME_2, "package.json");
    expect(existsSync(installedPkgJson2)).toBeTrue();
    expect(JSON.parse(readFileSync(installedPkgJson2, "utf8")).name).toBe(SUB_PKG_NAME_2);

    // Only the subdirectory's contents should be installed, not the whole repo.
    expect(existsSync(join(String(installDir), "node_modules", SUB_PKG_NAME, "packages"))).toBeFalse();
  });

  test("supports the pnpm #path: form without a committish", async () => {
    using installDir = tempDir("git-path-nocommittish", {
      "package.json": JSON.stringify({
        name: "test-nocommittish",
        dependencies: {
          // pnpm's primary documented form: `#path:<subdir>` with no committish.
          [SUB_PKG_NAME]: `${MONOREPO}#path:${SUB_PATH}`,
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: String(installDir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(exitCode).toBe(0);

    const installedPkgJson = join(String(installDir), "node_modules", SUB_PKG_NAME, "package.json");
    expect(existsSync(installedPkgJson)).toBeTrue();
    expect(JSON.parse(readFileSync(installedPkgJson, "utf8")).name).toBe(SUB_PKG_NAME);
  });

  test("lockfile round-trip preserves &path:", async () => {
    using installDir = tempDir("git-path-lockfile", {
      "package.json": JSON.stringify({
        name: "test-lockfile",
        dependencies: {
          [SUB_PKG_NAME]: `${MONOREPO}#${COMMIT}&path:${SUB_PATH}`,
        },
      }),
    });

    await using proc1 = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: String(installDir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [, , exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);
    expect(exitCode1).toBe(0);

    const lockPath = join(String(installDir), "bun.lock");
    const lockContents = readFileSync(lockPath, "utf8");
    expect(lockContents).toContain("&path:");
    expect(lockContents).toContain(SUB_PATH);

    rmSync(join(String(installDir), "node_modules"), { recursive: true, force: true });

    await using proc2 = Bun.spawn({
      cmd: [bunExe(), "install", "--frozen-lockfile"],
      env: bunEnv,
      cwd: String(installDir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [, , exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);
    expect(exitCode2).toBe(0);

    const installedPkgJson = join(String(installDir), "node_modules", SUB_PKG_NAME, "package.json");
    expect(existsSync(installedPkgJson)).toBeTrue();
    expect(JSON.parse(readFileSync(installedPkgJson, "utf8")).name).toBe(SUB_PKG_NAME);
  });

  test("path traversal is rejected", async () => {
    const maliciousPaths = [
      { name: "evil-pkg-dotdot", path: "../../etc/passwd" },
      { name: "evil-pkg-win", path: "..\\..\\etc\\passwd" },
      { name: "evil-pkg-drive", path: "C:/tmp/pkg" },
    ];

    for (const { name, path } of maliciousPaths) {
      using installDir = tempDir("git-path-traversal", {
        "package.json": JSON.stringify({
          name: "test-traversal",
          dependencies: {
            [name]: `${MONOREPO}#${COMMIT}&path:${path}`,
          },
        }),
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        env: bunEnv,
        cwd: String(installDir),
        stderr: "pipe",
        stdout: "pipe",
      });

      const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(existsSync(join(String(installDir), "node_modules", name))).toBeFalse();
      expect(exitCode).not.toBe(0);
    }
  });

  test("normal git dep without &path: still works (backward compat)", async () => {
    using installDir = tempDir("git-path-compat", {
      "package.json": JSON.stringify({
        name: "test-backward-compat",
        dependencies: {
          "is-number": "git+https://github.com/jonschlinkert/is-number.git#98e8ff1",
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: String(installDir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(exitCode).toBe(0);

    const installedPkgJson = join(String(installDir), "node_modules", "is-number", "package.json");
    expect(existsSync(installedPkgJson)).toBeTrue();
    expect(JSON.parse(readFileSync(installedPkgJson, "utf8")).name).toBe("is-number");
  });
});
