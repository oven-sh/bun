import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tls as tlsCert } from "harness";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, parse } from "node:path";

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

describe("default certificate store paths", () => {
  const fetchScript = (port: number) =>
    `fetch("https://localhost:${port}/").then(
      async res => console.log("FETCH_OK", await res.text()),
      err => console.log("FETCH_ERR", err.code || err.name || err.message),
    );`;

  test.skipIf(!isWindows)("a cert.pem at the drive-root /etc/ssl path is not trusted on Windows", async () => {
    // The bundled BoringSSL is compiled with Unix-style default trust paths
    // (/etc/ssl/cert.pem, /etc/ssl/certs). On Windows those resolve against the
    // root of the current drive, so they must not be consulted by default.
    const driveRoot = parse(process.cwd()).root;
    const etcDir = join(driveRoot, "etc");
    const sslDir = join(etcDir, "ssl");
    const certPath = join(sslDir, "cert.pem");

    // Never clobber pre-existing state on the machine.
    if (existsSync(certPath)) {
      return;
    }

    let createdEtcDir = false;
    let createdSslDir = false;
    let createdCertFile = false;
    try {
      try {
        if (!existsSync(etcDir)) {
          mkdirSync(etcDir);
          createdEtcDir = true;
        }
        if (!existsSync(sslDir)) {
          mkdirSync(sslDir);
          createdSslDir = true;
        }
        writeFileSync(certPath, tlsCert.cert);
        createdCertFile = true;
      } catch {
        // Insufficient permissions to create the directory/file; nothing to test.
        return;
      }

      using server = Bun.serve({
        port: 0,
        tls: { key: tlsCert.key, cert: tlsCert.cert },
        fetch() {
          return new Response("hello");
        },
      });

      const env = { ...bunEnv };
      delete env.SSL_CERT_FILE;
      delete env.SSL_CERT_DIR;

      await using proc = spawn({
        cmd: [bunExe(), "-e", fetchScript(server.port)],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // The planted certificate must not be in the default trust store, so the
      // fetch has to fail certificate verification.
      expect(stdout).not.toContain("FETCH_OK");
      expect(stdout).toContain("FETCH_ERR");
      expect(stdout).toMatch(/SELF_SIGNED|CERT|UNABLE_TO_VERIFY/i);
      expect(exitCode).toBe(0);
    } finally {
      if (createdCertFile) rmSync(certPath, { force: true });
      if (createdSslDir) rmSync(sslDir, { recursive: true, force: true });
      if (createdEtcDir) rmSync(etcDir, { recursive: true, force: true });
    }
  });

  test("SSL_CERT_FILE adds a trusted certificate to the default store", async () => {
    using dir = tempDir("ssl-cert-file-override", {
      "ca.pem": tlsCert.cert,
    });

    using server = Bun.serve({
      port: 0,
      tls: { key: tlsCert.key, cert: tlsCert.cert },
      fetch() {
        return new Response("hello");
      },
    });

    await using proc = spawn({
      cmd: [bunExe(), "-e", fetchScript(server.port)],
      env: { ...bunEnv, SSL_CERT_FILE: join(String(dir), "ca.pem") },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("FETCH_OK hello");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});
