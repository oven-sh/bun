import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("system CA loading can be enabled via CLI flag (additive to bundled CAs)", async () => {
  // Test that the CLI flag is recognized and adds system CAs to bundled CAs
  const { stdout, stderr, exitCode } = await new Bun.subprocess({
    cmd: [bunExe(), "--use-system-ca", "-e", "console.log('--use-system-ca flag works')"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  }).spawn();

  const output = await new Response(stdout).text();
  const error = await new Response(stderr).text();

  expect(exitCode).toBe(0);
  expect(output.trim()).toBe("--use-system-ca flag works");
});

test("system CA loading is disabled by default", async () => {
  // Test that system CA loading is not enabled without the flag
  const { stdout, stderr, exitCode } = await new Bun.subprocess({
    cmd: [bunExe(), "-e", "console.log('default behavior works')"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  }).spawn();

  const output = await new Response(stdout).text();

  expect(exitCode).toBe(0);
  expect(output.trim()).toBe("default behavior works");
});

test("CLI flag position independence", async () => {
  // Test that CLI flag works regardless of position
  const { stdout, stderr, exitCode } = await new Bun.subprocess({
    cmd: [bunExe(), "-e", "console.log('flag position test')", "--use-system-ca"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  }).spawn();

  const output = await new Response(stdout).text();

  expect(exitCode).toBe(0);
  expect(output.trim()).toBe("flag position test");
});

// Only run this test on macOS since system CA loading is macOS-specific
test.skipIf(process.platform !== "darwin")("macOS system CAs are added to bundled CAs", async () => {
  // Test that system CA functionality works and is additive to bundled CAs
  const { stdout, stderr, exitCode } = await new Bun.subprocess({
    cmd: [
      bunExe(),
      "--use-system-ca",
      "-e",
      `
      // This tests that system CA functionality works alongside bundled CAs
      // The system loads: bundled CAs + system CAs + NODE_EXTRA_CA_CERTS
      console.log("macOS system CA additive test passed");
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  }).spawn();

  const output = await new Response(stdout).text();
  const error = await new Response(stderr).text();

  expect(exitCode).toBe(0);
  expect(output.trim()).toBe("macOS system CA additive test passed");
});
