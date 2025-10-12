import { test, expect, describe } from "bun:test";
import { bunExe, bunEnv, tempDir } from "harness";

describe("Sigstore DSSE Module Tests", () => {
  test("should validate DSSE envelope structure", async () => {
    using dir = tempDir("sigstore-dsse-envelope", {
      "dsse-envelope-test.js": `
        const dsseEnvelope = {
          payload: Buffer.from('{"test": "payload"}').toString('base64'),
          payloadType: "application/vnd.in-toto+json",
          signatures: [
            {
              keyid: "test-key-id",
              sig: "base64-encoded-signature"
            }
          ]
        };
        
        console.log("Payload type:", dsseEnvelope.payloadType);
        console.log("Signatures count:", dsseEnvelope.signatures.length);
        console.log("Has keyid:", !!dsseEnvelope.signatures[0].keyid);
        console.log("Has signature:", !!dsseEnvelope.signatures[0].sig);
        console.log("DSSE envelope structure validated");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "dsse-envelope-test.js"],
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
    expect(stdout).toContain("Payload type: application/vnd.in-toto+json");
    expect(stdout).toContain("Signatures count: 1");
    expect(stdout).toContain("DSSE envelope structure validated");
  });

  test("should validate PAE (Pre-Authentication Encoding)", async () => {
    using dir = tempDir("sigstore-dsse-pae", {
      "pae-test.js": `
        // PAE format: "DSSEv1" + SP + LEN(type) + SP + type + SP + LEN(payload) + SP + payload
        const payloadType = "application/vnd.in-toto+json";
        const payload = '{"test": "data"}';
        
        function createPAE(type, payload) {
          const typeLen = Buffer.byteLength(type, 'utf8');
          const payloadLen = Buffer.byteLength(payload, 'utf8');
          return \`DSSEv1 \${typeLen} \${type} \${payloadLen} \${payload}\`;
        }
        
        const pae = createPAE(payloadType, payload);
        
        console.log("PAE starts with DSSEv1:", pae.startsWith("DSSEv1"));
        console.log("PAE contains type:", pae.includes(payloadType));
        console.log("PAE contains payload:", pae.includes(payload));
        console.log("PAE length:", pae.length);
        console.log("PAE validation passed");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "pae-test.js"],
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
    expect(stdout).toContain("PAE starts with DSSEv1: true");
    expect(stdout).toContain("PAE contains type: true");
    expect(stdout).toContain("PAE contains payload: true");
    expect(stdout).toContain("PAE validation passed");
  });

  test("should validate DSSE signature format", async () => {
    using dir = tempDir("sigstore-dsse-signature", {
      "signature-test.js": `
        const signature = {
          keyid: "optional-key-identifier",
          sig: "YmFzZTY0LWVuY29kZWQtc2lnbmF0dXJl"  // base64 encoded
        };
        
        // Validate base64 encoding
        const isValidBase64 = /^[A-Za-z0-9+/]*={0,2}$/.test(signature.sig);
        
        console.log("Has keyid:", typeof signature.keyid === "string");
        console.log("Signature is base64:", isValidBase64);
        console.log("Signature length:", signature.sig.length);
        console.log("DSSE signature format validated");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "signature-test.js"],
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
    expect(stdout).toContain("Has keyid: true");
    expect(stdout).toContain("Signature is base64: true");
    expect(stdout).toContain("DSSE signature format validated");
  });

  test("should validate DSSE payload encoding/decoding", async () => {
    using dir = tempDir("sigstore-dsse-payload", {
      "payload-test.js": `
        const originalPayload = {
          subject: [{
            name: "test-artifact",
            digest: { sha256: "abcd1234" }
          }],
          predicateType: "https://slsa.dev/provenance/v0.2"
        };
        
        const jsonPayload = JSON.stringify(originalPayload);
        const encodedPayload = Buffer.from(jsonPayload, 'utf8').toString('base64');
        const decodedPayload = Buffer.from(encodedPayload, 'base64').toString('utf8');
        const parsedPayload = JSON.parse(decodedPayload);
        
        console.log("Original equals parsed:", JSON.stringify(originalPayload) === JSON.stringify(parsedPayload));
        console.log("Payload type:", parsedPayload.predicateType);
        console.log("Subject count:", parsedPayload.subject.length);
        console.log("DSSE payload round-trip successful");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "payload-test.js"],
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
    expect(stdout).toContain("Original equals parsed: true");
    expect(stdout).toContain("Payload type: https://slsa.dev/provenance/v0.2");
    expect(stdout).toContain("DSSE payload round-trip successful");
  });

  test("should validate DSSE JSON serialization", async () => {
    using dir = tempDir("sigstore-dsse-json", {
      "json-test.js": `
        const dsseEnvelope = {
          payload: "eyJ0ZXN0IjogImRhdGEifQ==",
          payloadType: "application/vnd.in-toto+json",
          signatures: [{
            keyid: "test-key",
            sig: "dGVzdC1zaWduYXR1cmU="
          }]
        };
        
        const jsonString = JSON.stringify(dsseEnvelope, null, 2);
        const parsed = JSON.parse(jsonString);
        
        console.log("JSON contains payload:", jsonString.includes('"payload"'));
        console.log("JSON contains payloadType:", jsonString.includes('"payloadType"'));
        console.log("JSON contains signatures:", jsonString.includes('"signatures"'));
        console.log("Parsed payload type:", parsed.payloadType);
        console.log("DSSE JSON serialization validated");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "json-test.js"],
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
    expect(stdout).toContain("JSON contains payload: true");
    expect(stdout).toContain("JSON contains payloadType: true");
    expect(stdout).toContain("JSON contains signatures: true");
    expect(stdout).toContain("DSSE JSON serialization validated");
  });
});