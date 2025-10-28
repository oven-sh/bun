import { file, spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, readdirSorted, tempDir, tls } from "harness";
import { join } from "path";

// Helper to create a registry handler with proper URL context
function createRegistryHandler(urls: string[], info: any, rootUrl: string) {
  return async (request: Request) => {
    urls.push(request.url);
    const url = request.url.replaceAll(/%2f/gi, "/");
    
    if (url.endsWith(".tgz")) {
      return new Response(file(join(import.meta.dir, new URL(url).pathname.split("/").pop()!.toLowerCase())));
    }
    
    const name = url.slice(url.indexOf("/", rootUrl.length) + 1);
    const versions: Record<string, any> = {};
    let version;
    for (version in info) {
      if (!/^[0-9]/.test(version)) continue;
      versions[version] = {
        name,
        version,
        dist: {
          tarball: `${url}-${info[version].as ?? version}.tgz`,
        },
        ...info[version],
      };
    }
    
    return new Response(
      JSON.stringify({
        name,
        versions,
        "dist-tags": {
          latest: info.latest ?? version,
        },
      }),
    );
  };
}

describe.concurrent("bun install --insecure flag", () => {
  it("should accept the --insecure flag and display warning", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(request) {
        const rootUrl = `http://localhost:${server.port}`;
        return await createRegistryHandler([], { "0.0.2": {} }, rootUrl)(request);
      },
    });

    using testDir = tempDir("test-insecure-flag", {
      "package.json": JSON.stringify({
        name: "test-insecure-flag",
        version: "1.0.0",
        dependencies: {
          bar: "0.0.2",
        },
      }),
      "bunfig.toml": `
[install]
cache = false
registry = "http://localhost:${server.port}/"
`,
    });

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--insecure"],
      cwd: testDir,
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
    const installed = await readdirSorted(join(testDir, "node_modules"));
    expect(installed).toContain("bar");
  });

  it("should work with other install flags", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(request) {
        const rootUrl = `http://localhost:${server.port}`;
        return await createRegistryHandler([], { "0.0.2": {}, "0.0.3": {} }, rootUrl)(request);
      },
    });

    using testDir = tempDir("test-insecure-with-flags", {
      "package.json": JSON.stringify({
        name: "test-insecure-with-flags",
        version: "1.0.0",
        dependencies: {
          bar: "0.0.2",
        },
        devDependencies: {
          baz: "0.0.3",
        },
      }),
      "bunfig.toml": `
[install]
cache = false
registry = "http://localhost:${server.port}/"
`,
    });

    // Test --insecure with --production
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--insecure", "--production"],
      cwd: testDir,
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
    const installed = await readdirSorted(join(testDir, "node_modules"));
    expect(installed).toContain("bar");
    expect(installed).not.toContain("baz");
  });

  it("should work with bun add --insecure", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(request) {
        const rootUrl = `http://localhost:${server.port}`;
        return await createRegistryHandler([], { "0.0.2": {} }, rootUrl)(request);
      },
    });

    using testDir = tempDir("test-add-insecure", {
      "package.json": JSON.stringify({
        name: "test-add-insecure",
        version: "1.0.0",
        dependencies: {},
      }),
      "bunfig.toml": `
[install]
cache = false
registry = "http://localhost:${server.port}/"
`,
    });

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "add", "boba@0.0.2", "--insecure"],
      cwd: testDir,
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
    const installed = await readdirSorted(join(testDir, "node_modules"));
    expect(installed).toContain("boba");
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
    using server = Bun.serve({
      port: 0,
      async fetch(request) {
        const rootUrl = `http://localhost:${server.port}`;
        return await createRegistryHandler([], { "0.0.2": {} }, rootUrl)(request);
      },
    });

    using testDir = tempDir("test-cli-override-bunfig", {
      "package.json": JSON.stringify({
        name: "test-cli-override-bunfig",
        version: "1.0.0",
        dependencies: {
          bar: "0.0.2",
        },
      }),
      "bunfig.toml": `
[install]
cache = false
registry = "http://localhost:${server.port}/"
insecure = false
`,
    });

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--insecure"], // CLI flag should override
      cwd: testDir,
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
    const installed = await readdirSorted(join(testDir, "node_modules"));
    expect(installed).toContain("bar");
  });

  it("should warn when both insecure and CA settings are configured", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(request) {
        const rootUrl = `http://localhost:${server.port}`;
        return await createRegistryHandler([], { "0.0.2": {} }, rootUrl)(request);
      },
    });

    // Create a dummy CA file
    using testDir = tempDir("test-insecure-with-ca", {
      "package.json": JSON.stringify({
        name: "test-insecure-with-ca",
        version: "1.0.0",
        dependencies: {
          bar: "0.0.2",
        },
      }),
      "ca-cert.pem": `-----BEGIN CERTIFICATE-----
MIIBkTCB+wIJAKHHCgVZU7ZOMA0GCSqGSIb3DQEBCwUAMBExDzANBgNVBAMMBnRl
c3RjYTAeFw0yMDAxMDEwMDAwMDBaFw0zMDAxMDEwMDAwMDBaMBExDzANBgNVBAMM
BnRlc3RjYTCBnzANBgkqhkiG9w0BAQEFAAOBjQAwgYkCgYEA1234567890abcdef
ghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890
-----END CERTIFICATE-----`,
      "bunfig.toml": `
[install]
cache = false
registry = "http://localhost:${server.port}/"
insecure = true
cafile = "./ca-cert.pem"
`,
    });

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: testDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderrText = await stderr.text();
    const stdoutText = await stdout.text();
    const exitCode = await exited;

    // Should warn that CA settings are ignored when insecure is enabled
    expect(stderrText.toLowerCase()).toContain("cafile");
    expect(stderrText.toLowerCase()).toContain("ignore");

    // Should succeed
    expect(exitCode).toBe(0);

    // Package should be installed
    const installed = await readdirSorted(join(testDir, "node_modules"));
    expect(installed).toContain("bar");
  });
});

