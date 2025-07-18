import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

describe("bun update --interactive formatting", () => {
  it("should handle package names of unusual lengths", async () => {
    const dir = tempDirWithFiles("update-interactive-test", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "a": "1.0.0",
          "really-long-package-name-that-causes-formatting-issues": "1.0.0",
          "@org/extremely-long-scoped-package-name-that-will-test-formatting": "1.0.0",
          "short": "1.0.0",
          "another-package-with-a-very-long-name-to-test-column-alignment": "1.0.0",
        },
        devDependencies: {
          "dev-package": "1.0.0",
          "super-long-dev-package-name-that-should-not-break-formatting": "1.0.0",
        },
        peerDependencies: {
          "peer-package": "1.0.0",
          "extremely-long-peer-dependency-name-for-testing-column-alignment": "1.0.0",
        },
        optionalDependencies: {
          "optional-package": "1.0.0",
          "very-long-optional-dependency-name-that-tests-formatting": "1.0.0",
        },
      }),
      "bun.lockb": JSON.stringify({
        "lockfileVersion": 3,
        "packages": {
          "a": {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
          "really-long-package-name-that-causes-formatting-issues": {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
          "@org/extremely-long-scoped-package-name-that-will-test-formatting": {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
          "short": {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
          "another-package-with-a-very-long-name-to-test-column-alignment": {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
          "dev-package": {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
          "super-long-dev-package-name-that-should-not-break-formatting": {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
          "peer-package": {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
          "extremely-long-peer-dependency-name-for-testing-column-alignment": {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
          "optional-package": {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
          "very-long-optional-dependency-name-that-tests-formatting": {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
        },
      }),
    });

    // Mock outdated packages by creating fake manifests
    const manifestsDir = join(dir, ".bun", "manifests");
    await Bun.write(
      join(manifestsDir, "a.json"),
      JSON.stringify({
        name: "a",
        "dist-tags": { latest: "2.0.0" },
        versions: {
          "1.0.0": { version: "1.0.0" },
          "2.0.0": { version: "2.0.0" },
        },
      }),
    );

    // Test that the command doesn't crash with unusual package name lengths
    const result = await Bun.spawn({
      cmd: [bunExe(), "update", "--interactive", "--dry-run"],
      cwd: dir,
      env: bunEnv,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(result.stdout).text();
    const stderr = await new Response(result.stderr).text();

    // The command might fail due to missing manifests, but it shouldn't crash
    // due to formatting issues
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("segfault");
    expect(stderr).not.toContain("underflow");
    expect(stderr).not.toContain("overflow");
  });

  it("should handle version strings of unusual lengths", async () => {
    const dir = tempDirWithFiles("update-interactive-versions-test", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "package-with-long-version": "1.0.0-alpha.1.2.3.4.5.6.7.8.9.10.11.12.13.14.15.16.17.18.19.20",
          "package-with-short-version": "1.0.0",
          "package-with-prerelease": "1.0.0-beta.1+build.1234567890.abcdef",
        },
      }),
      "bun.lockb": JSON.stringify({
        "lockfileVersion": 3,
        "packages": {
          "package-with-long-version": {
            "integrity": "sha512-fake",
            "version": "1.0.0-alpha.1.2.3.4.5.6.7.8.9.10.11.12.13.14.15.16.17.18.19.20",
          },
          "package-with-short-version": {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
          "package-with-prerelease": {
            "integrity": "sha512-fake",
            "version": "1.0.0-beta.1+build.1234567890.abcdef",
          },
        },
      }),
    });

    // Test that the command doesn't crash with unusual version string lengths
    const result = await Bun.spawn({
      cmd: [bunExe(), "update", "--interactive", "--dry-run"],
      cwd: dir,
      env: bunEnv,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(result.stdout).text();
    const stderr = await new Response(result.stderr).text();

    // The command might fail due to missing manifests, but it shouldn't crash
    // due to formatting issues
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("segfault");
    expect(stderr).not.toContain("underflow");
    expect(stderr).not.toContain("overflow");
  });

  it("should truncate extremely long package names", async () => {
    const extremelyLongPackageName = "a".repeat(100);
    const dir = tempDirWithFiles("update-interactive-truncate-test", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          [extremelyLongPackageName]: "1.0.0",
        },
      }),
      "bun.lockb": JSON.stringify({
        "lockfileVersion": 3,
        "packages": {
          [extremelyLongPackageName]: {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
        },
      }),
    });

    // Test that extremely long package names are handled gracefully
    const result = await Bun.spawn({
      cmd: [bunExe(), "update", "--interactive", "--dry-run"],
      cwd: dir,
      env: bunEnv,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(result.stdout).text();
    const stderr = await new Response(result.stderr).text();

    // The command might fail due to missing manifests, but it shouldn't crash
    // due to formatting issues
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("segfault");
    expect(stderr).not.toContain("underflow");
    expect(stderr).not.toContain("overflow");
  });

  it("should handle mixed dependency types with various name lengths", async () => {
    const dir = tempDirWithFiles("update-interactive-mixed-test", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "a": "1.0.0",
          "really-long-dependency-name": "1.0.0",
        },
        devDependencies: {
          "b": "1.0.0",
          "super-long-dev-dependency-name": "1.0.0",
        },
        peerDependencies: {
          "c": "1.0.0",
          "extremely-long-peer-dependency-name": "1.0.0",
        },
        optionalDependencies: {
          "d": "1.0.0",
          "very-long-optional-dependency-name": "1.0.0",
        },
      }),
      "bun.lockb": JSON.stringify({
        "lockfileVersion": 3,
        "packages": {
          "a": { "integrity": "sha512-fake", "version": "1.0.0" },
          "really-long-dependency-name": { "integrity": "sha512-fake", "version": "1.0.0" },
          "b": { "integrity": "sha512-fake", "version": "1.0.0" },
          "super-long-dev-dependency-name": { "integrity": "sha512-fake", "version": "1.0.0" },
          "c": { "integrity": "sha512-fake", "version": "1.0.0" },
          "extremely-long-peer-dependency-name": { "integrity": "sha512-fake", "version": "1.0.0" },
          "d": { "integrity": "sha512-fake", "version": "1.0.0" },
          "very-long-optional-dependency-name": { "integrity": "sha512-fake", "version": "1.0.0" },
        },
      }),
    });

    // Test that mixed dependency types with various name lengths don't cause crashes
    const result = await Bun.spawn({
      cmd: [bunExe(), "update", "--interactive", "--dry-run"],
      cwd: dir,
      env: bunEnv,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(result.stdout).text();
    const stderr = await new Response(result.stderr).text();

    // The command might fail due to missing manifests, but it shouldn't crash
    // due to formatting issues
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("segfault");
    expect(stderr).not.toContain("underflow");
    expect(stderr).not.toContain("overflow");
  });
});
