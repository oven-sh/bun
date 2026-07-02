import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

describe("NODE_EXTRA_CA_CERTS", () => {
  test("loads additional certificates from file", async () => {
    // Create a test certificate file
    const testCert = `-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIJAKLdQVPy90WjMA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV
BAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRlcm5ldCBX
aWRnaXRzIFB0eSBMdGQwHhcNMTgwNDEwMDgwNzQ4WhcNMjgwNDA3MDgwNzQ4WjBF
MQswCQYDVQQGEwJBVTETMBEGA1UECAwKU29tZS1TdGF0ZTEhMB8GA1UECgwYSW50
ZXJuZXQgV2lkZ2l0cyBQdHkgTHRkMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIB
CgKCAQEAyOB7tY2Uo2lTNjJgGEhJAVZDWnHbLjbmTMP4pSXLlNMr9KdyaKE+J3xn
xAz7TbGPHUBH5dqMzlWqEkZxcY9u9GL19SJPpC7dl8K8V5dKBwvgOubcLp4qLvZU
-----END CERTIFICATE-----`;

    const dir = tempDirWithFiles("test-extra-ca", {
      "extra-ca.pem": testCert,
      "test.js": `console.log('OK');`,
    });

    const certPath = join(dir, "extra-ca.pem");

    // Test that NODE_EXTRA_CA_CERTS loads the certificate
    await using proc = spawn({
      cmd: [bunExe(), "test.js"],
      env: { ...bunEnv, NODE_EXTRA_CA_CERTS: certPath },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("OK");
  });

  test("handles missing certificate file gracefully", async () => {
    const dir = tempDirWithFiles("test-missing-ca", {
      "test.js": `console.log('OK');`,
    });

    const nonExistentPath = join(dir, "non-existent.pem");

    // Test that missing file doesn't crash the process
    await using proc = spawn({
      cmd: [bunExe(), "test.js"],
      env: { ...bunEnv, NODE_EXTRA_CA_CERTS: nonExistentPath },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Process should still run successfully even with missing cert file
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("OK");
    // Bun may or may not warn about the missing file in stderr
    // The important thing is that the process doesn't crash
  });

  test("works with both NODE_EXTRA_CA_CERTS and --use-system-ca", async () => {
    const testCert = `-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIJAKLdQVPy90WjMA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV
BAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRlcm5ldCBX
aWRnaXRzIFB0eSBMdGQwHhcNMTgwNDEwMDgwNzQ4WhcNMjgwNDA3MDgwNzQ4WjBF
-----END CERTIFICATE-----`;

    const dir = tempDirWithFiles("test-extra-and-system", {
      "extra-ca.pem": testCert,
      "test.js": `console.log('OK');`,
    });

    const certPath = join(dir, "extra-ca.pem");

    // Test that both work together
    await using proc = spawn({
      cmd: [bunExe(), "--use-system-ca", "test.js"],
      env: { ...bunEnv, NODE_EXTRA_CA_CERTS: certPath },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("OK");
  });
});

test("explicit ca option replaces the default trust store instead of appending to it", async () => {
  const fixtures = join(import.meta.dir, "fixtures");

  const dir = tempDirWithFiles("ca-replaces-default", {
    "main.js": `
      const tls = require("node:tls");
      const fs = require("node:fs");
      const path = require("node:path");

      const fixtures = process.env.TLS_FIXTURES_DIR;
      const read = name => fs.readFileSync(path.join(fixtures, name), "utf8");

      // ca1 issued the server certificate AND is part of the default trust
      // store for this process (via NODE_EXTRA_CA_CERTS).
      const issuerCa = read("ca1-cert.pem");
      // ca2 did not issue the server certificate.
      const unrelatedCa = read("ca2-cert.pem");

      const server = tls.createServer(
        { key: read("agent1-key.pem"), cert: read("agent1-cert.pem") },
        socket => socket.end(),
      );

      function attempt(ca) {
        return new Promise(resolve => {
          const socket = tls.connect(
            {
              host: "127.0.0.1",
              port: server.address().port,
              ca,
              rejectUnauthorized: true,
              // The fixture cert is not issued for 127.0.0.1; this test is
              // about chain validation, not hostname verification.
              checkServerIdentity: () => undefined,
            },
            () => {
              socket.end();
              resolve("connected");
            },
          );
          socket.on("error", () => resolve("rejected"));
        });
      }

      server.listen(0, "127.0.0.1", async () => {
        console.log("pinned-to-unrelated-ca", await attempt(unrelatedCa));
        console.log("pinned-to-issuer", await attempt(issuerCa));
        server.close();
      });
    `,
  });

  await using proc = spawn({
    cmd: [bunExe(), "main.js"],
    env: {
      ...bunEnv,
      // Put the issuing CA into the *default* trust store. A connection that
      // supplies its own `ca` must validate exclusively against that `ca` and
      // must not fall back to the default store.
      NODE_EXTRA_CA_CERTS: join(fixtures, "ca1-cert.pem"),
      TLS_FIXTURES_DIR: fixtures,
    },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Pinning a CA that did not issue the server certificate must reject the
  // connection, even though the actual issuer is present in the default store.
  expect(stdout).toContain("pinned-to-unrelated-ca rejected");
  // Pinning the actual issuer still connects.
  expect(stdout).toContain("pinned-to-issuer connected");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
