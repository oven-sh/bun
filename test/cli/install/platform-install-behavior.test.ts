import { env, spawn } from "bun";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { existsSync } from "node:fs";
import { readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

let package_dir = tmpdirSync();
afterEach(() => rm(package_dir, { recursive: true, force: true }));

describe("platform overrides", () => {
  it("should accept --os, --cpu, and --libc flags without error", async () => {
    package_dir = tmpdirSync();
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-platform-flags",
        dependencies: {
          "is-number": "7.0.0",
        },
      }),
    );

    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--os=linux", "--cpu=x64", "--libc=glibc"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(stderr.text()).resolves.toContain("Saved lockfile");
    expect(exited).resolves.toBe(0);
  });

  it("verifies sharp installs correct platform packages with overrides", async () => {
    package_dir = tmpdirSync();
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-platform",
        dependencies: {
          sharp: "0.34.3",
        },
        trustedDependencies: [""],
      }),
    );

    const { stderr, exited, stdout } = spawn({
      cmd: [bunExe(), "install", "--os=linux", "--cpu=x64", "--libc=glibc"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exited).resolves.toBe(0);
    expect(stderr.text()).resolves.toContain("Saved lockfile");
    expect(stdout.text()).resolves.toContain("installed");

    const imgDir = await readdir(join(package_dir, "node_modules", "@img"));
    expect(imgDir).toHaveLength(2);
    expect(imgDir).toContain("sharp-linux-x64");
    expect(imgDir).toContain("sharp-libvips-linux-x64");
  }, 10_000);

  it("should handle packages without platform constraints", async () => {
    package_dir = tmpdirSync();

    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-no-constraints",
        dependencies: {
          "is-odd": "3.0.1",
        },
        trustedDependencies: [""],
      }),
    );

    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--os=linux", "--cpu=x64", "--libc=musl"],
      cwd: package_dir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(stderr.text()).resolves.toContain("Saved lockfile");
    expect(exited).resolves.toBe(0);
  });

  it("should accept wildcard (*) for platform overrides", async () => {
    package_dir = tmpdirSync();
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-esbuild-platform",
        dependencies: {
          esbuild: "0.25.0",
        },
        trustedDependencies: [""],
      }),
    );

    const { stderr, exited, stdout } = spawn({
      cmd: [bunExe(), "install", "--os=*", "--cpu=*", "--libc=*"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exited).resolves.toBe(0);
    expect(stderr.text()).resolves.toContain("Saved lockfile");
    expect(stdout.text()).resolves.toContain("installed");

    const linuxX64Exists = existsSync(join(package_dir, "node_modules", "@esbuild", "linux-x64"));
    const darwinX64Exists = existsSync(join(package_dir, "node_modules", "@esbuild", "darwin-x64"));
    const darwinArm64Exists = existsSync(join(package_dir, "node_modules", "@esbuild", "darwin-arm64"));
    const win32X64Exists = existsSync(join(package_dir, "node_modules", "@esbuild", "win32-x64"));

    expect(linuxX64Exists).toBe(true);
    expect(darwinX64Exists).toBe(true);
    expect(darwinArm64Exists).toBe(true);
    expect(win32X64Exists).toBe(true);
  }, 10_000);

  it("validates platform flag values", async () => {
    package_dir = tmpdirSync();
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-invalid-platform",
        dependencies: {},
        trustedDependencies: [""],
      }),
    );

    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--os=invalid-os"],
      cwd: package_dir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const err = await stderr.text();
    expect(err).toContain("invalid --os value: 'invalid-os'");
    expect(await exited).toBe(1);
  });
});
