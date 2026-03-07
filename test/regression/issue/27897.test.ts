import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("bun remove --filter", () => {
  test("removes package from matching workspace packages", async () => {
    using dir = tempDir("bun-remove-filter", {
      "package.json": JSON.stringify(
        {
          name: "root",
          workspaces: ["packages/*"],
        },
        null,
        2,
      ),
      "packages/pkg-a/package.json": JSON.stringify(
        {
          name: "pkg-a",
          devDependencies: {
            "is-even": "^1.0.0",
          },
        },
        null,
        2,
      ),
      "packages/pkg-b/package.json": JSON.stringify(
        {
          name: "pkg-b",
          dependencies: {
            "is-even": "^1.0.0",
          },
        },
        null,
        2,
      ),
      "packages/other/package.json": JSON.stringify(
        {
          name: "other",
          dependencies: {
            "is-even": "^1.0.0",
          },
        },
        null,
        2,
      ),
    });

    // Install first
    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await installProc.exited).toBe(0);

    // Remove with --filter matching only pkg-* packages
    await using removeProc = Bun.spawn({
      cmd: [bunExe(), "remove", "--filter", "pkg-*", "is-even"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      removeProc.stdout.text(),
      removeProc.stderr.text(),
      removeProc.exited,
    ]);

    expect(stderr).not.toContain("error");
    expect(exitCode).toBe(0);

    // pkg-a should have is-even removed
    const pkgA = await Bun.file(`${dir}/packages/pkg-a/package.json`).json();
    expect(pkgA.devDependencies).toBeUndefined();

    // pkg-b should have is-even removed
    const pkgB = await Bun.file(`${dir}/packages/pkg-b/package.json`).json();
    expect(pkgB.dependencies).toBeUndefined();

    // other should NOT have is-even removed (doesn't match pkg-*)
    const other = await Bun.file(`${dir}/packages/other/package.json`).json();
    expect(other.dependencies).toEqual({ "is-even": "^1.0.0" });
  });

  test("--filter does not produce 'unrecognised dependency format' error", async () => {
    using dir = tempDir("bun-remove-filter-err", {
      "package.json": JSON.stringify(
        {
          name: "root",
          workspaces: ["packages/*"],
        },
        null,
        2,
      ),
      "packages/es6tween-core/package.json": JSON.stringify(
        {
          name: "es6tween-core",
          devDependencies: {
            "uglify-js": "^3.0.0",
          },
        },
        null,
        2,
      ),
    });

    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await installProc.exited).toBe(0);

    await using removeProc = Bun.spawn({
      cmd: [bunExe(), "remove", "--filter", "es6tween-*", "uglify-js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      removeProc.stdout.text(),
      removeProc.stderr.text(),
      removeProc.exited,
    ]);

    expect(stderr).not.toContain("unrecognised dependency format");
    expect(stderr).not.toContain("error");
    expect(exitCode).toBe(0);

    const pkgJson = await Bun.file(`${dir}/packages/es6tween-core/package.json`).json();
    expect(pkgJson.devDependencies).toBeUndefined();
  });
});

describe("bun remove --recursive", () => {
  test("removes package from all workspace packages", async () => {
    using dir = tempDir("bun-remove-recursive", {
      "package.json": JSON.stringify(
        {
          name: "root",
          workspaces: ["packages/*"],
          devDependencies: {
            "is-even": "^1.0.0",
          },
        },
        null,
        2,
      ),
      "packages/pkg-a/package.json": JSON.stringify(
        {
          name: "pkg-a",
          devDependencies: {
            "is-even": "^1.0.0",
          },
        },
        null,
        2,
      ),
      "packages/pkg-b/package.json": JSON.stringify(
        {
          name: "pkg-b",
          dependencies: {
            "is-even": "^1.0.0",
            "is-odd": "^1.0.0",
          },
        },
        null,
        2,
      ),
    });

    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await installProc.exited).toBe(0);

    await using removeProc = Bun.spawn({
      cmd: [bunExe(), "remove", "--recursive", "is-even"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      removeProc.stdout.text(),
      removeProc.stderr.text(),
      removeProc.exited,
    ]);

    expect(stderr).not.toContain("error");
    expect(exitCode).toBe(0);

    // Root should have is-even removed
    const root = await Bun.file(`${dir}/package.json`).json();
    expect(root.devDependencies).toBeUndefined();

    // pkg-a should have is-even removed
    const pkgA = await Bun.file(`${dir}/packages/pkg-a/package.json`).json();
    expect(pkgA.devDependencies).toBeUndefined();

    // pkg-b should have is-even removed but keep is-odd
    const pkgB = await Bun.file(`${dir}/packages/pkg-b/package.json`).json();
    expect(pkgB.dependencies).toEqual({ "is-odd": "^1.0.0" });
  });
});
