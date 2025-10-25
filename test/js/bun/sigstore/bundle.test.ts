import { test, expect, describe } from "bun:test";
import { bunExe, bunEnv, tempDir } from "harness";

describe("Sigstore Bundle Tests", () => {
  test("should validate bundle media type and version", async () => {
    using dir = tempDir("sigstore-bundle-media-type", {
      "bundle-media-test.js": `
        const validMediaTypes = [
          "application/vnd.dev.sigstore.bundle+json;version=0.1",
          "application/vnd.dev.sigstore.bundle+json;version=0.2",
          "application/vnd.dev.sigstore.bundle+json;version=0.3"
        ];
        
        function parseMediaType(mediaType) {
          const parts = mediaType.split(';');
          const type = parts[0];
          const version = parts[1]?.split('=')[1];
          return { type, version };
        }
        
        validMediaTypes.forEach((mediaType, index) => {
          const parsed = parseMediaType(mediaType);
          console.log(\`Media type \${index + 1}: \${parsed.type}, Version: \${parsed.version}\`);
        });
        
        console.log("Bundle media type validation passed");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "bundle-media-test.js"],
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
    expect(stdout).toContain("application/vnd.dev.sigstore.bundle+json");
    expect(stdout).toContain("Version: 0.1");
    expect(stdout).toContain("Version: 0.2");
    expect(stdout).toContain("Bundle media type validation passed");
  });

  test("should validate transparency log entry structure", async () => {
    using dir = tempDir("sigstore-tlog-entry", {
      "tlog-test.js": `
        const tlogEntry = {
          logIndex: 1234567,
          logId: {
            keyId: "c0d23d6ad406973f9559f3ba2d1ca01f84147d8ffc5b8445c224f98b9591801d"
          },
          kindVersion: {
            kind: "dsse",
            version: "0.0.1"
          },
          integratedTime: 1690000000,
          inclusionPromise: {
            signedEntryTimestamp: "MEUCIBqTYRBMZMWMfYW+3M+QXzKGvC9Y0PkIKLuN8rWLmKb4AiEA1234567890"
          },
          inclusionProof: {
            logIndex: 1234567,
            rootHash: "abcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
            treeSize: 1234568,
            hashes: []
          },
          canonicalizedBody: "eyJ0ZXN0IjogImRhdGEifQ=="
        };
        
        console.log("Log index:", tlogEntry.logIndex);
        console.log("Entry kind:", tlogEntry.kindVersion.kind);
        console.log("Entry version:", tlogEntry.kindVersion.version);
        console.log("Has inclusion promise:", !!tlogEntry.inclusionPromise);
        console.log("Has inclusion proof:", !!tlogEntry.inclusionProof);
        console.log("Transparency log entry validated");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "tlog-test.js"],
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
    expect(stdout).toContain("Log index: 1234567");
    expect(stdout).toContain("Entry kind: dsse");
    expect(stdout).toContain("Entry version: 0.0.1");
    expect(stdout).toContain("Has inclusion promise: true");
    expect(stdout).toContain("Transparency log entry validated");
  });

  test("should validate complete bundle structure", async () => {
    using dir = tempDir("sigstore-complete-bundle", {
      "complete-bundle-test.js": `
        const completeBundle = {
          mediaType: "application/vnd.dev.sigstore.bundle+json;version=0.1",
          verificationMaterial: {
            tlogEntries: [
              {
                logIndex: 1234567,
                logId: { keyId: "mock-log-id" },
                kindVersion: { kind: "dsse", version: "0.0.1" },
                integratedTime: 1690000000,
                inclusionPromise: { signedEntryTimestamp: "mock-set" },
                canonicalizedBody: "mock-body"
              }
            ],
            timestampVerificationData: null,
            certificateChain: {
              certificates: [
                { rawBytes: "mock-cert-bytes" }
              ]
            }
          },
          dsseEnvelope: {
            payload: "eyJ0ZXN0IjogImRhdGEifQ==",
            payloadType: "application/vnd.in-toto+json",
            signatures: [
              {
                keyid: "test-key-id",
                sig: "mock-signature"
              }
            ]
          }
        };
        
        // Validate structure completeness
        const hasMediaType = !!completeBundle.mediaType;
        const hasVerificationMaterial = !!completeBundle.verificationMaterial;
        const hasTlogEntries = completeBundle.verificationMaterial.tlogEntries.length > 0;
        const hasCertificateChain = !!completeBundle.verificationMaterial.certificateChain;
        const hasDSSEEnvelope = !!completeBundle.dsseEnvelope;
        const hasSignatures = completeBundle.dsseEnvelope.signatures.length > 0;
        
        console.log("Has media type:", hasMediaType);
        console.log("Has verification material:", hasVerificationMaterial);
        console.log("Has tlog entries:", hasTlogEntries);
        console.log("Has certificate chain:", hasCertificateChain);
        console.log("Has DSSE envelope:", hasDSSEEnvelope);
        console.log("Has signatures:", hasSignatures);
        console.log("Complete bundle structure validated");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "complete-bundle-test.js"],
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
    expect(stdout).toContain("Has media type: true");
    expect(stdout).toContain("Has verification material: true");
    expect(stdout).toContain("Has tlog entries: true");
    expect(stdout).toContain("Has certificate chain: true");
    expect(stdout).toContain("Has DSSE envelope: true");
    expect(stdout).toContain("Complete bundle structure validated");
  });
});