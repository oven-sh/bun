import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// nicolo-ribaudo/babel-polyfills is a real monorepo with packages/ subdirectories.
// Pinned to a specific commit for reproducibility.
const MONOREPO = "github:nicolo-ribaudo/babel-polyfills";
const MONOREPO_GIT_URL = "git+https://github.com/nicolo-ribaudo/babel-polyfills.git";
const COMMIT = "67d188090d3e94d9b03babc518e5fcdbc43ac206";
const SUB_PATH = "packages/babel-helper-define-polyfill-provider";
const SUB_PATH_2 = "packages/babel-plugin-polyfill-corejs2";
const SUB_PKG_NAME = "@babel/helper-define-polyfill-provider";
const SUB_PKG_NAME_2 = "babel-plugin-polyfill-corejs2";

describe("git dependency &path: subdirectory support", () => {
  test("installs sub-packages from monorepo via &path: (git+https URL)", async () => {
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

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Verify the first sub-package was installed with correct package.json
    const installedPkgJson = join(
      String(installDir),
      "node_modules",
      "@babel",
      "helper-define-polyfill-provider",
      "package.json",
    );
    expect(existsSync(installedPkgJson)).toBeTrue();

    const pkg = JSON.parse(readFileSync(installedPkgJson, "utf8"));
    expect(pkg.name).toBe(SUB_PKG_NAME);

    // Verify the second sub-package was installed with correct package.json
    const installedPkgJson2 = join(String(installDir), "node_modules", SUB_PKG_NAME_2, "package.json");
    expect(existsSync(installedPkgJson2)).toBeTrue();

    const pkg2 = JSON.parse(readFileSync(installedPkgJson2, "utf8"));
    expect(pkg2.name).toBe(SUB_PKG_NAME_2);

    expect(exitCode).toBe(0);
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

    // First install
    await using proc1 = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: String(installDir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout1, stderr1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);

    expect(exitCode1).toBe(0);

    // Check lockfile contains &path:
    const lockPath = join(String(installDir), "bun.lock");
    const lockContents = readFileSync(lockPath, "utf8");
    expect(lockContents).toContain("&path:");
    expect(lockContents).toContain(SUB_PATH);

    // Delete node_modules and reinstall from frozen lockfile
    const nmDir = join(String(installDir), "node_modules");
    rmSync(nmDir, { recursive: true, force: true });

    await using proc2 = Bun.spawn({
      cmd: [bunExe(), "install", "--frozen-lockfile"],
      env: bunEnv,
      cwd: String(installDir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

    // Verify reinstall from lockfile works
    const installedPkgJson = join(
      String(installDir),
      "node_modules",
      "@babel",
      "helper-define-polyfill-provider",
      "package.json",
    );
    expect(existsSync(installedPkgJson)).toBeTrue();

    const pkg = JSON.parse(readFileSync(installedPkgJson, "utf8"));
    expect(pkg.name).toBe(SUB_PKG_NAME);

    expect(exitCode2).toBe(0);
  });

  test("path traversal is rejected", async () => {
    const maliciousPaths = [
      { name: "evil-pkg-dotdot", path: "../../etc/passwd" },
      { name: "evil-pkg-win", path: "..\\\\..\\\\etc\\\\passwd" },
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

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // Verify the failure is specifically due to the invalid path diagnostic
      expect(stderr).toContain("Invalid git subdirectory path");

      // The package directory should not have been created
      expect(existsSync(join(String(installDir), "node_modules", name))).toBeFalse();

      // Path traversal should be rejected — install must fail
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

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const installedPkgJson = join(String(installDir), "node_modules", "is-number", "package.json");
    expect(existsSync(installedPkgJson)).toBeTrue();

    const pkg = JSON.parse(readFileSync(installedPkgJson, "utf8"));
    expect(pkg.name).toBe("is-number");

    expect(exitCode).toBe(0);
  });
});
