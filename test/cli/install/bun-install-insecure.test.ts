import { spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { writeFile } from "fs/promises";
import { bunEnv, bunExe, readdirSorted } from "harness";
import { join } from "path";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  package_dir,
  setHandler,
} from "./dummy.registry";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);
beforeEach(async () => {
  await dummyBeforeEach();
});
afterEach(dummyAfterEach);

describe("bun install --insecure flag", () => {
  it("should accept the --insecure flag and display warning", async () => {
    const urls: string[] = [];
    setHandler(
      dummyRegistry(urls, {
        "0.0.2": {},
      }),
    );

    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-insecure-flag",
        version: "1.0.0",
        dependencies: {
          bar: "0.0.2",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--insecure"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderrText = await stderr.text();
    const stdoutText = await stdout.text();
    const exitCode = await exited;

    // Should display warning about insecure flag
    expect(stderrText).toContain("--insecure");
    expect(stderrText).toContain("TLS/SSL certificate verification is disabled");
    expect(stderrText).toContain("dangerous");

    // Should succeed
    expect(exitCode).toBe(0);

    // Package should still be installed
    const installed = await readdirSorted(join(package_dir, "node_modules"));
    expect(installed).toContain("bar");
  });

  it("should work with other install flags", async () => {
    const urls: string[] = [];
    setHandler(
      dummyRegistry(urls, {
        "0.0.2": {},
        "0.0.3": {},
      }),
    );

    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-insecure-with-flags",
        version: "1.0.0",
        dependencies: {
          bar: "0.0.2",
        },
        devDependencies: {
          baz: "0.0.3",
        },
      }),
    );

    // Test --insecure with --production
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--insecure", "--production"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderrText = await stderr.text();
    const stdoutText = await stdout.text();
    const exitCode = await exited;

    expect(stderrText).toContain("--insecure");
    expect(exitCode).toBe(0);

    // Should install production dependencies only
    const installed = await readdirSorted(join(package_dir, "node_modules"));
    expect(installed).toContain("bar");
    expect(installed).not.toContain("baz");
  });

  it("should work with bun add --insecure", async () => {
    const urls: string[] = [];
    setHandler(
      dummyRegistry(urls, {
        "0.0.2": {},
      }),
    );

    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-add-insecure",
        version: "1.0.0",
        dependencies: {},
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "add", "boba@0.0.2", "--insecure"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderrText = await stderr.text();
    const stdoutText = await stdout.text();
    const exitCode = await exited;

    expect(stderrText).toContain("--insecure");
    expect(exitCode).toBe(0);

    // Package should be added
    const installed = await readdirSorted(join(package_dir, "node_modules"));
    expect(installed).toContain("boba");
  });

  it("should work without the --insecure flag (normal mode)", async () => {
    const urls: string[] = [];
    setHandler(
      dummyRegistry(urls, {
        "0.0.2": {},
      }),
    );

    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-normal-mode",
        version: "1.0.0",
        dependencies: {
          bar: "0.0.2",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderrText = await stderr.text();
    const stdoutText = await stdout.text();
    const exitCode = await exited;

    // Should NOT display insecure warning in normal mode
    expect(stderrText).not.toContain("--insecure");
    expect(stderrText).not.toContain("TLS/SSL certificate verification is disabled");
    expect(exitCode).toBe(0);

    // Package should still be installed
    const installed = await readdirSorted(join(package_dir, "node_modules"));
    expect(installed).toContain("bar");
  });
});

