import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { existsSync } from "node:fs";

describe("--use-system-ca", () => {
  test("flag loads system certificates", async () => {
    // Test that --use-system-ca loads system certificates
    await using proc = spawn({
      cmd: [bunExe(), "--use-system-ca", "-e", "console.log('OK')"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("OK");
    expect(stderr).toBe("");
  });

  test("NODE_USE_SYSTEM_CA=1 loads system certificates", async () => {
    // Test that NODE_USE_SYSTEM_CA environment variable works
    await using proc = spawn({
      cmd: [bunExe(), "-e", "console.log('OK')"],
      env: { ...bunEnv, NODE_USE_SYSTEM_CA: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("OK");
    expect(stderr).toBe("");
  });

  test("NODE_USE_SYSTEM_CA=0 doesn't load system certificates", async () => {
    // Test that NODE_USE_SYSTEM_CA=0 doesn't load system certificates
    await using proc = spawn({
      cmd: [bunExe(), "-e", "console.log('OK')"],
      env: { ...bunEnv, NODE_USE_SYSTEM_CA: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("OK");
    expect(stderr).toBe("");
  });

  test("--use-system-ca overrides NODE_USE_SYSTEM_CA=0", async () => {
    // Test that CLI flag takes precedence over environment variable
    await using proc = spawn({
      cmd: [bunExe(), "--use-system-ca", "-e", "console.log('OK')"],
      env: { ...bunEnv, NODE_USE_SYSTEM_CA: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("OK");
    expect(stderr).toBe("");
  });
});

describe("tls.getCACertificates('system')", () => {
  // Distros alias several well-known bundle paths (and the hashed cert directory) to one file; each system root must be
  // reported once, not once per alias.
  test.skipIf(process.platform !== "linux")("reports each system root once", async () => {
    const knownBundles = [
      "/etc/ssl/certs/ca-certificates.crt",
      "/etc/pki/tls/certs/ca-bundle.crt",
      "/etc/ssl/ca-bundle.pem",
      "/etc/pki/tls/cert.pem",
      "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
      "/etc/ssl/cert.pem",
    ];
    const hasBundle = knownBundles.some(p => existsSync(p));
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `const certs = require("tls").getCACertificates("system");
         const unique = new Set(certs);
         console.log(JSON.stringify({ total: certs.length, unique: unique.size }));`,
      ],
      env: { ...bunEnv, SSL_CERT_FILE: undefined, SSL_CERT_DIR: undefined },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { total, unique } = JSON.parse(stdout.trim());
    if (hasBundle) expect(total).toBeGreaterThan(0);
    expect(total).toBe(unique);
    expect(exitCode).toBe(0);
  });
});
