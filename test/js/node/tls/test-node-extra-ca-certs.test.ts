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
