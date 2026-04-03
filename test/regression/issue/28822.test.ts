import type { Server } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

/**
 * Regression test for https://github.com/oven-sh/bun/issues/28822
 *
 * `blockDeprecatedDependencies` (bunfig) / `--block-deprecated-dependencies`
 * (CLI flag) / per-package excludes. A version with a non-empty `deprecated`
 * string in its npm manifest entry is skipped during resolution.
 */
describe.concurrent("issue #28822 - blockDeprecatedDependencies", () => {
  let mockRegistryServer: Server;
  let mockRegistryUrl = "";

  beforeAll(() => {
    mockRegistryServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);

        // PACKAGE A: latest version is deprecated → should pick prior one
        if (url.pathname === "/lodashlike") {
          return Response.json({
            name: "lodashlike",
            "dist-tags": { latest: "4.18.0" },
            versions: {
              "4.17.23": {
                name: "lodashlike",
                version: "4.17.23",
                dist: {
                  tarball: `${mockRegistryUrl}/lodashlike/-/lodashlike-4.17.23.tgz`,
                  integrity: "sha512-fake-a1==",
                },
              },
              "4.18.0": {
                name: "lodashlike",
                version: "4.18.0",
                deprecated: "broken — use 4.17.23 or newer",
                dist: {
                  tarball: `${mockRegistryUrl}/lodashlike/-/lodashlike-4.18.0.tgz`,
                  integrity: "sha512-fake-a2==",
                },
              },
            },
          });
        }

        // PACKAGE B: every matching version is deprecated
        if (url.pathname === "/all-deprecated") {
          return Response.json({
            name: "all-deprecated",
            "dist-tags": { latest: "2.0.0" },
            versions: {
              "1.0.0": {
                name: "all-deprecated",
                version: "1.0.0",
                deprecated: "don't use",
                dist: {
                  tarball: `${mockRegistryUrl}/all-deprecated/-/all-deprecated-1.0.0.tgz`,
                  integrity: "sha512-fake-b1==",
                },
              },
              "2.0.0": {
                name: "all-deprecated",
                version: "2.0.0",
                deprecated: "don't use",
                dist: {
                  tarball: `${mockRegistryUrl}/all-deprecated/-/all-deprecated-2.0.0.tgz`,
                  integrity: "sha512-fake-b2==",
                },
              },
            },
          });
        }

        // PACKAGE C: clean versions only
        if (url.pathname === "/clean-pkg") {
          return Response.json({
            name: "clean-pkg",
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name: "clean-pkg",
                version: "1.0.0",
                dist: {
                  tarball: `${mockRegistryUrl}/clean-pkg/-/clean-pkg-1.0.0.tgz`,
                  integrity: "sha512-fake-c==",
                },
              },
            },
          });
        }

        return new Response("not found", { status: 404 });
      },
    });
    mockRegistryUrl = `http://localhost:${mockRegistryServer.port}`;
  });

  afterAll(() => {
    mockRegistryServer?.stop(true);
  });

  test("when blocked, deprecated latest version is skipped and prior version is chosen", async () => {
    using dir = tempDir("issue28822-skip-deprecated", {
      "package.json": JSON.stringify({ name: "app", dependencies: { lodashlike: "^4.17.0" } }),
      ".npmrc": `registry=${mockRegistryUrl}`,
      "bunfig.toml": `[install]\nblockDeprecatedDependencies = true\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--lockfile-only"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });

    const lockfile = await Bun.file(`${dir}/bun.lock`).text();
    expect(lockfile).toContain("lodashlike@4.17.23");
    expect(lockfile).not.toContain("lodashlike@4.18.0");
  });

  test("without the option set, deprecated latest is still selected (default behaviour)", async () => {
    using dir = tempDir("issue28822-default-behaviour", {
      "package.json": JSON.stringify({ name: "app", dependencies: { lodashlike: "^4.17.0" } }),
      ".npmrc": `registry=${mockRegistryUrl}`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--lockfile-only"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });

    const lockfile = await Bun.file(`${dir}/bun.lock`).text();
    expect(lockfile).toContain("lodashlike@4.18.0");
  });

  test("blockDeprecatedDependenciesExcludes lets a specific package keep its deprecated version", async () => {
    using dir = tempDir("issue28822-excludes", {
      "package.json": JSON.stringify({ name: "app", dependencies: { lodashlike: "^4.17.0" } }),
      ".npmrc": `registry=${mockRegistryUrl}`,
      "bunfig.toml": `[install]\nblockDeprecatedDependencies = true\nblockDeprecatedDependenciesExcludes = ["lodashlike"]\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--lockfile-only"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });

    const lockfile = await Bun.file(`${dir}/bun.lock`).text();
    // Excluded package keeps its normally-picked latest version, deprecated and all.
    expect(lockfile).toContain("lodashlike@4.18.0");
  });

  test("fails when every semver-matching version is deprecated", async () => {
    using dir = tempDir("issue28822-all-deprecated", {
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { "all-deprecated": "^1.0.0", "clean-pkg": "1.0.0" },
      }),
      ".npmrc": `registry=${mockRegistryUrl}`,
      "bunfig.toml": `[install]\nblockDeprecatedDependencies = true\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--lockfile-only"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Installation must fail and the error must cite the new option by name.
    expect(stderr).toContain("blockDeprecatedDependencies");
    expect({ stdout, exitCode }).not.toMatchObject({ exitCode: 0 });
  });

  test("fails when an exact pinned version is itself deprecated", async () => {
    using dir = tempDir("issue28822-exact-pin", {
      "package.json": JSON.stringify({ name: "app", dependencies: { lodashlike: "4.18.0" } }),
      ".npmrc": `registry=${mockRegistryUrl}`,
      "bunfig.toml": `[install]\nblockDeprecatedDependencies = true\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--lockfile-only"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [_stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("blockDeprecatedDependencies");
    expect(exitCode).not.toBe(0);
  });

  test("bunfig rejects non-boolean blockDeprecatedDependencies", async () => {
    using dir = tempDir("issue28822-bad-config", {
      "package.json": JSON.stringify({ name: "app", dependencies: { "clean-pkg": "1.0.0" } }),
      ".npmrc": `registry=${mockRegistryUrl}`,
      "bunfig.toml": `[install]\nblockDeprecatedDependencies = "yes"\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--lockfile-only"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [_stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(exitCode).not.toBe(0);
    expect(stderr.toLowerCase()).toMatch(/blockdeprecateddependencies|boolean/);
  });
});
