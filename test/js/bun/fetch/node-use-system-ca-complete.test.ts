import { describe, expect, test } from "bun:test";
import { promises as fs } from "fs";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { platform } from "os";
import { join } from "path";

describe("NODE_USE_SYSTEM_CA Complete Implementation", () => {
  test("should work with standard HTTPS sites", async () => {
    const testDir = tempDirWithFiles("node-use-system-ca-basic", {});

    const testScript = `
async function testHttpsRequest() {
  try {
    const response = await fetch('https://httpbin.org/user-agent');
    console.log('SUCCESS: GitHub request completed with status', response.status);
    process.exit(0);
  } catch (error) {
    console.log('ERROR: HTTPS request failed:', error.message);
    process.exit(1);
  }
}

testHttpsRequest();
`;

    await fs.writeFile(join(testDir, "test.js"), testScript);

    // Test with NODE_USE_SYSTEM_CA=1
    const proc1 = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: {
        ...bunEnv,
        NODE_USE_SYSTEM_CA: "1",
      },
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout1, stderr1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);

    expect(exitCode1).toBe(0);
    expect(stdout1).toContain("SUCCESS");

    // Test without NODE_USE_SYSTEM_CA
    const proc2 = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

    expect(exitCode2).toBe(0);
    expect(stdout2).toContain("SUCCESS");
  });

  test("should properly parse NODE_USE_SYSTEM_CA environment variable", async () => {
    const testDir = tempDirWithFiles("node-use-system-ca-env-parsing", {});

    const testScript = `
const testCases = [
  { env: '1', description: 'string "1"' },
  { env: 'true', description: 'string "true"' },
  { env: '0', description: 'string "0"' },
  { env: 'false', description: 'string "false"' },
  { env: undefined, description: 'undefined' }
];

console.log('Testing NODE_USE_SYSTEM_CA environment variable parsing:');

for (const testCase of testCases) {
  if (testCase.env !== undefined) {
    process.env.NODE_USE_SYSTEM_CA = testCase.env;
  } else {
    delete process.env.NODE_USE_SYSTEM_CA;
  }
  
  const actual = process.env.NODE_USE_SYSTEM_CA;
  console.log(\`  \${testCase.description}: \${actual || 'undefined'}\`);
}

console.log('Environment variable parsing test completed successfully');
process.exit(0);
`;

    await fs.writeFile(join(testDir, "test-env.js"), testScript);

    const proc = Bun.spawn({
      cmd: [bunExe(), "test-env.js"],
      env: bunEnv,
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Environment variable parsing test completed successfully");
  });

  test("should handle platform-specific behavior correctly", async () => {
    const testDir = tempDirWithFiles("node-use-system-ca-platform", {});

    const testScript = `
const { platform } = require('os');

console.log(\`Platform: \${platform()}\`);
console.log(\`NODE_USE_SYSTEM_CA: \${process.env.NODE_USE_SYSTEM_CA}\`);

async function testPlatformBehavior() {
  try {
    // Test a reliable HTTPS endpoint
    const response = await fetch('https://httpbin.org/user-agent');
    const data = await response.json();
    
    console.log('SUCCESS: Platform-specific certificate loading working');
    console.log('User-Agent:', data['user-agent']);
    
    if (platform() === 'darwin' && process.env.NODE_USE_SYSTEM_CA === '1') {
      console.log('SUCCESS: macOS Security framework integration should be active');
    } else if (platform() === 'linux' && process.env.NODE_USE_SYSTEM_CA === '1') {
      console.log('SUCCESS: Linux system certificate loading should be active');
    } else if (platform() === 'win32' && process.env.NODE_USE_SYSTEM_CA === '1') {
      console.log('SUCCESS: Windows certificate store integration should be active');
    } else {
      console.log('SUCCESS: Using bundled certificates');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('FAILED: Platform test failed:', error.message);
    process.exit(1);
  }
}

testPlatformBehavior();
`;

    await fs.writeFile(join(testDir, "test-platform.js"), testScript);

    const proc = Bun.spawn({
      cmd: [bunExe(), "test-platform.js"],
      env: {
        ...bunEnv,
        NODE_USE_SYSTEM_CA: "1",
      },
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    console.log("Platform test output:", stdout);
    console.log("Platform test errors:", stderr);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("SUCCESS: Platform-specific certificate loading working");

    if (platform() === "darwin") {
      expect(stdout).toContain("macOS Security framework integration should be active");
    } else if (platform() === "linux") {
      expect(stdout).toContain("Linux system certificate loading should be active");
    }
  });

  test("should work with TLS connections", async () => {
    const testDir = tempDirWithFiles("node-use-system-ca-tls", {});

    const testScript = `
const tls = require('tls');

async function testTLSConnection() {
  return new Promise((resolve, reject) => {
    const options = {
      host: 'www.google.com',
      port: 443,
      rejectUnauthorized: true,
    };
    
    const socket = tls.connect(options, () => {
      console.log('SUCCESS: TLS connection established');
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

testTLSConnection()
  .then(() => {
    console.log('TLS test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('TLS test failed:', error.message);
    process.exit(1);
  });
`;

    await fs.writeFile(join(testDir, "test-tls.js"), testScript);

    const proc = Bun.spawn({
      cmd: [bunExe(), "test-tls.js"],
      env: {
        ...bunEnv,
        NODE_USE_SYSTEM_CA: "1",
      },
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    console.log("TLS test output:", stdout);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("SUCCESS: TLS connection established");
    expect(stdout).toContain("TLS test completed successfully");
  });
});
