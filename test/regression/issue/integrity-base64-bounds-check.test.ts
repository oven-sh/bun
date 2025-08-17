import { test, expect } from "bun:test";
import { tempDirWithFiles, bunExe, bunEnv } from "harness";

test("integrity parsing handles oversized base64 without panic", async () => {
  // This test specifically targets the base64 integrity parsing fix
  // The original bug was: "panic: index out of bounds: index 64, len 64"
  // in integrity.zig when trying to decode base64 into a fixed buffer
  
  const dir = tempDirWithFiles("integrity-bounds-test", {
    "package.json": JSON.stringify({
      name: "test-integrity-bounds",
      version: "1.0.0",
      dependencies: {
        "test-pkg": "1.0.0"
      }
    }),
  });

  // Create a bun.lock with malformed integrity that would cause the original panic
  // Use lockfileVersion: 1 which is more likely to be parsed
  const malformedIntegrityBytes = new Uint8Array(100); // 100 bytes > 64 byte buffer
  malformedIntegrityBytes.fill(0xAA);
  const malformedBase64 = Buffer.from(malformedIntegrityBytes).toString('base64');
  
  const lockfile = {
    lockfileVersion: 1,
    workspaces: {
      "": {
        name: "test-integrity-bounds",
        dependencies: {
          "test-pkg": "1.0.0"
        }
      }
    },
    packages: {
      "test-pkg": ["test-pkg@1.0.0", "", {}, `sha256-${malformedBase64}`]
    }
  };

  await Bun.write(`${dir}/bun.lock`, JSON.stringify(lockfile, null, 2));

  // Run bun install - this should NOT panic
  const proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // The critical assertion: no panic should occur
  expect(stderr).not.toContain("panic");
  expect(stderr).not.toContain("index out of bounds");
  
  // It's OK if the install fails gracefully due to the malformed data
  // The important thing is that it doesn't crash with a panic
});

test("integrity parsing handles various hash types without panic", async () => {
  // Test different hash types to ensure they all handle oversized input properly
  const hashTypes = ["sha1", "sha256", "sha384", "sha512"];
  
  for (const hashType of hashTypes) {
    const dir = tempDirWithFiles(`integrity-${hashType}-test`, {
      "package.json": JSON.stringify({
        name: `test-${hashType}`,
        version: "1.0.0",
        dependencies: { "pkg": "1.0.0" }
      }),
    });

    // Create oversized base64 for each hash type
    const oversizedBytes = new Uint8Array(120); // Much larger than any hash digest
    oversizedBytes.fill(0xBB);
    const oversizedBase64 = Buffer.from(oversizedBytes).toString('base64');
    
    const lockfile = {
      lockfileVersion: 1,
      workspaces: { "": { name: `test-${hashType}`, dependencies: { "pkg": "1.0.0" } } },
      packages: { "pkg": ["pkg@1.0.0", "", {}, `${hashType}-${oversizedBase64}`] }
    };

    await Bun.write(`${dir}/bun.lock`, JSON.stringify(lockfile, null, 2));

    const proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [, stderr] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    // Should not panic for any hash type
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("index out of bounds");
  }
});