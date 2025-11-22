import { file, spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, readdirSorted, tempDir, tls } from "harness";
import { join } from "path";

describe("bun install --insecure with HTTPS", () => {
  it("should bypass self-signed certificate errors with --insecure", async () => {
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

    using testDir = tempDir("test-insecure-https", {
      "package.json": JSON.stringify({
        name: "test-insecure-https",
        version: "1.0.0",
        dependencies: {
          bar: "0.0.2",
        },
      }),
      "bunfig.toml": `
[install]
cache = false
registry = "https://localhost:${server.port}/"
`,
    });

    // First, try without --insecure - should fail with certificate error
    const { stdout: stdout1, stderr: stderr1, exited: exited1 } = spawn({
      cmd: [bunExe(), "install"],
      cwd: testDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdoutText1 = await stdout1.text();
    const stderrText1 = await stderr1.text();
    const exitCode1 = await exited1;

    expect(stderrText1).toContain("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(exitCode1).toBe(1);

    // Now try with --insecure - should succeed and show warning
    // Run in a fresh process to ensure HTTP thread is initialized with --insecure
    await using proc2 = spawn({
      cmd: [bunExe(), "install", "--insecure"],
      cwd: testDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdoutText2 = await proc2.stdout.text();
    const stderrText2 = await proc2.stderr.text();
    const exitCode2 = await proc2.exited;

    expect(stderrText2).toContain("Insecure mode enabled");
    expect(stderrText2).toContain("TLS/SSL certificate verification is disabled");
    expect(stderrText2).not.toContain("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(exitCode2).toBe(0);

    // Verify package was installed
    const installed = await readdirSorted(join(testDir, "node_modules"));
    expect(installed).toContain("bar");
  });
});

