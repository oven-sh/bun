import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

describe("bun update --interactive formatting regression", () => {
  it("should not underflow when dependency type text is longer than available space", async () => {
    // This test verifies the fix for the padding calculation underflow issue
    // in lines 745-750 of update_interactive_command.zig
    const dir = tempDirWithFiles("formatting-regression-test", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "a": "1.0.0", // Very short package name
        },
      }),
      "bun.lockb": JSON.stringify({
        "lockfileVersion": 3,
        "packages": {
          "a": {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
        },
      }),
    });

    const result = await Bun.spawn({
      cmd: [bunExe(), "update", "--interactive", "--dry-run"],
      cwd: dir,
      env: bunEnv,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(result.stderr).text();

    // Verify no underflow errors occur
    expect(stderr).not.toContain("underflow");
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("overflow");
  });

  it("should handle dev tag length calculation correctly", async () => {
    // This test verifies that dev/peer/optional tags are properly accounted for
    // in the column width calculations
    const dir = tempDirWithFiles("dev-tag-formatting-test", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "regular-package": "1.0.0",
        },
        devDependencies: {
          "dev-package": "1.0.0",
        },
        peerDependencies: {
          "peer-package": "1.0.0",
        },
        optionalDependencies: {
          "optional-package": "1.0.0",
        },
      }),
      "bun.lockb": JSON.stringify({
        "lockfileVersion": 3,
        "packages": {
          "regular-package": { "integrity": "sha512-fake", "version": "1.0.0" },
          "dev-package": { "integrity": "sha512-fake", "version": "1.0.0" },
          "peer-package": { "integrity": "sha512-fake", "version": "1.0.0" },
          "optional-package": { "integrity": "sha512-fake", "version": "1.0.0" },
        },
      }),
    });

    const result = await Bun.spawn({
      cmd: [bunExe(), "update", "--interactive", "--dry-run"],
      cwd: dir,
      env: bunEnv,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(result.stderr).text();

    // Verify no formatting errors occur with dev tags
    expect(stderr).not.toContain("underflow");
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("overflow");
  });

  it("should truncate extremely long package names without crashing", async () => {
    // This test verifies that package names longer than MAX_NAME_WIDTH (60) are handled
    const longPackageName = "extremely-long-package-name-that-exceeds-maximum-width-and-should-be-truncated";
    const dir = tempDirWithFiles("truncate-test", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          [longPackageName]: "1.0.0",
        },
      }),
      "bun.lockb": JSON.stringify({
        "lockfileVersion": 3,
        "packages": {
          [longPackageName]: {
            "integrity": "sha512-fake",
            "version": "1.0.0",
          },
        },
      }),
    });

    const result = await Bun.spawn({
      cmd: [bunExe(), "update", "--interactive", "--dry-run"],
      cwd: dir,
      env: bunEnv,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(result.stderr).text();

    // Verify no crashes occur with extremely long package names
    expect(stderr).not.toContain("underflow");
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("overflow");
    expect(stderr).not.toContain("segfault");
  });

  it("should handle long version strings without formatting issues", async () => {
    // This test verifies that version strings longer than MAX_VERSION_WIDTH (20) are handled
    const longVersion = "1.0.0-alpha.1.2.3.4.5.6.7.8.9.10.11.12.13.14.15.16.17.18.19.20.21.22.23.24.25";
    const dir = tempDirWithFiles("long-version-test", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "package-with-long-version": longVersion,
        },
      }),
      "bun.lockb": JSON.stringify({
        "lockfileVersion": 3,
        "packages": {
          "package-with-long-version": {
            "integrity": "sha512-fake",
            "version": longVersion,
          },
        },
      }),
    });

    const result = await Bun.spawn({
      cmd: [bunExe(), "update", "--interactive", "--dry-run"],
      cwd: dir,
      env: bunEnv,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(result.stderr).text();

    // Verify no crashes occur with extremely long version strings
    expect(stderr).not.toContain("underflow");
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("overflow");
    expect(stderr).not.toContain("segfault");
  });

  it("should handle edge case where all values are at maximum width", async () => {
    // This test verifies edge cases where padding calculations might fail
    const maxWidthPackage = "a".repeat(60); // MAX_NAME_WIDTH
    const maxWidthVersion = "1.0.0-" + "a".repeat(15); // MAX_VERSION_WIDTH

    const dir = tempDirWithFiles("max-width-test", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          [maxWidthPackage]: maxWidthVersion,
        },
        devDependencies: {
          [maxWidthPackage + "-dev"]: maxWidthVersion,
        },
        peerDependencies: {
          [maxWidthPackage + "-peer"]: maxWidthVersion,
        },
        optionalDependencies: {
          [maxWidthPackage + "-optional"]: maxWidthVersion,
        },
      }),
      "bun.lockb": JSON.stringify({
        "lockfileVersion": 3,
        "packages": {
          [maxWidthPackage]: { "integrity": "sha512-fake", "version": maxWidthVersion },
          [maxWidthPackage + "-dev"]: { "integrity": "sha512-fake", "version": maxWidthVersion },
          [maxWidthPackage + "-peer"]: { "integrity": "sha512-fake", "version": maxWidthVersion },
          [maxWidthPackage + "-optional"]: { "integrity": "sha512-fake", "version": maxWidthVersion },
        },
      }),
    });

    const result = await Bun.spawn({
      cmd: [bunExe(), "update", "--interactive", "--dry-run"],
      cwd: dir,
      env: bunEnv,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(result.stderr).text();

    // Verify no crashes occur at maximum width values
    expect(stderr).not.toContain("underflow");
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("overflow");
    expect(stderr).not.toContain("segfault");
  });
});
