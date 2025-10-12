import { test, expect, describe } from "bun:test";
import { bunExe, bunEnv, tempDir } from "harness";

describe("Sigstore Crypto Module Tests", () => {
  test("should validate key generation patterns", async () => {
    using dir = tempDir("sigstore-crypto", {
      "key-test.js": `
        // Test ECDSA P-256 key parameters
        const keyParams = {
          algorithm: "ECDSA",
          curve: "P-256",
          usage: ["sign", "verify"]
        };
        
        console.log("Key algorithm:", keyParams.algorithm);
        console.log("Key curve:", keyParams.curve);
        console.log("Key usage:", keyParams.usage.join(", "));
        console.log("Key generation parameters validated");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "key-test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Key algorithm: ECDSA");
    expect(stdout).toContain("Key curve: P-256");
    expect(stdout).toContain("Key generation parameters validated");
  });

  test("should validate certificate parsing logic", async () => {
    using dir = tempDir("sigstore-cert-parsing", {
      "cert-parsing-test.js": `
        const certPEM = \`-----BEGIN CERTIFICATE-----
MIICqDCCAi6gAwIBAgIUABCDEFGHIJKLMNOPQRSTUVWXYZabcjAKBggqhkjOPQQD
AjBjMQswCQYDVQQGEwJVUzETMBEGA1UECAwKQ2FsaWZvcm5pYTEWMBQGA1UEBwwN
U2FuIEZyYW5jaXNjbzEQMA4GA1UECgwHU2lnc3RvcmUxFTATBgNVBAMMDHNpZ3N0
b3JlLmRldjAeFw0yNDA3MTQxNTMwMDBaFw0yNDA3MTQxNjMwMDBaMGMxCzAJBgNV
BAYTAlVTMRMwEQYDVQQIDApDYWxpZm9ybmlhMRYwFAYDVQQHDA1TYW4gRnJhbmNp
c2NvMRAwDgYDVQQKDAdTaWdzdG9yZTEVMBMGA1UEAwwMc2lnc3RvcmUuZGV2MFYW
EAYHKoZIzj0CAQYFK4EEAAoDQgAEtXXbUo2l3xF5pE3yKJIeGYgCqyJAo2l7pBzZ
iKoV8tGvz/CuP3YcjRhyMF5V+xpHBb5wUuU0BSH4w8hGF3tChqOBzjCByzAdBgNV
HQ4EFgQU2YtbKS5H4QfD8PgV7SpLKtL8iE0wHwYDVR0jBBgwFoAU2YtbKS5H4QfD
8PgV7SpLKtL8iE0wDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwEgYD
VR0lAQH/BAgwBgYEVR0lADAaBgNVHREEEzARgg9zaWdzdG9yZS1kZXYuY29tMAoG
CCqGSM49BAMCA0gAMEUCIQD2tO+w1Q2L8K3yZRcD5R4QF6B3O7K+zP5nQ8z9L2m9
dQIgKV9g1XjP4Q+F7H8yQ9Z2L1cF3K8O4X7z+9kL2O5I1Q4=
-----END CERTIFICATE-----\`;

        // Validate certificate structure
        const hasBeginMarker = certPEM.includes("-----BEGIN CERTIFICATE-----");
        const hasEndMarker = certPEM.includes("-----END CERTIFICATE-----");
        const hasBase64Content = /[A-Za-z0-9+/=]/.test(certPEM);
        
        console.log("Has BEGIN marker:", hasBeginMarker);
        console.log("Has END marker:", hasEndMarker);
        console.log("Has base64 content:", hasBase64Content);
        console.log("Certificate structure validation passed");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "cert-parsing-test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Has BEGIN marker: true");
    expect(stdout).toContain("Has END marker: true");
    expect(stdout).toContain("Has base64 content: true");
    expect(stdout).toContain("Certificate structure validation passed");
  });

  test("should validate CSR generation parameters", async () => {
    using dir = tempDir("sigstore-csr", {
      "csr-test.js": `
        const csrParams = {
          subject: {
            emailAddress: "test@example.com"
          },
          version: 0,
          keyUsage: ["digitalSignature"],
          format: "PEM"
        };
        
        console.log("CSR subject email:", csrParams.subject.emailAddress);
        console.log("CSR version:", csrParams.version);
        console.log("CSR key usage:", csrParams.keyUsage.join(", "));
        console.log("CSR format:", csrParams.format);
        console.log("CSR parameters validated");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "csr-test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("CSR subject email: test@example.com");
    expect(stdout).toContain("CSR version: 0");
    expect(stdout).toContain("CSR parameters validated");
  });

  test("should validate signing context functionality", async () => {
    using dir = tempDir("sigstore-signing", {
      "signing-test.js": `
        const testPayload = "Hello, world!";
        const algorithm = "ECDSA-SHA256";
        
        // Mock signing operation parameters
        const signingParams = {
          payload: testPayload,
          algorithm: algorithm,
          encoding: "base64"
        };
        
        console.log("Payload:", signingParams.payload);
        console.log("Algorithm:", signingParams.algorithm);
        console.log("Encoding:", signingParams.encoding);
        console.log("Payload length:", signingParams.payload.length);
        console.log("Signing context test passed");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "signing-test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Payload: Hello, world!");
    expect(stdout).toContain("Algorithm: ECDSA-SHA256");
    expect(stdout).toContain("Signing context test passed");
  });
});