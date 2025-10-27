import { file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { writeFile } from "fs/promises";
import { bunEnv, bunExe, readdirSorted, tempDir, tls } from "harness";
import { join } from "path";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  getPort,
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

    // Should display warning about insecure mode
    expect(stderrText).toContain("Insecure mode enabled");
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

    expect(stderrText).toContain("Insecure mode enabled");
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

    expect(stderrText).toContain("Insecure mode enabled");
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
    expect(stderrText).not.toContain("Insecure mode enabled");
    expect(stderrText).not.toContain("TLS/SSL certificate verification is disabled");
    expect(exitCode).toBe(0);

    // Package should still be installed
    const installed = await readdirSorted(join(package_dir, "node_modules"));
    expect(installed).toContain("bar");
  });

  it("bunfig install.insecure=true should bypass self-signed certificate errors (verifying HTTP thread propagation)", async () => {
    // Set up an HTTPS server with a self-signed certificate
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.endsWith(".tgz")) {
          // Serve the tarball
          return new Response(file(join(import.meta.dir, "bar-0.0.2.tgz")));
        }
        // Serve package metadata
        return new Response(
          JSON.stringify({
            name: "bar",
            versions: {
              "0.0.2": {
                name: "bar",
                version: "0.0.2",
                dist: {
                  tarball: `https://localhost:${server.port}/bar-0.0.2.tgz`,
                },
              },
            },
            "dist-tags": {
              latest: "0.0.2",
            },
          }),
        );
      },
      ...tls, // Use self-signed cert
    });

    using testDir = tempDir("test-bunfig-insecure-https", {
      "package.json": JSON.stringify({
        name: "test-bunfig-insecure-https",
        version: "1.0.0",
        dependencies: {
          bar: "0.0.2",
        },
      }),
      "bunfig.toml": `
[install]
cache = false
registry = "https://localhost:${server.port}/"
insecure = true
`,
    });

    // With bunfig insecure=true (no CLI flag), should bypass certificate errors
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"], // No --insecure flag, using bunfig config
      cwd: testDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdoutText = await stdout.text();
    const stderrText = await stderr.text();
    const exitCode = await exited;

    // Should NOT fail with certificate error (proves insecure propagated to HTTP thread)
    expect(stderrText).not.toContain("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(exitCode).toBe(0);

    // Verify package was installed (proves the insecure config worked)
    const installed = await readdirSorted(join(testDir, "node_modules"));
    expect(installed).toContain("bar");
  });

  it("bunfig install.insecure=true should work with bun add and bypass TLS errors", async () => {
    // Set up an HTTPS server with a self-signed certificate
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.endsWith(".tgz")) {
          // Serve the tarball
          return new Response(file(join(import.meta.dir, "boba-0.0.2.tgz")));
        }
        // Serve package metadata
        return new Response(
          JSON.stringify({
            name: "boba",
            versions: {
              "0.0.2": {
                name: "boba",
                version: "0.0.2",
                dist: {
                  tarball: `https://localhost:${server.port}/boba-0.0.2.tgz`,
                },
              },
            },
            "dist-tags": {
              latest: "0.0.2",
            },
          }),
        );
      },
      ...tls, // Use self-signed cert
    });

    using testDir = tempDir("test-bunfig-insecure-add", {
      "package.json": JSON.stringify({
        name: "test-bunfig-insecure-add",
        version: "1.0.0",
        dependencies: {},
      }),
      "bunfig.toml": `
[install]
cache = false
registry = "https://localhost:${server.port}/"
insecure = true
`,
    });

    // With bunfig insecure=true, bun add should bypass certificate errors
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "add", "boba@0.0.2"], // No --insecure flag
      cwd: testDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdoutText = await stdout.text();
    const stderrText = await stderr.text();
    const exitCode = await exited;

    // Should NOT fail with certificate error (proves insecure propagated to HTTP thread)
    expect(stderrText).not.toContain("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(exitCode).toBe(0);

    // Verify package was added
    const installed = await readdirSorted(join(testDir, "node_modules"));
    expect(installed).toContain("boba");
  });

  it("CLI --insecure flag should override bunfig install.insecure=false", async () => {
    const urls: string[] = [];
    setHandler(
      dummyRegistry(urls, {
        "0.0.2": {},
      }),
    );

    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-cli-override-bunfig",
        version: "1.0.0",
        dependencies: {
          bar: "0.0.2",
        },
      }),
    );

    // Create bunfig.toml with install.insecure = false and registry pointing to dummy
    await writeFile(
      join(package_dir, "bunfig.toml"),
      `[install]
cache = false
registry = "http://localhost:${getPort()}/"
insecure = false
`,
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--insecure"], // CLI flag should override
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderrText = await stderr.text();
    const stdoutText = await stdout.text();
    const exitCode = await exited;

    // Should display warning since CLI flag is present
    expect(stderrText).toContain("Insecure mode enabled");
    expect(stderrText).toContain("TLS/SSL certificate verification is disabled");
    expect(stderrText).toContain("dangerous");

    // Should succeed
    expect(exitCode).toBe(0);

    // Package should be installed
    const installed = await readdirSorted(join(package_dir, "node_modules"));
    expect(installed).toContain("bar");
  });
});

