import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { promises as fs } from "fs";
import { join } from "path";

describe("--use-system-ca CLI flag", () => {
  test("should enable system CA with --use-system-ca flag", async () => {
    const testDir = tempDirWithFiles("use-system-ca-cli", {});
    
    const testScript = `
async function testSystemCA() {
  try {
    const response = await fetch('https://httpbin.org/get');
    console.log('SUCCESS: HTTPS request with --use-system-ca flag worked');
    console.log('Status:', response.status);
    process.exit(0);
  } catch (error) {
    console.error('FAILED: HTTPS request failed:', error.message);
    process.exit(1);
  }
}

testSystemCA();
`;

    await fs.writeFile(join(testDir, "test-cli-flag.js"), testScript);
    
    // Test with --use-system-ca CLI flag
    const proc = Bun.spawn({
      cmd: [bunExe(), "--use-system-ca", "test-cli-flag.js"],
      env: bunEnv,
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    console.log("CLI flag test output:", stdout);
    console.log("CLI flag test errors:", stderr);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("SUCCESS");
    expect(stdout).toContain("HTTPS request with --use-system-ca flag worked");
  });

  test("should work with both CLI flag and environment variable", async () => {
    const testDir = tempDirWithFiles("use-system-ca-both", {});
    
    const testScript = `
console.log('Testing CLI flag with environment variable');

async function testBothMethods() {
  try {
    const response = await fetch('https://httpbin.org/user-agent');
    const data = await response.json();
    console.log('SUCCESS: Both CLI flag and env var work together');
    console.log('User-Agent:', data['user-agent']);
    process.exit(0);
  } catch (error) {
    console.error('FAILED:', error.message);
    process.exit(1);
  }
}

testBothMethods();
`;

    await fs.writeFile(join(testDir, "test-both.js"), testScript);
    
    // Test with both --use-system-ca flag and NODE_USE_SYSTEM_CA=1
    const proc = Bun.spawn({
      cmd: [bunExe(), "--use-system-ca", "test-both.js"],
      env: {
        ...bunEnv,
        NODE_USE_SYSTEM_CA: "1",
      },
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    console.log("Both methods test output:", stdout);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("SUCCESS");
    expect(stdout).toContain("Both CLI flag and env var work together");
  });

  test("should show CLI flag takes priority over missing env var", async () => {
    const testDir = tempDirWithFiles("use-system-ca-priority", {});
    
    const testScript = `
console.log('Testing CLI flag priority over environment');

async function testPriority() {
  try {
    const response = await fetch('https://www.google.com/');
    console.log('SUCCESS: CLI flag works without environment variable');
    console.log('Status:', response.status);
    process.exit(0);
  } catch (error) {
    console.error('FAILED:', error.message);
    process.exit(1);
  }
}

testPriority();
`;

    await fs.writeFile(join(testDir, "test-priority.js"), testScript);
    
    // Test with only --use-system-ca flag (no NODE_USE_SYSTEM_CA env var)
    const proc = Bun.spawn({
      cmd: [bunExe(), "--use-system-ca", "test-priority.js"],
      env: bunEnv, // No NODE_USE_SYSTEM_CA set
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    console.log("Priority test output:", stdout);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("SUCCESS");
    expect(stdout).toContain("CLI flag works without environment variable");
  });

  test("should handle TLS connections with CLI flag", async () => {
    const testDir = tempDirWithFiles("use-system-ca-tls", {});
    
    const testScript = `
const tls = require('tls');

async function testTLSWithCLI() {
  return new Promise((resolve, reject) => {
    const options = {
      host: 'httpbin.org',
      port: 443,
      rejectUnauthorized: true,
    };
    
    const socket = tls.connect(options, () => {
      console.log('SUCCESS: TLS connection with --use-system-ca worked');
      console.log('Certificate authorized:', socket.authorized);
      
      socket.destroy();
      resolve();
    });
    
    socket.on('error', (error) => {
      console.error('FAILED: TLS connection failed:', error.message);
      reject(error);
    });
    
    socket.setTimeout(10000, () => {
      console.error('FAILED: Connection timeout');
      socket.destroy();
      reject(new Error('Timeout'));
    });
  });
}

testTLSWithCLI()
  .then(() => {
    console.log('TLS test with CLI flag completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('TLS test failed:', error.message);
    process.exit(1);
  });
`;

    await fs.writeFile(join(testDir, "test-tls-cli.js"), testScript);
    
    const proc = Bun.spawn({
      cmd: [bunExe(), "--use-system-ca", "test-tls-cli.js"],
      env: bunEnv,
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    console.log("TLS CLI test output:", stdout);
    
    expect(exitCode).toBe(0);
    expect(stdout).toContain("SUCCESS: TLS connection with --use-system-ca worked");
    expect(stdout).toContain("TLS test with CLI flag completed successfully");
  });

  test("should accept --use-system-ca flag without errors", async () => {
    // Test that the flag is recognized by the argument parser
    const proc = Bun.spawn({
      cmd: [bunExe(), "--use-system-ca", "--version"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    // Should not have any argument parsing errors
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("Unknown option");
    expect(stderr).not.toContain("error");
    expect(stdout).toMatch(/\d+\.\d+\.\d+/); // Version should be printed
  });
});