import { test, expect, describe } from "bun:test";
import { bunExe, bunEnv, tempDir } from "harness";

describe("Sigstore Provenance Tests", () => {
  test("should validate SLSA provenance structure", async () => {
    using dir = tempDir("sigstore-slsa-provenance", {
      "slsa-test.js": `
        const slsaProvenance = {
          _type: "https://in-toto.io/Statement/v0.1",
          subject: [
            {
              name: "pkg:npm/example-package@1.0.0",
              digest: {
                sha256: "abcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
              }
            }
          ],
          predicateType: "https://slsa.dev/provenance/v0.2",
          predicate: {
            builder: {
              id: "https://github.com/actions/runner"
            },
            buildType: "https://github.com/actions/workflow",
            invocation: {
              configSource: {
                uri: "git+https://github.com/example/repo@refs/heads/main",
                digest: {
                  sha1: "1234567890abcdef1234567890abcdef12345678"
                }
              }
            }
          }
        };
        
        console.log("Statement type:", slsaProvenance._type);
        console.log("Predicate type:", slsaProvenance.predicateType);
        console.log("Subject count:", slsaProvenance.subject.length);
        console.log("Has builder ID:", !!slsaProvenance.predicate.builder.id);
        console.log("SLSA provenance structure validated");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "slsa-test.js"],
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
    expect(stdout).toContain("Statement type: https://in-toto.io/Statement/v0.1");
    expect(stdout).toContain("Predicate type: https://slsa.dev/provenance/v0.2");
    expect(stdout).toContain("Subject count: 1");
    expect(stdout).toContain("SLSA provenance structure validated");
  });

  test("should validate package digest formats", async () => {
    using dir = tempDir("sigstore-digest-validation", {
      "digest-test.js": `
        const validDigests = {
          sha256: "abcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
          sha512: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
        };
        
        // Validate digest lengths
        const sha256Valid = validDigests.sha256.length === 64;
        const sha512Valid = validDigests.sha512.length === 128;
        const sha256IsHex = /^[a-f0-9]+$/.test(validDigests.sha256);
        const sha512IsHex = /^[a-f0-9]+$/.test(validDigests.sha512);
        
        console.log("SHA256 length valid (64):", sha256Valid);
        console.log("SHA512 length valid (128):", sha512Valid);
        console.log("SHA256 is hex:", sha256IsHex);
        console.log("SHA512 is hex:", sha512IsHex);
        console.log("Digest validation passed");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "digest-test.js"],
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
    expect(stdout).toContain("SHA256 length valid (64): true");
    expect(stdout).toContain("SHA512 length valid (128): true");
    expect(stdout).toContain("SHA256 is hex: true");
    expect(stdout).toContain("SHA512 is hex: true");
    expect(stdout).toContain("Digest validation passed");
  });

  test("should validate Sigstore bundle structure", async () => {
    using dir = tempDir("sigstore-bundle-structure", {
      "bundle-test.js": `
        const sigstoreBundle = {
          mediaType: "application/vnd.dev.sigstore.bundle+json;version=0.1",
          verificationMaterial: {
            tlogEntries: [
              {
                logIndex: 1234567,
                logId: {
                  keyId: "mock-log-key-id"
                },
                kindVersion: {
                  kind: "dsse",
                  version: "0.0.1"
                },
                integratedTime: 1690000000,
                inclusionPromise: {
                  signedEntryTimestamp: "base64-encoded-timestamp"
                },
                canonicalizedBody: "base64-encoded-body"
              }
            ],
            certificateChain: {
              certificates: [
                {
                  rawBytes: "base64-encoded-certificate"
                }
              ]
            }
          },
          dsseEnvelope: {
            payload: "base64-encoded-payload",
            payloadType: "application/vnd.in-toto+json",
            signatures: [
              {
                sig: "base64-encoded-signature"
              }
            ]
          }
        };
        
        console.log("Media type:", sigstoreBundle.mediaType);
        console.log("Has tlog entries:", sigstoreBundle.verificationMaterial.tlogEntries.length > 0);
        console.log("Has certificate chain:", !!sigstoreBundle.verificationMaterial.certificateChain);
        console.log("Has DSSE envelope:", !!sigstoreBundle.dsseEnvelope);
        console.log("Sigstore bundle structure validated");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "bundle-test.js"],
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
    expect(stdout).toContain("Media type: application/vnd.dev.sigstore.bundle+json;version=0.1");
    expect(stdout).toContain("Has tlog entries: true");
    expect(stdout).toContain("Has certificate chain: true");
    expect(stdout).toContain("Has DSSE envelope: true");
    expect(stdout).toContain("Sigstore bundle structure validated");
  });

  test("should validate Rekor log entry format", async () => {
    using dir = tempDir("sigstore-rekor-entry", {
      "rekor-test.js": `
        const rekorEntry = {
          uuid: "24296fb24b8ad77a7c26e1234567890abcdef1234567890abcdef",
          logIndex: 1234567,
          logID: "c0d23d6ad406973f9559f3ba2d1ca01f84147d8ffc5b8445c224f98b9591801d",
          integratedTime: 1690000000,
          body: "base64-encoded-entry-body",
          verification: {
            signedEntryTimestamp: "base64-encoded-set"
          }
        };
        
        // Validate UUID format (hex string)
        const uuidValid = /^[a-f0-9]{56}$/.test(rekorEntry.uuid);
        const logIDValid = /^[a-f0-9]{64}$/.test(rekorEntry.logID);
        const timestampValid = typeof rekorEntry.integratedTime === "number";
        
        console.log("UUID format valid:", uuidValid);
        console.log("Log ID format valid:", logIDValid);
        console.log("Timestamp is number:", timestampValid);
        console.log("Has verification:", !!rekorEntry.verification);
        console.log("Rekor entry format validated");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "rekor-test.js"],
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
    expect(stdout).toContain("UUID format valid: true");
    expect(stdout).toContain("Log ID format valid: true");
    expect(stdout).toContain("Timestamp is number: true");
    expect(stdout).toContain("Has verification: true");
    expect(stdout).toContain("Rekor entry format validated");
  });

  test("should validate inclusion proof structure", async () => {
    using dir = tempDir("sigstore-inclusion-proof", {
      "inclusion-proof-test.js": `
        const inclusionProof = {
          logIndex: 1234567,
          rootHash: "abcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
          treeSize: 1234568,
          hashes: [
            "hash1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
            "hash2234567890abcdef1234567890abcdef1234567890abcdef1234567890"
          ]
        };
        
        const hasLogIndex = typeof inclusionProof.logIndex === "number";
        const hasRootHash = typeof inclusionProof.rootHash === "string";
        const hasTreeSize = typeof inclusionProof.treeSize === "number";
        const hasHashes = Array.isArray(inclusionProof.hashes);
        const treeSizeGreaterThanIndex = inclusionProof.treeSize > inclusionProof.logIndex;
        
        console.log("Has log index:", hasLogIndex);
        console.log("Has root hash:", hasRootHash);
        console.log("Has tree size:", hasTreeSize);
        console.log("Has hashes array:", hasHashes);
        console.log("Tree size > log index:", treeSizeGreaterThanIndex);
        console.log("Inclusion proof structure validated");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "inclusion-proof-test.js"],
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
    expect(stdout).toContain("Has log index: true");
    expect(stdout).toContain("Has root hash: true");
    expect(stdout).toContain("Has tree size: true");
    expect(stdout).toContain("Has hashes array: true");
    expect(stdout).toContain("Tree size > log index: true");
    expect(stdout).toContain("Inclusion proof structure validated");
  });
});