import { test, expect } from "bun:test";
import { tempDirWithFiles, bunExe, bunEnv } from "harness";

test("base64 integrity parsing should not panic on oversized input", async () => {
  // Create a binary lockfile that will trigger the integrity parsing panic
  // The issue occurs when parsing bun.lockb files with malformed integrity data
  
  const dir = tempDirWithFiles("integrity-panic-test", {
    "package.json": JSON.stringify({
      name: "test-panic",
      version: "1.0.0",
      dependencies: {
        "lodash": "4.17.21"  // Use a real package to trigger lockfile creation
      }
    }),
  });

  // First, create a valid lockfile by doing a normal install
  const installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  
  await installProc.exited;

  // Now create a malformed binary lockfile that will cause the panic
  // The panic happens when the base64 decoder tries to decode more than 64 bytes
  // into the fixed-size integrity buffer
  
  // Create a malformed integrity value that when base64-decoded exceeds 64 bytes
  // This simulates the exact condition that causes "index out of bounds: index 64, len 64"
  const malformedIntegrityBytes = new Uint8Array(100); // More than 64 bytes
  malformedIntegrityBytes.fill(0xAA); // Fill with some data
  const malformedBase64 = Buffer.from(malformedIntegrityBytes).toString('base64');
  
  // Create a JSON lockfile first to see the structure
  const jsonLockfile = {
    lockfileVersion: 3,
    requires: true,
    packages: {
      "node_modules/lodash": {
        version: "4.17.21",
        resolved: "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz",
        integrity: `sha256-${malformedBase64}`, // This will cause the panic
      }
    }
  };
  
  // Write a JSON lockfile that Bun will try to parse
  await Bun.write(`${dir}/bun.lock`, JSON.stringify(jsonLockfile, null, 2));

  // Now try to run bun install which will try to parse this malformed lockfile
  // This should trigger the panic in the release version but work with our fix
  const testProc = Bun.spawn({
    cmd: [bunExe(), "install", "--verbose"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    testProc.stdout.text(),
    testProc.stderr.text(), 
    testProc.exited,
  ]);

  console.log("stdout:", stdout);
  console.log("stderr:", stderr);
  console.log("exitCode:", exitCode);

  // The critical test: it should not panic with "index out of bounds"
  expect(stderr).not.toContain("index out of bounds");
  expect(stderr).not.toContain("panic");
  
  // It may fail gracefully, but should not crash
  if (exitCode !== 0) {
    // If it fails, it should be a graceful error, not a panic
    expect(stderr).not.toContain("panic");
  }
});